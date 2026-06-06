"""
Dimensionality Reduction & Cluster Analysis Microservice
Computes t-SNE, UMAP, PCA, Silhouette, and Distance Matrix for RNA sequences
using k-mer frequency features on the VARIABLE REGION only.
Enhanced with GMM, HDBSCAN, Spectral Clustering, and hybrid features.
Runs on port 3003.
"""
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import sys
import os
import numpy as np
from collections import Counter

PORT = 3003


def detect_primers(sequences: list, threshold: float = 0.9) -> tuple:
    """
    Auto-detect common prefix and suffix (primer regions) from sequences.
    Returns (prefix_len, suffix_len).
    """
    if len(sequences) < 2:
        return (0, 0)

    first = sequences[0]
    sample_size = min(len(sequences), 200)

    # Detect prefix
    prefix_len = 0
    for i in range(len(first)):
        char = first[i]
        matches = sum(1 for j in range(sample_size) if len(sequences[j]) > i and sequences[j][i] == char)
        if matches / sample_size >= threshold:
            prefix_len = i + 1
        else:
            break

    # Detect suffix
    suffix_len = 0
    for i in range(len(first) - prefix_len):
        char = first[-(i + 1)]
        matches = sum(1 for j in range(sample_size) if len(sequences[j]) > prefix_len + i and sequences[j][-(i + 1)] == char)
        if matches / sample_size >= threshold:
            suffix_len = i + 1
        else:
            break

    # Only trim if >= 4 bases
    if prefix_len < 4:
        prefix_len = 0
    if suffix_len < 4:
        suffix_len = 0

    return (prefix_len, suffix_len)


def kmer_features(sequence: str, k: int = 4) -> np.ndarray:
    """
    Compute k-mer frequency feature vector for a sequence.
    Uses RNA alphabet (T->U), overlapping k-mers.
    Returns a normalized frequency array of length 4^k.
    """
    seq = sequence.upper().replace('T', 'U')
    # Only keep valid RNA nucleotides
    seq = ''.join(c for c in seq if c in 'ACGU')

    nts = ['A', 'C', 'G', 'U']
    # Generate all k-mers
    all_kmers = []
    def gen_kmers(current, depth):
        if depth == 0:
            all_kmers.append(current)
            return
        for n in nts:
            gen_kmers(current + n, depth - 1)
    gen_kmers('', k)
    kmer_index = {km: i for i, km in enumerate(all_kmers)}

    counts = Counter()
    for i in range(len(seq) - k + 1):
        km = seq[i:i+k]
        if km in kmer_index:
            counts[km] += 1

    total = sum(counts.values())
    if total == 0:
        return np.zeros(len(all_kmers), dtype=float)

    features = np.array([counts.get(km, 0) / total for km in all_kmers], dtype=float)
    return features


def gapped_kmer_features(sequence: str, k: int = 3, gap: int = 1) -> np.ndarray:
    """
    Compute gapped k-mer features to capture longer-range nucleotide dependencies.
    A gapped k-mer of (k=3, gap=1) captures patterns like 'A_G_C' where _ is any base.
    """
    seq = sequence.upper().replace('T', 'U')
    seq = ''.join(c for c in seq if c in 'ACGU')

    nts = ['A', 'C', 'G', 'U']
    # Generate all k-mers (the positions we care about)
    all_kmers = []
    def gen_kmers(current, depth):
        if depth == 0:
            all_kmers.append(current)
            return
        for n in nts:
            gen_kmers(current + n, depth - 1)
    gen_kmers('', k)
    kmer_index = {km: i for i, km in enumerate(all_kmers)}

    # Stride: positions we extract are 0, gap+1, 2*(gap+1), ...
    stride = gap + 1
    window_size = (k - 1) * stride + 1

    counts = Counter()
    for i in range(len(seq) - window_size + 1):
        pattern = ''.join(seq[i + j * stride] for j in range(k))
        if pattern in kmer_index:
            counts[pattern] += 1

    total = sum(counts.values())
    if total == 0:
        return np.zeros(len(all_kmers), dtype=float)

    features = np.array([counts.get(km, 0) / total for km in all_kmers], dtype=float)
    return features


