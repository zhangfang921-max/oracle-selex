"""
Dimensionality Reduction & Cluster Analysis Microservice
Computes t-SNE, UMAP, PCA, Silhouette, and Distance Matrix for RNA sequences
using k-mer frequency features on the VARIABLE REGION only.
Enhanced with GMM, Spectral Clustering, and hybrid features.
Runs on port 3003.
"""
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import sys
import os
import numpy as np
from collections import Counter
from profile_cluster import cluster_by_profile, permutation_test, fit_abundance_model
from profile_cluster import merge_cross_round_data, compute_cluster_enrichment

# ============================================================
# Module-level cache for dot-brackets (avoids re-folding)
# ============================================================
_DOTBRACKET_CACHE = {}


def _ensure_dot_brackets(sequences: list) -> list:
    """Return dot-bracket strings for all sequences, computing via RNAfold if not cached."""
    import urllib.request
    dbs = []
    missing_indices = []
    for i, s in enumerate(sequences):
        db = _DOTBRACKET_CACHE.get(s, None)
        if db is not None:
            dbs.append(db)
        else:
            dbs.append(None)
            missing_indices.append(i)

    if missing_indices:
        missing_seqs = [sequences[i] for i in missing_indices]
        try:
            req = urllib.request.Request(
                'http://localhost:4001/fold',
                data=json.dumps({'sequences': missing_seqs, 'gquad': True}).encode(),
                headers={'Content-Type': 'application/json'}
            )
            resp = urllib.request.urlopen(req, timeout=30)
            fold_result = json.loads(resp.read())
            fold_data = fold_result.get('data', fold_result.get('results', []))
            for idx, fd in zip(missing_indices, fold_data):
                db = fd.get('dotBracket', '.' * len(sequences[idx]))
                _DOTBRACKET_CACHE[sequences[idx]] = db
                dbs[idx] = db
        except Exception:
            # Fallback: all-dot
            for idx in missing_indices:
                db = '.' * len(sequences[idx])
                _DOTBRACKET_CACHE[sequences[idx]] = db
                dbs[idx] = db

    return dbs

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
                     structural_scores: list = None, feature_mode: str = 'kmer',
                     standardize: bool = True, k_override: int = None):
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
    if k_override is not None:
        k = k_override
    elif avg_len < 10:
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

    # Standardize features (skip when raw cosine distances are needed, e.g. distance matrix)
    if standardize:
        scaler = StandardScaler()
        X = scaler.fit_transform(features)

        # Remove zero-variance columns
        variance = np.var(X, axis=0)
        informative_cols = variance > 1e-10
        if informative_cols.sum() > 0:
            X = X[:, informative_cols]
            print(f'[Features] Using {X.shape[1]} informative features (k={k}, dropped {(~informative_cols).sum()} zero-variance)', flush=True)
    else:
        X = features
        print(f'[Features] Raw (non-standardized) features: {X.shape[1]} dims (k={k})', flush=True)

    return X, k, avg_len, prefix_len, suffix_len


def _deduplicate_points(points: list, precision: int = 6) -> list:
    """Merge points with identical (x, y) coordinates — floating-point safe.
    
    Stacked points from identical k-mer vectors are collapsed into a single
    marker with a 'count' field so the frontend can scale symbol size.
    Groups are partitioned by (rounded_x, rounded_y, clusterId) so sequences
    in different clusters never get merged.
    """
    if len(points) <= 1:
        for pt in points:
            pt['count'] = 1
        return points

    from collections import defaultdict
    grouped = defaultdict(list)
    for pt in points:
        kx = round(pt['x'], precision)
        ky = round(pt['y'], precision)
        grouped[(kx, ky, pt['clusterId'])].append(pt)

    result = []
    for pts in grouped.values():
        first = pts[0]
        first['count'] = len(pts)
        # Keep the first sequence as representative; store all if needed for tooltip
        if len(pts) > 1:
            first['sample_sequences'] = [p['sequence'] for p in pts[:5]]
        result.append(first)

    return result