def prepare_features(sequences: list, forward_primer: str = None, reverse_primer: str = None,
                     structural_scores: list = None, feature_mode: str = 'kmer'):
    """
    Common feature preparation: primer detection, variable region extraction,
    k-mer feature matrix, standardization.
    If forward_primer / reverse_primer are provided, use them to precisely trim;
    otherwise auto-detect primer regions.

    feature_mode:
      - 'kmer': standard k-mer features only (default)
      - 'hybrid': k-mer + gapped k-mer + structural scores (cGcC, G4Hunter, MFE)
      - 'structural': structural scores only

    Returns (X, k, avg_len, prefix_len, suffix_len).
    """
    from sklearn.preprocessing import StandardScaler

    # Determine primer lengths: user-specified takes priority over auto-detection
    if forward_primer or reverse_primer:
        prefix_len = len(forward_primer) if forward_primer else 0
        suffix_len = len(reverse_primer) if reverse_primer else 0
        print(f'[Features] User-specified primers: 5\'={forward_primer or "none"} ({prefix_len}bp), 3\'={reverse_primer or "none"} ({suffix_len}bp)', flush=True)
    else:
        # Auto-detect primer regions
        prefix_len, suffix_len = detect_primers(sequences)

    if prefix_len > 0 or suffix_len > 0:
        var_regions = []
        for seq in sequences:
            end = len(seq) - suffix_len if suffix_len > 0 else len(seq)
            start = min(prefix_len, len(seq))
            end = max(start, end)
            var_regions.append(seq[start:end])
        var_len = sum(len(s) for s in var_regions) // max(len(var_regions), 1)
        print(f'[Features] Trimmed to variable region: prefix={prefix_len}bp, suffix={suffix_len}bp, avg_variable={var_len}bp', flush=True)
    else:
        var_regions = sequences

    # Choose k-mer size based on variable region length
    avg_len = sum(len(s) for s in var_regions) / max(len(var_regions), 1)
    if avg_len < 10:
        k = 2
    elif avg_len < 18:
        k = 3
    else:
        k = 4

    # Build feature matrix from variable regions
    kmer_feats = np.array([kmer_features(seq, k=k) for seq in var_regions])

    if feature_mode == 'hybrid':
        # Add gapped k-mer features for longer-range patterns
        gapped_k = min(k, 3)
        gapped_feats = np.array([gapped_kmer_features(seq, k=gapped_k, gap=1) for seq in var_regions])

        # Combine k-mer + gapped k-mer
        features = np.hstack([kmer_feats, gapped_feats * 0.5])  # Weight gapped lower

        # Add structural scores if available
        if structural_scores and len(structural_scores) == len(sequences):
            struct_array = np.array(structural_scores, dtype=float)
            # Normalize structural features to similar scale as k-mer features
            struct_scaler = StandardScaler()
            struct_scaled = struct_scaler.fit_transform(struct_array)
            # Weight structural features (they're informative but fewer dimensions)
            features = np.hstack([features, struct_scaled * 0.3])
            print(f'[Features] Hybrid mode: {kmer_feats.shape[1]} kmer + {gapped_feats.shape[1]} gapped + {struct_array.shape[1]} structural features', flush=True)
        else:
            print(f'[Features] Hybrid mode: {kmer_feats.shape[1]} kmer + {gapped_feats.shape[1]} gapped features (no structural)', flush=True)
    elif feature_mode == 'structural' and structural_scores and len(structural_scores) == len(sequences):
        features = np.array(structural_scores, dtype=float)
        print(f'[Features] Structural-only mode: {features.shape[1]} features', flush=True)
    else:
        features = kmer_feats

    # Standardize features
    scaler = StandardScaler()
    X = scaler.fit_transform(features)

    # Remove zero-variance columns
    variance = np.var(X, axis=0)
    informative_cols = variance > 1e-10
    if informative_cols.sum() > 0:
        X = X[:, informative_cols]
        print(f'[Features] Using {X.shape[1]} informative features (k={k}, dropped {(~informative_cols).sum()} zero-variance)', flush=True)

    return X, k, avg_len, prefix_len, suffix_len