def compute_tsne(sequences: list, cluster_ids: list, perplexity: int = None, feature_mode: str = 'kmer', read_counts: list = None) -> dict:
    """
    Compute t-SNE 2D embedding for the given sequences.
    Supports both k-mer and structure-profile feature modes.
    Optionally attaches read_counts as 'count' field per point.
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
                'sequence': seq,
                'idx': i,
                'count': int(read_counts[i]) if read_counts and i < len(read_counts) else 1,
            })
        return {'success': True, 'data': _deduplicate_points(result), 'n': n}

    # Feature extraction based on mode
    if feature_mode == 'structure-profile':
        # Try cache first
        dbs = [_DOTBRACKET_CACHE.get(s, None) for s in sequences]
        if all(d is not None for d in dbs):
            from profile_cluster import extract_profile_features
            X = extract_profile_features(dbs)
            k = 0
            avg_len = 0
        else:
            import urllib.request, json as j
            try:
                req = urllib.request.Request(
                    'http://localhost:4001/fold',
                    data=j.dumps({'sequences': sequences, 'gquad': True}).encode(),
                    headers={'Content-Type': 'application/json'}
                )
                resp = urllib.request.urlopen(req, timeout=10)
                fold_result = j.loads(resp.read())
                fold_data = fold_result.get('data', fold_result.get('results', []))
                dbs = [r.get('dotBracket', '.' * len(s)) for r, s in zip(fold_data, sequences)]
                from profile_cluster import extract_profile_features
                X = extract_profile_features(dbs)
                k = 0
                avg_len = 0
            except Exception:
                return {'success': False, 'message': 'Structure-profile features require dot-bracket data. Run RNA folding first.'}
    else:
        X, k, avg_len, _, _ = prepare_features(sequences)

    # Auto-set perplexity (must be < n_samples)
    # Use lower perplexity for structure-profile to spread tight clusters
    if perplexity is None:
        if feature_mode == 'structure-profile':
            perplexity = min(15, max(2, n // 10))
        else:
            perplexity = min(30, max(2, n // 4))
    perplexity = min(perplexity, n - 1)

    # Choose metric: euclidean for structure-profile, cosine for k-mer
    metric = 'euclidean' if feature_mode == 'structure-profile' else 'cosine'

    # Run t-SNE
    try:
        tsne = TSNE(
            n_components=2,
            perplexity=perplexity,
            early_exaggeration=24,
            learning_rate='auto',
            init='pca' if n >= 3 else 'random',
            random_state=42,
            n_iter=1500,
            metric=metric,
        )
        embedding = tsne.fit_transform(X)
    except (ValueError, np.linalg.LinAlgError) as e:
        print(f'[tSNE] {metric} metric failed ({e}), falling back to euclidean', flush=True)
        tsne = TSNE(
            n_components=2,
            perplexity=perplexity,
            early_exaggeration=24,
            learning_rate='auto',
            init='pca' if n >= 3 else 'random',
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
            'sequence': seq,
            'idx': i,
            'count': int(read_counts[i]) if read_counts and i < len(read_counts) else 1,
        })

    # Merge duplicate coordinates — replace stacked points with sized markers
    result = _deduplicate_points(result)

    return {'success': True, 'data': result, 'n': n, 'n_unique': len(result), 'perplexity': perplexity, 'kmerSize': k, 'variableLen': int(avg_len)}


def compute_umap(sequences: list, cluster_ids: list, feature_mode: str = 'kmer', read_counts: list = None) -> dict:
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
                'sequence': seq,
                'idx': i,
                'count': int(read_counts[i]) if read_counts and i < len(read_counts) else 1,
            })
        return {'success': True, 'data': _deduplicate_points(result), 'n': n}

    # Feature extraction
    if feature_mode == 'structure-profile':
        dbs = _ensure_dot_brackets(sequences)
        from profile_cluster import extract_profile_features
        X = extract_profile_features(dbs)
        k = 0; avg_len = 0
    else:
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

    result = _deduplicate_points(result)

    return {'success': True, 'data': result, 'n': n, 'n_unique': len(result), 'nNeighbors': n_neighbors, 'minDist': min_dist, 'kmerSize': k, 'variableLen': int(avg_len)}


def compute_pca(sequences: list, cluster_ids: list, feature_mode: str = 'kmer') -> dict:
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
                'sequence': seq,
                'idx': i,
                'count': int(read_counts[i]) if read_counts and i < len(read_counts) else 1,
            })
        return {'success': True, 'data': _deduplicate_points(result), 'n': n, 'varianceExplained': [0, 0]}

    # Feature extraction
    if feature_mode == 'structure-profile':
        dbs = _ensure_dot_brackets(sequences)
        from profile_cluster import extract_profile_features
        X = extract_profile_features(dbs)
        k = 0; avg_len = 0
    else:
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

    result = _deduplicate_points(result)

    return {
        'success': True,
        'data': result,
        'n': n,
        'n_unique': len(result),
        'varianceExplained': [float(v) for v in variance_explained],
        'kmerSize': k,
        'variableLen': int(avg_len),
    }


def compute_silhouette(sequences: list, cluster_ids: list, feature_mode: str = 'kmer', dot_brackets: list = None) -> dict:
    """
    Compute silhouette scores for each sequence.
    Score range: -1 to 1 (higher = better cluster fit).
    Supports both k-mer and structure-profile feature modes.
    """
    from sklearn.metrics import silhouette_samples, silhouette_score
    from sklearn.metrics.pairwise import cosine_distances

    n = len(sequences)
    unique_clusters = list(set(cluster_ids))

    if n < 3 or len(unique_clusters) < 2:
        return {'success': True, 'data': [], 'avgScore': 0, 'n': n, 'message': 'Need at least 2 clusters and 3 samples'}

    # Feature extraction based on mode
    if feature_mode == 'structure-profile' and dot_brackets:
        from profile_cluster import extract_profile_features
        X = extract_profile_features(dot_brackets)
        k = 0  # not applicable
        avg_len = 0
    elif feature_mode == 'structure-profile':
        # Try cache first, then predict structures via ViennaRNA
        dbs = [_DOTBRACKET_CACHE.get(s, None) for s in sequences]
        if all(d is not None for d in dbs):
            from profile_cluster import extract_profile_features
            X = extract_profile_features(dbs)
        else:
            import urllib.request, json as j
            try:
                req = urllib.request.Request(
                    'http://localhost:4001/fold',
                    data=j.dumps({'sequences': sequences, 'gquad': True}).encode(),
                    headers={'Content-Type': 'application/json'}
                )
                resp = urllib.request.urlopen(req, timeout=10)
                fold_result = j.loads(resp.read())
                fold_data = fold_result.get('data', fold_result.get('results', []))
                dbs = [r.get('dotBracket', '.' * len(s)) for r, s in zip(fold_data, sequences)]
                from profile_cluster import extract_profile_features
                X = extract_profile_features(dbs)
            except Exception:
                X, k, avg_len, _, _ = prepare_features(sequences)
                feature_mode = 'kmer'
        k = 0
        avg_len = 0
    else:
        X, k, avg_len, _, _ = prepare_features(sequences)

    # Compute distance matrix — use Euclidean for structure-profile (matches profile_cluster._compute_cluster_metrics), cosine for k-mer
    from sklearn.metrics.pairwise import cosine_distances, euclidean_distances
    if feature_mode == 'structure-profile':
        dist_matrix = euclidean_distances(X)
    else:
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
    # Preserve input order (sorted by Z-score in frontend) — do NOT sort
    unique_clusters = list(dict.fromkeys(cluster_ids))
    num_clusters = len(unique_clusters)

    if num_clusters < 2:
        return {'success': True, 'matrix': [[0]], 'clusterIds': unique_clusters, 'n': n}

    X, k, avg_len, _, _ = prepare_features(sequences, standardize=False)

    # Compute full pairwise distance matrix on raw k-mer frequencies (cosine distance ∈ [0,1])
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
                                min_clusters: int = 2,
                                forward_primer: str = None, reverse_primer: str = None,
                                structural_scores: list = None, feature_mode: str = 'auto',
                                do_permutation_test: bool = False, n_permutations: int = 1000,
                                selection_criterion: str = 'silhouette',
                                read_counts: list = None,
                                abundance_threshold: int = 0,
                                scan_k: bool = True) -> dict:
    """
    Compute optimal clustering using k-mer features + ML algorithms.
    Enhanced with GMM, Spectral Clustering.
    Optimized for speed: limited iterations, early termination.

    Methods: hierarchical, kmeans, gmm, spectral, auto (try all)
    selection_criterion: 'silhouette', 'davies_bouldin', or 'calinski_harabasz'

    Two-stage clustering (when read_counts + abundance_threshold provided):
      Phase 1: cluster high-abundance sequences (reads >= threshold)
      Phase 2: assign low-abundance sequences to nearest cluster centroid
    """
    from sklearn.cluster import AgglomerativeClustering, KMeans, SpectralClustering
    from sklearn.mixture import GaussianMixture
    from sklearn.metrics import silhouette_score, davies_bouldin_score, calinski_harabasz_score
    from sklearn.metrics.pairwise import cosine_distances

    n = len(sequences)
    if n < 3:
        return {'success': True, 'clusterIds': [1] * n, 'numClusters': 1, 'method': 'trivial', 'silhouetteScore': 0}

    # Only use kmer mode (hybrid needs structural scores from prior analysis)
    fm = 'kmer'
    if feature_mode == 'hybrid' and structural_scores and len(structural_scores) == n:
        fm = 'hybrid'

    # k-mer size scanning: try k=2,3,4 and select best silhouette
    k_candidates = [2, 3, 4] if scan_k else [None]
    # Filter k values that are feasible (k < min variable region length)
    avg_seq_len = sum(len(s) for s in sequences) / max(n, 1)
    k_candidates = [kc for kc in k_candidates if kc is None or kc <= avg_seq_len - 1]
    if not k_candidates:
        k_candidates = [None]

    # For single k, use as-is; for scan, pick best
    if len(k_candidates) == 1 and k_candidates[0] is None:
        X, k, avg_len, prefix_len, suffix_len = prepare_features(
            sequences, forward_primer, reverse_primer,
            structural_scores=structural_scores, feature_mode=fm
        )
        dist_matrix = cosine_distances(X)
        print(f'[OptimalCluster] n={n}, features={X.shape[1]}, k={k}, mode={fm}, criterion={selection_criterion}', flush=True)
    else:
        # k-scanning: try each k, run quick silhouette eval for all methods at K=5,10
        best_k_scan = None
        best_k_score = -float('inf')
        for k_try in k_candidates:
            X_try, _, avg_len_try, prefix_len_try, suffix_len_try = prepare_features(
                sequences, forward_primer, reverse_primer,
                structural_scores=structural_scores, feature_mode=fm,
                k_override=k_try
            )
            dist_try = cosine_distances(X_try)
            # Quick eval: hierarchical at K=5 and K=10
            quick_score = -float('inf')
            for quick_k in [5, 10, 15]:
                if quick_k >= n or quick_k > max_clusters:
                    continue
                try:
                    agg = AgglomerativeClustering(n_clusters=quick_k, metric='precomputed', linkage='average')
                    lbs = agg.fit_predict(dist_try)
                    if len(set(lbs)) >= 2:
                        s = silhouette_score(dist_try, lbs, metric='precomputed')
                        if s > quick_score:
                            quick_score = s
                except Exception:
                    pass
            print(f'[OptimalCluster] k-scan: k={k_try}, quick_silhouette={quick_score:.4f}', flush=True)
            if quick_score > best_k_score:
                best_k_score = quick_score
                best_k_scan = k_try
        # Use best k
        X, k, avg_len, prefix_len, suffix_len = prepare_features(
            sequences, forward_primer, reverse_primer,
            structural_scores=structural_scores, feature_mode=fm,
            k_override=best_k_scan
        )
        dist_matrix = cosine_distances(X)
        print(f'[OptimalCluster] k-scan: selected k={k}, features={X.shape[1]}, mode={fm}', flush=True)

    print(f'[OptimalCluster] n={n}, features={X.shape[1]}, mode={fm}, criterion={selection_criterion}', flush=True)

    # === Two-stage clustering: high-abundance anchors + low-abundance assignment ===
    low_indices = []
    high_indices = list(range(n))
    X_full = X
    sequences_full = sequences
    n_full = n

    if read_counts and abundance_threshold > 0 and len(read_counts) == n:
        rc = np.array(read_counts, dtype=float)
        threshold_val = abundance_threshold
        # If threshold is between 0 and 1, treat as percentile (e.g. 0.5 = top 50%)
        if 0 < abundance_threshold < 1:
            threshold_val = float(np.percentile(rc, (1 - abundance_threshold) * 100))
        high_mask = rc >= threshold_val
        low_mask = ~high_mask
        high_indices = list(np.where(high_mask)[0])
        low_indices = list(np.where(low_mask)[0])
        n_high = len(high_indices)
        n_low = len(low_indices)
        print(f'[OptimalCluster] Two-stage: threshold={threshold_val:.1f}, high={n_high}, low={n_low}', flush=True)

        if n_high >= 3:
            # Phase 1: cluster only high-abundance
            X = X_full[high_indices]
            n = n_high
            sequences = [sequences_full[i] for i in high_indices]
            dist_matrix = cosine_distances(X)
        else:
            print(f'[OptimalCluster] Too few high-abundance ({n_high}), falling back to full clustering', flush=True)
            abundance_threshold = 0  # disable two-stage

    # Scoring helper: higher = better for all criteria
    def _eval_score(labels_arr):
        if len(set(labels_arr)) < 2:
            return -float('inf')
        if selection_criterion == 'davies_bouldin':
            try:
                db = davies_bouldin_score(X, labels_arr)
                return -db  # negate: lower DB = higher score
            except Exception:
                return -float('inf')
        elif selection_criterion == 'calinski_harabasz':
            try:
                return calinski_harabasz_score(X, labels_arr)
            except Exception:
                return -float('inf')
        else:  # silhouette (default)
            return silhouette_score(dist_matrix, labels_arr, metric='precomputed')

    # Collect all (method, K, score) for algorithm selection visualization
    algo_results = []

    methods_to_try = []
    if method == 'auto':
        methods_to_try = ['hierarchical', 'kmeans', 'gmm', 'spectral']
    else:
        methods_to_try = [method]

    max_k = min(max_clusters, n // 5, 50)
    max_k = max(max_k, min_clusters, 2)

    # Coarse K candidates (limited for speed)
    all_ks = [2, 3, 4, 5, 7, 10, 15, 20]
    coarse_ks = sorted(set([ck for ck in all_ks if min_clusters <= ck <= max_k]))
    if not coarse_ks:
        coarse_ks = [min_clusters]
    if max_k not in coarse_ks:
        coarse_ks.append(max_k)

    best_labels = None
    best_score = -float('inf')
    best_method = ''
    best_k = 0

    def try_clustering(labels_arr, method_name, num_k):
        """Helper: evaluate and update best if improved."""
        nonlocal best_labels, best_score, best_method, best_k
        score = _eval_score(labels_arr)
        if score > -float('inf'):
            algo_results.append({'method': method_name, 'K': num_k, 'silhouette': float(score)})
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
                coarse_best_score = -float('inf')
                for num_k in coarse_ks:
                    agg = AgglomerativeClustering(
                        n_clusters=num_k, metric='precomputed', linkage='average'
                    )
                    labels = agg.fit_predict(dist_matrix)
                    if len(set(labels)) < 2:
                        continue
                    score = _eval_score(labels)
                    if score > -float('inf'):
                        algo_results.append({'method': 'hierarchical', 'K': num_k, 'silhouette': float(score)})
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

                # Also try ward (euclidean) — full K sweep as robustness check
                for num_k in coarse_ks:
                    try:
                        agg = AgglomerativeClustering(n_clusters=num_k, linkage='ward')
                        labels = agg.fit_predict(X)
                        if len(set(labels)) < 2:
                            continue
                        try_clustering(labels, 'hierarchical_ward', num_k)
                    except Exception:
                        pass

            elif m == 'kmeans':
                coarse_best_k = 2
                coarse_best_score = -float('inf')
                for num_k in coarse_ks:
                    km = KMeans(n_clusters=num_k, random_state=42, n_init=5, max_iter=150)
                    labels = km.fit_predict(X)
                    if len(set(labels)) < 2:
                        continue
                    score = _eval_score(labels)
                    if score > -float('inf'):
                        algo_results.append({'method': 'kmeans', 'K': num_k, 'silhouette': float(score)})
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
                for num_k in coarse_ks:  # Full K sweep (perf cost acceptable)
                    try:
                        gmm = GaussianMixture(
                            n_components=num_k, covariance_type='full',
                            random_state=42, max_iter=100, n_init=2,
                        )
                        labels = gmm.fit_predict(X)
                        if len(set(labels)) < 2:
                            continue
                        score = _eval_score(labels)
                        if score > -float('inf'):
                            algo_results.append({'method': 'gmm', 'K': num_k, 'silhouette': float(score)})
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
                # Spectral — RBF kernel from cosine distance
                # sigma = median pairwise distance (robust auto-estimate)
                flat_d = dist_matrix[dist_matrix > 0] if np.any(dist_matrix > 0) else np.array([1.0])
                sigma = float(np.median(flat_d)) if len(flat_d) > 0 else 1.0
                sigma = max(sigma, 0.01)  # floor to avoid division by zero
                affinity_matrix = np.exp(-dist_matrix ** 2 / (2 * sigma ** 2))
                np.fill_diagonal(affinity_matrix, 1)

                for num_k in coarse_ks:
                    try:
                        spec = SpectralClustering(
                            n_clusters=num_k, affinity='precomputed',
                            random_state=42, n_init=3, assign_labels='kmeans',
                        )
                        labels = spec.fit_predict(affinity_matrix)
                        try_clustering(labels, 'spectral', num_k)
                    except Exception:
                        continue
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
    # Silhouette [-1,1]: strong≥0.5, moderate≥0.25
    # Davies-Bouldin [0,inf): -DB [-inf,0]: strong> -1, moderate> -2
    # Calinski-Harabasz [0,inf): strong> 10, moderate> 5 (dataset-dependent)
    if selection_criterion == 'davies_bouldin':
        if best_score > -1.0: quality = 'strong'
        elif best_score > -2.0: quality = 'moderate'
        else: quality = 'weak'
    elif selection_criterion == 'calinski_harabasz':
        if best_score > 10: quality = 'strong'
        elif best_score > 5: quality = 'moderate'
        else: quality = 'weak'
    else:  # silhouette
        if best_score >= 0.5: quality = 'strong'
        elif best_score >= 0.25: quality = 'moderate'
        else: quality = 'weak'

    print(f'[OptimalCluster] Best: method={best_method}, K={best_k}, silhouette={best_score:.4f}, quality={quality}, features={fm}', flush=True)

    result = {
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

    # === Phase 2: assign low-abundance sequences to nearest cluster centroid ===
    if low_indices:
        print(f'[OptimalCluster] Phase 2: assigning {len(low_indices)} low-abundance sequences', flush=True)
        # Compute cluster centroids from Phase 1 in full feature space
        centroids = {}
        for lbl in set(best_labels):
            mask = best_labels == lbl
            centroids[lbl] = X_full[high_indices][mask].mean(axis=0)

        # Assign each low-abundance sequence to nearest centroid
        low_labels = []
        for idx in low_indices:
            seq_vec = X_full[idx]
            best_lbl = min(centroids.keys(),
                           key=lambda c: float(cosine_distances([seq_vec], [centroids[c]])[0][0]))
            low_labels.append(best_lbl)

        # Remap low labels through the same label_map
        low_final_ids = [label_map[int(l)] for l in low_labels]

        # Reconstruct full final_ids (high + low in original order)
        full_ids = [None] * n_full
        for i, hidx in enumerate(high_indices):
            full_ids[hidx] = final_ids[i]
        for i, lidx in enumerate(low_indices):
            full_ids[lidx] = low_final_ids[i]

        result['clusterIds'] = full_ids
        result['n'] = n_full
        result['nHighAbundance'] = len(high_indices)
        result['nLowAbundance'] = len(low_indices)
        result['abundanceThreshold'] = abundance_threshold
        if 0 < abundance_threshold < 1:
            result['abundanceThresholdValue'] = int(np.percentile(np.array(read_counts), (1 - abundance_threshold) * 100))

    # Permutation test on k-mer features
    # Use size-sorted labels so permutation arrays match enrichment_scores ordering
    if do_permutation_test and best_k > 1:
        try:
            remapped_labels = np.array([label_map[int(l)] for l in best_labels])
            perm = permutation_test(X, remapped_labels, n_perm=n_permutations)
            result['permutation'] = perm
            result['nPermutations'] = n_permutations
        except Exception as e:
            print(f'[OptimalCluster] Permutation test failed: {e}', flush=True)

    # Abundance modeling: cluster-level enrichment scores (post-clustering, no weighting bias)
    if read_counts and len(read_counts) == n_full:
        try:
            cluster_ids = result['clusterIds']
            ab = fit_abundance_model(read_counts, cluster_ids)
            result['abundance'] = ab
            print(f'[OptimalCluster] Abundance model: {len(ab["enrichment_scores"])} clusters, NB(mu={ab["parameters"]["mu"]}, r={ab["parameters"]["r"]})', flush=True)
        except Exception as e:
            print(f'[OptimalCluster] Abundance model failed: {e}', flush=True)

    result['algorithmResults'] = algo_results
    return result


class AnalysisHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/health' or self.path == '/':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({
                'status': 'ok',
                'engine': 'Cluster Analysis (scikit-learn + UMAP + GMM)',
                'endpoints': ['/tsne', '/umap', '/pca', '/silhouette', '/distance_matrix', '/optimal_cluster', '/profile_cluster'],
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
            '/profile_cluster': self.handle_profile_cluster,
            '/cluster_permutation': self.handle_cluster_permutation,
            '/network_graph': self.handle_network_graph,
        }

        handler = handlers.get(self.path)

        # === Special case: /enrich_analyze receives rounds, not sequences ===
        if self.path == '/enrich_analyze':
            try:
                data = json.loads(body)
                result = self.handle_enrich_analyze(data)
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
            return

        # === Special case: /cluster-bubble receives clusters, not sequences ===
        if self.path == '/cluster-bubble':
            try:
                data = json.loads(body)
                result = self.handle_cluster_bubble(data)
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
            return

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
        feature_mode = data.get('featureMode', 'kmer')
        read_counts = data.get('readCounts', None)
        return compute_tsne(sequences, cluster_ids, perplexity, feature_mode=feature_mode, read_counts=read_counts)

    def handle_umap(self, sequences, cluster_ids, data):
        feature_mode = data.get('featureMode', 'kmer')
        read_counts = data.get('readCounts', None)
        return compute_umap(sequences, cluster_ids, feature_mode=feature_mode, read_counts=read_counts)

    def handle_pca(self, sequences, cluster_ids, data):
        feature_mode = data.get('featureMode', 'kmer')
        return compute_pca(sequences, cluster_ids, feature_mode=feature_mode)

    def handle_silhouette(self, sequences, cluster_ids, data):
        feature_mode = data.get('featureMode', 'kmer')
        return compute_silhouette(sequences, cluster_ids, feature_mode=feature_mode)

    def handle_distance_matrix(self, sequences, cluster_ids, data):
        return compute_distance_matrix(sequences, cluster_ids)

    def handle_optimal_cluster(self, sequences, cluster_ids, data):
        method = data.get('method', 'auto')
        max_clusters = data.get('maxClusters', 30)
        min_clusters = data.get('minClusters', 2)
        forward_primer = data.get('forwardPrimer', None)
        reverse_primer = data.get('reversePrimer', None)
        structural_scores = data.get('structuralScores', None)
        feature_mode = data.get('featureMode', 'auto')
        do_perm = data.get('doPermutationTest', False)
        n_perm = data.get('nPermutations', 200)
        selection_criterion = data.get('selectionCriterion', 'silhouette')
        read_counts = data.get('readCounts', None)
        abundance_threshold = data.get('abundanceThreshold', 0)
        use_abundance_weight = data.get('useAbundanceWeight', False)
        weighting_scheme = data.get('weightingScheme', 'off')
        return compute_optimal_clustering(sequences, method, max_clusters,
                                          min_clusters,
                                          forward_primer, reverse_primer,
                                          structural_scores, feature_mode,
                                          do_permutation_test=do_perm,
                                          n_permutations=n_perm,
                                          selection_criterion=selection_criterion,
                                          read_counts=read_counts,
                                          abundance_threshold=abundance_threshold)

    def handle_profile_cluster(self, sequences, cluster_ids, data):
        """Structure Profile clustering with permutation test + abundance modeling."""
        dot_brackets = data.get('dotBrackets', None)
        read_counts = data.get('readCounts', None)
        max_clusters = data.get('maxClusters', 30)
        n_permutations = data.get('nPermutations', 1000)
        significance_threshold = data.get('significanceThreshold', 0.05)
        do_permutation = data.get('doPermutationTest', True)
        do_abundance = data.get('doAbundanceModel', True)
        selection_criterion = data.get('selectionCriterion', 'davies_bouldin')
        abundance_threshold = data.get('abundanceThreshold', 0)
        use_abundance_weight = data.get('useAbundanceWeight', False)
        weighting_scheme = data.get('weightingScheme', 'off')

        # 如果没有提供 dot-brackets，通过 ViennaRNA 微服务预测
        if not dot_brackets:
            import urllib.request
            req = urllib.request.Request(
                'http://localhost:4001/fold',
                data=json.dumps({'sequences': sequences, 'gquad': True}).encode(),
                headers={'Content-Type': 'application/json'}
            )
            try:
                resp = urllib.request.urlopen(req, timeout=5)
                fold_result = json.loads(resp.read())
                dot_brackets = [r.get('dotBracket', '.' * len(s)) for r, s in zip(fold_result.get('data', fold_result.get('results', [])), sequences)]
            except Exception:
                # Fallback: all unpaired (fast path)
                dot_brackets = ['.' * len(s) for s in sequences]

        # Cache dot-brackets for downstream silhouette/tsne
        for seq, db in zip(sequences, dot_brackets):
            _DOTBRACKET_CACHE[seq] = db

        result = cluster_by_profile(
            sequences=sequences,
            dot_brackets=dot_brackets,
            read_counts=read_counts,
            max_clusters=max_clusters,
            n_permutations=n_permutations,
            significance_threshold=significance_threshold,
            do_permutation_test=do_permutation,
            do_abundance_model=do_abundance,
            selection_criterion=selection_criterion,
            abundance_threshold=abundance_threshold,
            use_abundance_weight=use_abundance_weight,
            weighting_scheme=weighting_scheme,
        )
        # Remove debug-only field that causes JSON circular refs
        result.pop('all_results', None)
        return result

    def handle_cluster_permutation(self, sequences, cluster_ids, data):
        """General permutation test for any pre-computed clustering.
        Works with sequence mode (k-mer features) or structure mode (dot-bracket features).
        """
        from profile_cluster import permutation_test
        n_perm = data.get('nPermutations', 1000)
        feature_mode = data.get('featureMode', 'kmer')
        dot_brackets = data.get('dotBrackets', None)

        labels = cluster_ids
        if len(set(labels)) < 2:
            return {'success': True, 'permutation': {
                'p_values': [1.0], 'significant': [False],
                'cluster_sizes': [len(sequences)], 'threshold': 0.05
            }}

        # Extract features
        if feature_mode == 'structure' and dot_brackets and len(dot_brackets) == len(sequences):
            from profile_cluster import extract_profile_features
            X = extract_profile_features(dot_brackets)
            k = 0
        else:
            X, k, _, _, _ = prepare_features(sequences)

        labels_arr = np.array(labels)
        perm = permutation_test(X, labels_arr, n_perm=n_perm)

        return {
            'success': True,
            'permutation': perm,
            'kmerSize': k,
            'nPermutations': n_perm,
        }

    def handle_network_graph(self, sequences, cluster_ids, data):
        """Generate network graph data for Cytoscape-style visualization.
        
        Computes pairwise cosine similarity. Supports two feature modes:
        - structure-profile (default): cosine on 48-dim structure profile vectors
        - kmer: cosine on k-mer frequency vectors
        
        Returns nodes (with cluster, sequence, read count) and
        edges (with similarity weight) above a configurable threshold.
        """
        from profile_cluster import extract_profile_features
        from sklearn.metrics.pairwise import cosine_similarity
        
        dot_brackets = data.get('dotBrackets', None)
        read_counts = data.get('readCounts', None)
        similarity_threshold = data.get('similarityThreshold', 0.7)
        max_edges_per_node = data.get('maxEdgesPerNode', 8)
        max_nodes = data.get('maxNodes', 2000)
        max_per_cluster = data.get('maxPerCluster', 200)
        layout_mode = data.get('layoutMode', 'force')  # 'force' | 'mds'
        feature_mode = data.get('featureMode', 'kmer')
        # Normalize legacy/alias feature modes to canonical values
        if feature_mode in ('auto', 'levenshtein', 'sequence'):
            feature_mode = 'kmer'
        elif feature_mode in ('dot-bracket', 'structure'):
            feature_mode = 'structure-profile'

        n = len(sequences)

        # ── Per-cluster balanced subsampling ──
        # Global top-N unfairly favors large clusters. Instead, cap each
        # cluster at max_per_cluster nodes (top by read count), then apply
        # the global max_nodes cap across clusters proportionally.
        if read_counts and len(read_counts) == n:
            # Group indices by cluster
            cluster_groups = {}
            for i, cid in enumerate(cluster_ids):
                cluster_groups.setdefault(int(cid), []).append(i)

            # Per cluster: sort by read count desc, take top max_per_cluster
            selected = []
            for cid, idxs in cluster_groups.items():
                idxs.sort(key=lambda i: read_counts[i], reverse=True)
                selected.extend(idxs[:max_per_cluster])

            # Global cap: if still too many, take top by read count across clusters
            if len(selected) > max_nodes:
                selected.sort(key=lambda i: read_counts[i], reverse=True)
                selected = selected[:max_nodes]

            selected.sort()  # preserve original order for dot_brackets alignment
            indices = selected
        else:
            # No read counts — uniform per-cluster subsample
            cluster_groups = {}
            for i, cid in enumerate(cluster_ids):
                cluster_groups.setdefault(int(cid), []).append(i)
            selected = []
            for cid, idxs in cluster_groups.items():
                step = max(1, len(idxs) // max_per_cluster) if len(idxs) > max_per_cluster else 1
                selected.extend(idxs[:max_per_cluster * step:step])
            if len(selected) > max_nodes:
                step = max(1, len(selected) // max_nodes)
                selected = selected[::step][:max_nodes]
            selected.sort()
            indices = selected

        sequences = [sequences[i] for i in indices]
        cluster_ids = [cluster_ids[i] for i in indices]
        if dot_brackets:
            dot_brackets = [dot_brackets[i] for i in indices]
        if read_counts:
            read_counts = [read_counts[i] for i in indices]
        n = len(sequences)
        
        # Get or compute features based on mode
        if feature_mode == 'kmer':
            # Use k-mer frequency vectors
            X, k, _, _, _ = prepare_features(sequences)
        else:
            # Structure profile (default)
            # Get or compute structure profile features
            if dot_brackets and len(dot_brackets) == n:
                dbs = dot_brackets
            else:
                # Try cache
                dbs = [_DOTBRACKET_CACHE.get(s, None) for s in sequences]
                if not all(d is not None for d in dbs):
                    import urllib.request
                    try:
                        req = urllib.request.Request(
                            'http://localhost:4001/fold',
                            data=json.dumps({'sequences': sequences, 'gquad': True}).encode(),
                            headers={'Content-Type': 'application/json'}
                        )
                        resp = urllib.request.urlopen(req, timeout=10)
                        fold_result = json.loads(resp.read())
                        fold_data = fold_result.get('data', fold_result.get('results', []))
                        dbs = [r.get('dotBracket', '.' * len(s)) for r, s in zip(fold_data, sequences)]
                    except Exception:
                        dbs = ['.' * len(s) for s in sequences]
        
            X = extract_profile_features(dbs)
        
        # Compute pairwise cosine similarity
        sim = cosine_similarity(X)

        # ── MDS layout (optional, alternative to force-directed) ──
        mds_positions = None
        if layout_mode == 'mds' and n >= 3:
            # Classical MDS: eigendecomposition of centered distance matrix
            D = 1.0 - np.clip(sim, -1, 1)  # cosine distance
            D = (D + D.T) / 2  # symmetrize
            # Double-center: B = -0.5 * J * D^2 * J
            n_mat = D.shape[0]
            H = np.eye(n_mat) - np.ones((n_mat, n_mat)) / n_mat
            B = -0.5 * H @ (D * D) @ H
            # Eigendecomposition
            eigvals, eigvecs = np.linalg.eigh(B)
            # Take top 2 positive eigenvalues
            idx = np.argsort(eigvals)[::-1][:2]
            eigvals_top = eigvals[idx]
            eigvecs_top = eigvecs[:, idx]
            # Only use positive eigenvalues
            valid = eigvals_top > 1e-10
            if valid.sum() >= 2:
                coords = eigvecs_top[:, :2] * np.sqrt(np.maximum(eigvals_top[:2], 0))
                # Normalize to fit canvas
                coords[:, 0] -= coords[:, 0].mean()
                coords[:, 1] -= coords[:, 1].mean()
                scale = max(np.abs(coords).max(), 1)
                coords /= scale * 0.4  # fit within ~40% of canvas
                coords += 0.5  # center
                mds_positions = [
                    {'x': float(coords[i, 0]), 'y': float(coords[i, 1])}
                    for i in range(n)
                ]
                print(f'[NetworkGraph] MDS layout computed: {n} nodes', flush=True)
            else:
                print(f'[NetworkGraph] MDS skipped: degenerate eigenvalues', flush=True)
        
        # Build nodes
        nodes = []
        for i in range(n):
            nodes.append({
                'id': i,
                'clusterId': int(cluster_ids[i]) if cluster_ids[i] is not None else -1,
                'sequence': sequences[i][:40] + ('...' if len(sequences[i]) > 40 else ''),
                'count': int(read_counts[i]) if read_counts and i < len(read_counts) else 1,
            })
        
        # Build edges: for each node, keep top max_edges_per_node above threshold
        edges = []
        edge_set = set()
        for i in range(n):
            # Get similarities to all other nodes
            sims = [(j, sim[i, j]) for j in range(n) if j != i and sim[i, j] >= similarity_threshold]
            # Sort by similarity descending, keep top K
            sims.sort(key=lambda x: x[1], reverse=True)
            for j, s in sims[:max_edges_per_node]:
                edge_key = (min(i, j), max(i, j))
                if edge_key not in edge_set:
                    edge_set.add(edge_key)
                    edges.append({
                        'source': i,
                        'target': j,
                        'similarity': float(round(s, 4)),
                    })
        
        # Stats
        total_possible = n * (n - 1) // 2
        edge_count = len(edges)
        
        return {
            'success': True,
            'nodes': nodes,
            'edges': edges,
            'mdsPositions': mds_positions,
            'stats': {
                'nodeCount': n,
                'edgeCount': edge_count,
                'density': float(round(edge_count / max(total_possible, 1), 6)),
                'threshold': similarity_threshold,
                'featureMode': feature_mode,
            },
        }

    def handle_cluster_bubble(self, data):
        """Generate bubble chart data from cluster metadata.
        Receives: { clusters: [{id, size, avgMaxPercentRead, g4Risk, g4Motifs}, ...] }
        Returns: { success, data: [{cluster_id, size, enrichment, g4_risk, label}, ...] }"""
        clusters = data.get('clusters', [])
        bubbles = []
        for c in clusters:
            size = c.get('size', 0)
            g4_risk = c.get('g4Risk', 'Low')
            enrichment = c.get('avgMaxPercentRead', 0)

            # Build label: "Cluster N (S members, G4 risk, MOTIF motif)"
            cid = c.get('id', '?')
            label = f"Cluster {cid} ({size} members, {g4_risk} G4"
            motifs = c.get('g4Motifs', [])
            if motifs and len(motifs) > 0:
                m = motifs[0]
                motif_str = m.get('motif', '') if isinstance(m, dict) else str(m)
                if motif_str:
                    label += f", {motif_str} motif"
            label += ')'

            bubbles.append({
                'cluster_id': cid,
                'size': size,
                'enrichment': enrichment,
                'g4_risk': g4_risk,
                'label': label,
            })
        return {'success': True, 'data': bubbles}

    def handle_enrich_analyze(self, data):
        """
        Cross-round enrichment analysis.
        Receives: { rounds: [{ label, sequences, readCounts }, ...], method, maxClusters, ... }
        Returns: clustering result + per-cluster foldChange + direction
        """
        rounds = data.get('rounds', [])
        if len(rounds) < 2:
            return {'success': False, 'message': 'At least 2 rounds required'}

        # Step 1: Merge
        merged = merge_cross_round_data(rounds)
        sequences = merged['sequences']
        total_reads = merged['totalReads']
        print(f'[EnrichAnalyze] Merged {len(sequences)} unique sequences across {len(rounds)} rounds', flush=True)

        if len(sequences) < 3:
            return {'success': False, 'message': 'Need at least 3 unique sequences after merge'}

        # Step 1.5: TopN truncation (prevent OOM from large distance matrix)
        top_n = data.get('topN', 500)
        if len(sequences) > top_n:
            # Sort by totalReads descending and take top N
            indices = sorted(range(len(sequences)), key=lambda i: total_reads[i], reverse=True)[:top_n]
            sequences = [sequences[i] for i in indices]
            total_reads = [total_reads[i] for i in indices]
            merged['roundReads'] = [merged['roundReads'][i] for i in indices]
            print(f'[EnrichAnalyze] Truncated to top {top_n} by totalReads', flush=True)

        # Step 2: Cluster (reuse optimal_clustering)
        result = compute_optimal_clustering(
            sequences,
            method=data.get('method', 'auto'),
            max_clusters=data.get('maxClusters', 30),
            min_clusters=data.get('minClusters', 2),
            read_counts=total_reads,
            abundance_threshold=data.get('abundanceThreshold', 0),
            do_permutation_test=data.get('doPermutationTest', True),
            n_permutations=data.get('nPermutations', 1000),
            selection_criterion=data.get('selectionCriterion', 'silhouette'),
        )

        if not result.get('success'):
            return {'success': False, 'message': 'Clustering failed: ' + result.get('message', 'unknown')}

        # Step 3: Enrichment (fold-change + direction)
        enrichment = compute_cluster_enrichment(result['clusterIds'], merged)

        return {
            'success': True,
            'clusterIds': result['clusterIds'],
            'sequences': sequences,
            'numClusters': result['numClusters'],
            'method': result['method'],
            'silhouetteScore': result.get('silhouetteScore', 0),
            'quality': result.get('quality', 'weak'),
            'featureMode': result.get('featureMode', 'kmer'),
            'variableLen': result.get('variableLen', 0),
            'enrichment': enrichment,
            'roundLabels': merged['roundLabels'],
            'n': len(sequences),
        }

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
    print(f'Methods: hierarchical, kmeans, gmm, spectral', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
        sys.exit(0)