def compute_tsne(sequences: list, cluster_ids: list, perplexity: int = None) -> dict:
    """
    Compute t-SNE 2D embedding for the given sequences.
    """
    from sklearn.manifold import TSNE

    n = len(sequences)

    # Handle small datasets
    if n <= 3:
        coords = np.random.randn(n, 2) * 10
        result = []
        for i, (seq, cid) in enumerate(zip(sequences, cluster_ids)):
            result.append({
                'x': float(coords[i, 0]),
                'y': float(coords[i, 1]),
                'clusterId': cid,
                'sequence': seq[:30] + ('...' if len(seq) > 30 else ''),
                'idx': i,
            })
        return {'success': True, 'data': result, 'n': n}

    X, k, avg_len, _, _ = prepare_features(sequences)

    # Auto-set perplexity (must be < n_samples)
    if perplexity is None:
        perplexity = min(30, max(2, n // 4))
    perplexity = min(perplexity, n - 1)

    # Run t-SNE
    try:
        tsne = TSNE(
            n_components=2,
            perplexity=perplexity,
            learning_rate='auto',
            init='pca' if n > 10 else 'random',
            random_state=42,
            n_iter=1500,
            metric='cosine',
        )
        embedding = tsne.fit_transform(X)
    except Exception:
        tsne = TSNE(
            n_components=2,
            perplexity=perplexity,
            learning_rate='auto',
            init='random',
            random_state=42,
            n_iter=1500,
            metric='euclidean',
        )
        embedding = tsne.fit_transform(X)

    result = []
    for i, (seq, cid) in enumerate(zip(sequences, cluster_ids)):
        result.append({
            'x': float(embedding[i, 0]),
            'y': float(embedding[i, 1]),
            'clusterId': int(cid) if cid is not None else -1,
            'sequence': seq[:35] + ('...' if len(seq) > 35 else ''),
            'idx': i,
        })

    return {'success': True, 'data': result, 'n': n, 'perplexity': perplexity, 'kmerSize': k, 'variableLen': int(avg_len)}


def compute_umap(sequences: list, cluster_ids: list) -> dict:
    """
    Compute UMAP 2D embedding for the given sequences.
    UMAP preserves both local and global structure better than t-SNE.
    """
    import umap

    n = len(sequences)
    if n <= 3:
        coords = np.random.randn(n, 2) * 10
        result = []
        for i, (seq, cid) in enumerate(zip(sequences, cluster_ids)):
            result.append({
                'x': float(coords[i, 0]),
                'y': float(coords[i, 1]),
                'clusterId': cid,
                'sequence': seq[:30] + ('...' if len(seq) > 30 else ''),
                'idx': i,
            })
        return {'success': True, 'data': result, 'n': n}

    X, k, avg_len, _, _ = prepare_features(sequences)

    n_neighbors = min(15, max(2, n // 5))
    min_dist = 0.1

    reducer = umap.UMAP(
        n_components=2,
        n_neighbors=n_neighbors,
        min_dist=min_dist,
        metric='cosine',
        random_state=42,
    )
    embedding = reducer.fit_transform(X)

    result = []
    for i, (seq, cid) in enumerate(zip(sequences, cluster_ids)):
        result.append({
            'x': float(embedding[i, 0]),
            'y': float(embedding[i, 1]),
            'clusterId': int(cid) if cid is not None else -1,
            'sequence': seq[:35] + ('...' if len(seq) > 35 else ''),
            'idx': i,
        })

    return {'success': True, 'data': result, 'n': n, 'nNeighbors': n_neighbors, 'minDist': min_dist, 'kmerSize': k, 'variableLen': int(avg_len)}


def compute_pca(sequences: list, cluster_ids: list) -> dict:
    """
    Compute PCA 2D projection for the given sequences.
    Linear method - shows the major variance directions.
    """
    from sklearn.decomposition import PCA

    n = len(sequences)
    if n <= 3:
        coords = np.random.randn(n, 2) * 10
        result = []
        for i, (seq, cid) in enumerate(zip(sequences, cluster_ids)):
            result.append({
                'x': float(coords[i, 0]),
                'y': float(coords[i, 1]),
                'clusterId': cid,
                'sequence': seq[:30] + ('...' if len(seq) > 30 else ''),
                'idx': i,
            })
        return {'success': True, 'data': result, 'n': n, 'varianceExplained': [0, 0]}

    X, k, avg_len, _, _ = prepare_features(sequences)

    pca = PCA(n_components=2, random_state=42)
    embedding = pca.fit_transform(X)
    variance_explained = pca.explained_variance_ratio_.tolist()

    result = []
    for i, (seq, cid) in enumerate(zip(sequences, cluster_ids)):
        result.append({
            'x': float(embedding[i, 0]),
            'y': float(embedding[i, 1]),
            'clusterId': int(cid) if cid is not None else -1,
            'sequence': seq[:35] + ('...' if len(seq) > 35 else ''),
            'idx': i,
        })

    return {
        'success': True,
        'data': result,
        'n': n,
        'varianceExplained': [float(v) for v in variance_explained],
        'kmerSize': k,
        'variableLen': int(avg_len),
    }


def compute_silhouette(sequences: list, cluster_ids: list) -> dict:
    """
    Compute silhouette scores for each sequence.
    Score range: -1 to 1 (higher = better cluster fit).
    """
    from sklearn.metrics import silhouette_samples, silhouette_score
    from sklearn.metrics.pairwise import cosine_distances

    n = len(sequences)
    unique_clusters = list(set(cluster_ids))

    if n < 3 or len(unique_clusters) < 2:
        return {'success': True, 'data': [], 'avgScore': 0, 'n': n, 'message': 'Need at least 2 clusters and 3 samples'}

    X, k, avg_len, _, _ = prepare_features(sequences)

    # Compute distance matrix
    dist_matrix = cosine_distances(X)

    labels = np.array(cluster_ids)
    sample_scores = silhouette_samples(dist_matrix, labels, metric='precomputed')
    avg_score = float(silhouette_score(dist_matrix, labels, metric='precomputed'))

    # Build per-cluster data
    cluster_data = []
    for cid in sorted(unique_clusters):
        mask = labels == cid
        scores = sample_scores[mask]
        cluster_data.append({
            'clusterId': int(cid),
            'scores': sorted([float(s) for s in scores], reverse=True),
            'avgScore': float(np.mean(scores)),
            'size': int(mask.sum()),
        })

    return {
        'success': True,
        'data': cluster_data,
        'avgScore': avg_score,
        'n': n,
        'numClusters': len(unique_clusters),
        'kmerSize': k,
    }


def compute_distance_matrix(sequences: list, cluster_ids: list) -> dict:
    """
    Compute inter-cluster distance matrix (average pairwise cosine distance between clusters).
    """
    from sklearn.metrics.pairwise import cosine_distances

    n = len(sequences)
    unique_clusters = sorted(set(cluster_ids))
    num_clusters = len(unique_clusters)

    if num_clusters < 2:
        return {'success': True, 'matrix': [[0]], 'clusterIds': unique_clusters, 'n': n}

    X, k, avg_len, _, _ = prepare_features(sequences)

    # Compute full pairwise distance matrix
    full_dist = cosine_distances(X)

    labels = np.array(cluster_ids)

    # Compute average distance between each pair of clusters
    matrix = np.zeros((num_clusters, num_clusters))
    for i, ci in enumerate(unique_clusters):
        for j, cj in enumerate(unique_clusters):
            if i == j:
                # Intra-cluster distance (cohesion)
                mask = labels == ci
                if mask.sum() > 1:
                    intra = full_dist[np.ix_(mask, mask)]
                    matrix[i][j] = float(np.mean(intra[np.triu_indices(mask.sum(), k=1)]))
                else:
                    matrix[i][j] = 0.0
            else:
                # Inter-cluster distance
                mask_i = labels == ci
                mask_j = labels == cj
                inter = full_dist[np.ix_(mask_i, mask_j)]
                matrix[i][j] = float(np.mean(inter))

    # Cluster sizes
    sizes = [int((labels == cid).sum()) for cid in unique_clusters]

    return {
        'success': True,
        'matrix': matrix.tolist(),
        'clusterIds': [int(c) for c in unique_clusters],
        'clusterSizes': sizes,
        'n': n,
        'numClusters': num_clusters,
        'kmerSize': k,
    }


def compute_optimal_clustering(sequences: list, method: str = 'auto', max_clusters: int = 30,
                                forward_primer: str = None, reverse_primer: str = None,
                                structural_scores: list = None, feature_mode: str = 'auto') -> dict:
    """
    Compute optimal clustering using k-mer features + ML algorithms.
    Enhanced with GMM, HDBSCAN, Spectral Clustering.
    Optimized for speed: limited iterations, early termination.

    Methods: hierarchical, dbscan, hdbscan, kmeans, gmm, spectral, auto (try all)
    """
    from sklearn.cluster import AgglomerativeClustering, DBSCAN, KMeans, SpectralClustering
    from sklearn.mixture import GaussianMixture
    from sklearn.metrics import silhouette_score
    from sklearn.metrics.pairwise import cosine_distances

    n = len(sequences)
    if n < 3:
        return {'success': True, 'clusterIds': [1] * n, 'numClusters': 1, 'method': 'trivial', 'silhouetteScore': 0}

    # Only use kmer mode (hybrid needs structural scores from prior analysis)
    fm = 'kmer'
    if feature_mode == 'hybrid' and structural_scores and len(structural_scores) == n:
        fm = 'hybrid'

    X, k, avg_len, prefix_len, suffix_len = prepare_features(
        sequences, forward_primer, reverse_primer,
        structural_scores=structural_scores, feature_mode=fm
    )
    dist_matrix = cosine_distances(X)

    print(f'[OptimalCluster] n={n}, features={X.shape[1]}, mode={fm}', flush=True)

    methods_to_try = []
    if method == 'auto':
        methods_to_try = ['hierarchical', 'kmeans', 'gmm', 'spectral', 'dbscan', 'hdbscan']
    else:
        methods_to_try = [method]

    max_k = min(max_clusters, n // 5, 50)
    max_k = max(max_k, 2)

    # Coarse K candidates (limited for speed)
    coarse_ks = sorted(set([ck for ck in [2, 3, 4, 5, 7, 10, 15, 20] if ck <= max_k]))
    if max_k not in coarse_ks:
        coarse_ks.append(max_k)

    best_labels = None
    best_score = -1
    best_method = ''
    best_k = 0

    def try_clustering(labels_arr, method_name, num_k):
        """Helper: evaluate and update best if improved."""
        nonlocal best_labels, best_score, best_method, best_k
        if len(set(labels_arr)) < 2:
            return
        score = silhouette_score(dist_matrix, labels_arr, metric='precomputed')
        if score > best_score:
            best_score = score
            best_labels = labels_arr.copy()
            best_method = method_name
            best_k = num_k

    for m in methods_to_try:
        try:
            if m == 'hierarchical':
                # Only use average linkage (fastest, works with precomputed)
                coarse_best_k = 2
                coarse_best_score = -1
                for num_k in coarse_ks:
                    agg = AgglomerativeClustering(
                        n_clusters=num_k, metric='precomputed', linkage='average'
                    )
                    labels = agg.fit_predict(dist_matrix)
                    if len(set(labels)) < 2:
                        continue
                    score = silhouette_score(dist_matrix, labels, metric='precomputed')
                    if score > coarse_best_score:
                        coarse_best_score = score
                        coarse_best_k = num_k
                    if score > best_score:
                        best_score = score
                        best_labels = labels.copy()
                        best_method = 'hierarchical'
                        best_k = num_k

                # Fine scan +-2
                for num_k in range(max(2, coarse_best_k - 2), min(max_k + 1, coarse_best_k + 3)):
                    if num_k in coarse_ks:
                        continue
                    agg = AgglomerativeClustering(
                        n_clusters=num_k, metric='precomputed', linkage='average'
                    )
                    labels = agg.fit_predict(dist_matrix)
                    try_clustering(labels, 'hierarchical', num_k)

                # Also try ward (euclidean) — often better for k-mer features
                for num_k in [coarse_best_k - 1, coarse_best_k, coarse_best_k + 1]:
                    if num_k < 2 or num_k > max_k:
                        continue
                    try:
                        agg = AgglomerativeClustering(n_clusters=num_k, linkage='ward')
                        labels = agg.fit_predict(X)
                        try_clustering(labels, 'hierarchical_ward', num_k)
                    except Exception:
                        pass

            elif m == 'kmeans':
                coarse_best_k = 2
                coarse_best_score = -1
                for num_k in coarse_ks:
                    km = KMeans(n_clusters=num_k, random_state=42, n_init=5, max_iter=150)
                    labels = km.fit_predict(X)
                    if len(set(labels)) < 2:
                        continue
                    score = silhouette_score(dist_matrix, labels, metric='precomputed')
                    if score > coarse_best_score:
                        coarse_best_score = score
                        coarse_best_k = num_k
                    if score > best_score:
                        best_score = score
                        best_labels = labels.copy()
                        best_method = 'kmeans'
                        best_k = num_k

                # Fine scan
                for num_k in range(max(2, coarse_best_k - 2), min(max_k + 1, coarse_best_k + 3)):
                    if num_k in coarse_ks:
                        continue
                    km = KMeans(n_clusters=num_k, random_state=42, n_init=5, max_iter=150)
                    labels = km.fit_predict(X)
                    try_clustering(labels, 'kmeans', num_k)

            elif m == 'gmm':
                # GMM — try only 'full' covariance (best for overlapping clusters)
                coarse_best_k = 2
                for num_k in coarse_ks[:6]:  # Limit to first 6 K values for speed
                    try:
                        gmm = GaussianMixture(
                            n_components=num_k, covariance_type='full',
                            random_state=42, max_iter=100, n_init=2,
                        )
                        labels = gmm.fit_predict(X)
                        if len(set(labels)) < 2:
                            continue
                        score = silhouette_score(dist_matrix, labels, metric='precomputed')
                        if score > best_score:
                            best_score = score
                            best_labels = labels.copy()
                            best_method = 'gmm'
                            best_k = num_k
                            coarse_best_k = num_k
                    except Exception:
                        continue

                # Fine scan around best
                for num_k in range(max(2, coarse_best_k - 1), min(max_k + 1, coarse_best_k + 2)):
                    if num_k in coarse_ks:
                        continue
                    try:
                        gmm = GaussianMixture(
                            n_components=num_k, covariance_type='full',
                            random_state=42, max_iter=100, n_init=2,
                        )
                        labels = gmm.fit_predict(X)
                        try_clustering(labels, 'gmm', num_k)
                    except Exception:
                        continue

            elif m == 'spectral':
                # Spectral — convert distance to affinity
                affinity_matrix = 1 - np.clip(dist_matrix, 0, 1)
                np.fill_diagonal(affinity_matrix, 1)
                # Ensure positive semi-definite
                affinity_matrix = np.clip(affinity_matrix, 0, None)

                for num_k in coarse_ks[:5]:  # Limit for speed
                    try:
                        spec = SpectralClustering(
                            n_clusters=num_k, affinity='precomputed',
                            random_state=42, n_init=3, assign_labels='kmeans',
                        )
                        labels = spec.fit_predict(affinity_matrix)
                        try_clustering(labels, 'spectral', num_k)
                    except Exception:
                        continue

            elif m == 'dbscan':
                from sklearn.neighbors import NearestNeighbors
                nn_k = min(5, n - 1)
                nn = NearestNeighbors(n_neighbors=nn_k, metric='precomputed')
                nn.fit(dist_matrix)
                distances, _ = nn.kneighbors(dist_matrix)
                k_distances = np.sort(distances[:, -1])

                for p in [20, 40, 60]:
                    eps = float(np.percentile(k_distances, p))
                    if eps < 0.01:
                        eps = 0.01
                    db = DBSCAN(eps=eps, min_samples=max(2, n // 50), metric='precomputed')
                    labels = db.fit_predict(dist_matrix)

                    unique_labels = set(labels.tolist())
                    unique_labels.discard(-1)
                    if len(unique_labels) < 2:
                        continue

                    # Re-assign noise to nearest cluster
                    noise_mask = labels == -1
                    if noise_mask.any():
                        for i in np.where(noise_mask)[0]:
                            min_d = float('inf')
                            nearest = 0
                            for cid in unique_labels:
                                cluster_mask = labels == cid
                                avg_d = np.mean(dist_matrix[i, cluster_mask])
                                if avg_d < min_d:
                                    min_d = avg_d
                                    nearest = cid
                            labels[i] = nearest

                    try_clustering(labels, 'dbscan', len(set(labels.tolist())))

            elif m == 'hdbscan':
                try:
                    import hdbscan as hdb
                    for mcs in [max(2, n // 20), max(3, n // 10)]:
                        clusterer = hdb.HDBSCAN(
                            min_cluster_size=mcs, metric='precomputed',
                            cluster_selection_method='eom',
                        )
                        labels = clusterer.fit_predict(dist_matrix.astype(np.float64))

                        unique_labels = set(labels.tolist())
                        unique_labels.discard(-1)
                        if len(unique_labels) < 2:
                            continue

                        # Re-assign noise
                        noise_mask = labels == -1
                        if noise_mask.any():
                            for i in np.where(noise_mask)[0]:
                                min_d = float('inf')
                                nearest = 0
                                for cid in unique_labels:
                                    cluster_mask = labels == cid
                                    avg_d = np.mean(dist_matrix[i, cluster_mask])
                                    if avg_d < min_d:
                                        min_d = avg_d
                                        nearest = cid
                                labels[i] = nearest

                        try_clustering(labels, 'hdbscan', len(set(labels.tolist())))
                except ImportError:
                    pass
                except Exception as e:
                    print(f'[OptimalCluster] hdbscan error: {e}', flush=True)

        except Exception as e:
            print(f'[OptimalCluster] Method {m} failed: {e}', flush=True)
            continue

    if best_labels is None:
        km = KMeans(n_clusters=min(3, n), random_state=42, n_init=5)
        best_labels = km.fit_predict(X)
        best_method = 'kmeans_fallback'
        best_k = min(3, n)
        best_score = 0.0

    # Convert to 1-based cluster IDs, sorted by cluster size (largest first)
    from collections import Counter as Ctr
    label_counts = Ctr(best_labels.tolist())
    sorted_labels = [lbl for lbl, _ in label_counts.most_common()]
    label_map = {old: new + 1 for new, old in enumerate(sorted_labels)}
    final_ids = [label_map[int(l)] for l in best_labels]

    # Determine quality label
    if best_score >= 0.7:
        quality = 'strong'
    elif best_score >= 0.5:
        quality = 'reasonable'
    elif best_score >= 0.25:
        quality = 'weak'
    else:
        quality = 'no_structure'

    print(f'[OptimalCluster] Best: method={best_method}, K={best_k}, silhouette={best_score:.4f}, quality={quality}, features={fm}', flush=True)

    return {
        'success': True,
        'clusterIds': final_ids,
        'numClusters': best_k,
        'method': best_method,
        'silhouetteScore': float(best_score),
        'quality': quality,
        'featureMode': fm,
        'kmerSize': k,
        'variableLen': int(avg_len),
        'n': n,
    }


class AnalysisHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/health' or self.path == '/':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({
                'status': 'ok',
                'engine': 'Cluster Analysis (scikit-learn + UMAP + HDBSCAN + GMM)',
                'endpoints': ['/tsne', '/umap', '/pca', '/silhouette', '/distance_matrix', '/optimal_cluster'],
            }).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)

        handlers = {
            '/tsne': self.handle_tsne,
            '/umap': self.handle_umap,
            '/pca': self.handle_pca,
            '/silhouette': self.handle_silhouette,
            '/distance_matrix': self.handle_distance_matrix,
            '/optimal_cluster': self.handle_optimal_cluster,
        }

        handler = handlers.get(self.path)
        if handler:
            try:
                data = json.loads(body)
                sequences = data.get('sequences', [])
                cluster_ids = data.get('clusterIds', [0] * len(sequences))

                if len(sequences) < 2:
                    raise ValueError('Need at least 2 sequences')

                result = handler(sequences, cluster_ids, data)

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(result).encode())
            except Exception as e:
                import traceback
                traceback.print_exc()
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'success': False, 'message': str(e)}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def handle_tsne(self, sequences, cluster_ids, data):
        perplexity = data.get('perplexity', None)
        return compute_tsne(sequences, cluster_ids, perplexity)

    def handle_umap(self, sequences, cluster_ids, data):
        return compute_umap(sequences, cluster_ids)

    def handle_pca(self, sequences, cluster_ids, data):
        return compute_pca(sequences, cluster_ids)

    def handle_silhouette(self, sequences, cluster_ids, data):
        return compute_silhouette(sequences, cluster_ids)

    def handle_distance_matrix(self, sequences, cluster_ids, data):
        return compute_distance_matrix(sequences, cluster_ids)

    def handle_optimal_cluster(self, sequences, cluster_ids, data):
        method = data.get('method', 'auto')
        max_clusters = data.get('maxClusters', 30)
        forward_primer = data.get('forwardPrimer', None)
        reverse_primer = data.get('reversePrimer', None)
        structural_scores = data.get('structuralScores', None)
        feature_mode = data.get('featureMode', 'auto')
        return compute_optimal_clustering(sequences, method, max_clusters,
                                          forward_primer, reverse_primer,
                                          structural_scores, feature_mode)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def log_message(self, format, *args):
        pass


if __name__ == '__main__':
    server = HTTPServer(('0.0.0.0', PORT), AnalysisHandler)
    print(f'Cluster Analysis service running on port {PORT}', flush=True)
    print(f'Endpoints: /tsne, /umap, /pca, /silhouette, /distance_matrix, /optimal_cluster', flush=True)
    print(f'Methods: hierarchical, dbscan, hdbscan, kmeans, gmm, spectral', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
        sys.exit(0)
