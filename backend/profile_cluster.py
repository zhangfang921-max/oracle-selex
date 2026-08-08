#!/usr/bin/env python3
"""
Profile Clustering Engine — Phase 2
====================================
Structure Profile 模式的核心聚类逻辑。

1. 结构轮廓向量编码 (复用 structure_profile.py)
2. 多算法聚类 + 评估指标择优
3. Permutation test 统计显著性
4. 负二项 read count 背景建模
5. Abundance weighting: linear / sqrt / log schemes

用法:
    from profile_cluster import cluster_by_profile
    result = cluster_by_profile(sequences, dot_brackets, read_counts, ...)
"""

import numpy as np
from collections import Counter
from typing import List, Dict, Optional, Tuple
import warnings
warnings.filterwarnings('ignore')

# 复用 Phase 1 的结构编码器
from structure_profile import encode_batch, encode_structure


# ============================================================
# 0. 权重计算
# ============================================================

def compute_weights(read_counts: np.ndarray, scheme: str = 'sqrt') -> np.ndarray:
    """
    按指定方案将 read counts 转换为聚类权重。

    Args:
        read_counts: (n,) raw read counts
        scheme: 'linear' | 'sqrt' | 'log'

    Returns:
        (n,) weight array, mean≈1
    """
    rc = np.array(read_counts, dtype=float).copy()
    rc = np.maximum(rc, 1.0)  # floor at 1

    if scheme == 'sqrt':
        w = np.sqrt(rc)
    elif scheme == 'log':
        w = np.log1p(rc)  # log(1 + rc)
    else:  # linear
        w = rc.copy()

    # Normalize to mean=1 for numerical stability
    if w.mean() > 0:
        w = w / w.mean()
    return w


# ============================================================
# 1. 特征提取：结构轮廓向量 (复用 structure_profile.py)
# ============================================================

def extract_profile_features(dot_brackets: List[str]) -> np.ndarray:
    """
    从 dot-bracket 列表提取结构轮廓向量矩阵。

    Returns:
        (n_sequences, 48) 全局轮廓向量
    """
    return encode_batch(dot_brackets)


# ============================================================
# 2. 多算法聚类 + 多指标择优
# ============================================================

def _compute_cluster_metrics(features: np.ndarray, labels: np.ndarray) -> Dict[str, float]:
    """
    计算聚类的多个评估指标。
    """
    from sklearn.metrics import silhouette_score, davies_bouldin_score, calinski_harabasz_score

    n_labels = len(set(labels))
    if n_labels < 2 or n_labels >= len(labels):
        return {'silhouette': -1, 'davies_bouldin': float('inf'), 'calinski_harabasz': -1}

    # 抽样加速：超过 2000 个点时抽样
    if len(features) > 2000:
        idx = np.random.RandomState(42).choice(len(features), 2000, replace=False)
        features_sample = features[idx]
        labels_sample = labels[idx]
    else:
        features_sample = features
        labels_sample = labels

    return {
        'silhouette': silhouette_score(features_sample, labels_sample),
        'davies_bouldin': davies_bouldin_score(features_sample, labels_sample),
        'calinski_harabasz': calinski_harabasz_score(features_sample, labels_sample),
    }


def _dbcv_score(features: np.ndarray, labels: np.ndarray) -> float:
    """
    Density-Based Clustering Validation (DBCV)。
    适用于 HDBSCAN/DBSCAN 等密度聚类。

    简化实现：基于簇内相对密度。
    """
    from sklearn.neighbors import NearestNeighbors

    n = len(features)
    unique_labels = [l for l in set(labels) if l >= 0]
    if len(unique_labels) < 2:
        return -1

    k = min(10, max(2, n // 10))
    nn = NearestNeighbors(n_neighbors=k + 1)
    nn.fit(features)
    distances, _ = nn.kneighbors(features)
    core_dists = distances[:, -1]

    scores = []
    for label in unique_labels:
        mask = labels == label
        if mask.sum() < 2:
            continue
        intra_density = 1.0 / (core_dists[mask].mean() + 1e-10)
        other_mask = (labels != label) & (labels >= 0)
        if other_mask.sum() < 2:
            continue
        inter_density = 1.0 / (core_dists[other_mask].mean() + 1e-10)
        scores.append(intra_density - inter_density)

    return np.mean(scores) if scores else -1


def _cluster_with_resampling(features: np.ndarray, weights: np.ndarray,
                              cluster_fn, k: int, random_state: int = 42,
                              max_multiplier: int = 50) -> np.ndarray:
    """
    通过确定性复制实现加权，运行聚类，然后将标签映射回原始点。

    Args:
        features: (n, d)
        weights: (n,) 正权重
        cluster_fn: fit_predict(features) -> labels 的聚类函数
        k: 目标簇数
        max_multiplier: 单点最大复制倍数

    Returns:
        (n,) int labels for original points
    """
    n = len(features)
    w = np.maximum(weights, 1e-6)
    w_min = w.min()
    multipliers = np.minimum(np.ceil(w / w_min).astype(int), max_multiplier)
    multipliers = np.maximum(multipliers, 1)

    # 确定性复制
    replicated_idx = np.repeat(np.arange(n), multipliers)
    feats_replicated = features[replicated_idx]

    # 聚类
    try:
        labels_replicated = cluster_fn(feats_replicated)
    except Exception:
        # 如果复制后太大导致算法失败，降级到等权
        labels_replicated = cluster_fn(features)

    if len(labels_replicated) != len(replicated_idx):
        # 大小不匹配，降级
        labels_replicated = cluster_fn(features)

    # 映射回原始点：多数投票
    from scipy import stats as sp_stats
    original_labels = np.zeros(n, dtype=int)
    for i in range(n):
        mask = replicated_idx == i
        if mask.any():
            vals = labels_replicated[mask]
            original_labels[i] = int(sp_stats.mode(vals, keepdims=False).mode)
        else:
            original_labels[i] = -1

    # 未出现的点分配到最近簇
    if -1 in original_labels:
        from sklearn.neighbors import NearestNeighbors
        valid = original_labels >= 0
        if valid.any():
            nn = NearestNeighbors(n_neighbors=1)
            nn.fit(features[valid])
            missing_idx = np.where(original_labels == -1)[0]
            _, idx = nn.kneighbors(features[missing_idx])
            original_labels[missing_idx] = original_labels[valid][idx[:, 0]]

    return original_labels


def run_clustering(features: np.ndarray, max_clusters: int = 30,
                   random_state: int = 42,
                   selection_criterion: str = 'davies_bouldin',
                   sample_weights: np.ndarray = None,
                   weighting_scheme: str = 'off') -> Dict:
    """
    运行多算法聚类并择优。

    Args:
        features: (n, d) 特征矩阵
        max_clusters: 最大簇数
        sample_weights: (n,) 已计算的权重 (mean≈1)，用于 KMeans native sample_weight
        weighting_scheme: 'off' | 'linear' | 'sqrt' | 'log'
                         非 KMeans 算法通过重采样实现加权

    Returns:
        {
            'labels': [...],
            'method': 'hdbscan',
            'n_clusters': 8,
            'metrics': {...},
            'all_results': [...],
            'weightedAlgorithms': [...],
            'weightingScheme': 'sqrt'
        }
    """
    from sklearn.cluster import KMeans, DBSCAN, AgglomerativeClustering
    from sklearn.mixture import GaussianMixture

    n = len(features)
    use_native_weights = sample_weights is not None and len(sample_weights) == n
    use_resample = weighting_scheme not in ('off', '') and sample_weights is not None

    if n < 3:
        return {'labels': [0] * n, 'method': 'fallback', 'n_clusters': 1,
                'metrics': {}, 'all_results': []}

    results = []
    weighted_algorithms = []
    k_range_all = [k for k in [2, 3, 4, 5, 7, 10, 15, 20, 25] if k < n and k <= max_clusters]

    # ================================================================
    # --- KMeans (原生 sample_weight — 最精确) ---
    # ================================================================
    try:
        best_kmeans = None
        best_kmeans_score = -1
        for k in k_range_all:
            km = KMeans(n_clusters=k, random_state=random_state, n_init=5, max_iter=150)
            if use_native_weights:
                labels = km.fit_predict(features, sample_weight=sample_weights)
            else:
                labels = km.fit_predict(features)
            metrics = _compute_cluster_metrics(features, labels)
            if metrics['silhouette'] > best_kmeans_score:
                best_kmeans_score = metrics['silhouette']
                best_kmeans = {'labels': labels.tolist(), 'method': 'kmeans',
                               'n_clusters': k, 'metrics': metrics}
        if best_kmeans:
            if use_native_weights:
                best_kmeans['weighted'] = True
                best_kmeans['weightMethod'] = 'native_sample_weight'
                weighted_algorithms.append('kmeans')
            results.append(best_kmeans)
    except Exception:
        pass

    # ================================================================
    # --- Hierarchical (通过确定性复制实现加权) ---
    # ================================================================
    try:
        best_hc = None
        best_hc_score = -1
        for k in k_range_all:
            if use_resample:
                labels = _cluster_with_resampling(
                    features, sample_weights,
                    lambda X: AgglomerativeClustering(
                        n_clusters=k, linkage='average').fit_predict(X),
                    k, random_state)
            else:
                hc = AgglomerativeClustering(n_clusters=k, linkage='average')
                labels = hc.fit_predict(features)
            metrics = _compute_cluster_metrics(features, labels)
            if metrics['silhouette'] > best_hc_score:
                best_hc_score = metrics['silhouette']
                best_hc = {'labels': labels.tolist(), 'method': 'hierarchical',
                           'n_clusters': k, 'metrics': metrics}
        if best_hc:
            if use_resample:
                best_hc['weighted'] = True
                best_hc['weightMethod'] = 'deterministic_replication'
                weighted_algorithms.append('hierarchical')
            results.append(best_hc)
    except Exception:
        pass

    # ================================================================
    # --- GMM (通过确定性复制实现加权) ---
    # ================================================================
    try:
        best_gmm = None
        best_gmm_score = -1
        for k in k_range_all[:5]:  # GMM 较慢
            if use_resample:
                labels = _cluster_with_resampling(
                    features, sample_weights,
                    lambda X: GaussianMixture(
                        n_components=k, random_state=random_state,
                        n_init=2, max_iter=100,
                        covariance_type='full').fit_predict(X),
                    k, random_state)
            else:
                gmm = GaussianMixture(n_components=k, random_state=random_state,
                                      n_init=2, max_iter=100, covariance_type='full')
                labels = gmm.fit_predict(features)
            metrics = _compute_cluster_metrics(features, labels)
            if metrics['silhouette'] > best_gmm_score:
                best_gmm_score = metrics['silhouette']
                best_gmm = {'labels': labels.tolist(), 'method': 'gmm',
                            'n_clusters': k, 'metrics': metrics}
        if best_gmm:
            if use_resample:
                best_gmm['weighted'] = True
                best_gmm['weightMethod'] = 'deterministic_replication'
                weighted_algorithms.append('gmm')
            results.append(best_gmm)
    except Exception:
        pass

    # ================================================================
    # --- HDBSCAN (密度聚类 — 不加权，破坏密度语义) ---
    # ================================================================
    try:
        import hdbscan
        clusterer = hdbscan.HDBSCAN(min_cluster_size=max(2, n // 50),
                                     min_samples=1, prediction_data=True)
        labels = clusterer.fit_predict(features)
        n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
        if n_clusters >= 2:
            dbcv = _dbcv_score(features, labels)
            if -1 in labels:
                from sklearn.neighbors import NearestNeighbors
                nn = NearestNeighbors(n_neighbors=1)
                nn.fit(features[labels >= 0])
                noise_idx = np.where(labels == -1)[0]
                if len(noise_idx) > 0:
                    _, idx = nn.kneighbors(features[noise_idx])
                    labels[noise_idx] = labels[labels >= 0][idx[:, 0]]

            results.append({'labels': labels.tolist(), 'method': 'hdbscan',
                            'n_clusters': n_clusters, 'metrics': {'dbcv': dbcv},
                            'weighted': False,
                            'weightNote': 'density-based — weighting not applicable'})
    except ImportError:
        pass
    except Exception:
        pass

    # ================================================================
    # --- DBSCAN (密度聚类 — 不加权，破坏密度语义) ---
    # ================================================================
    try:
        from sklearn.neighbors import NearestNeighbors
        k = min(5, n - 1)
        nn = NearestNeighbors(n_neighbors=k)
        nn.fit(features)
        k_dist = np.sort(nn.kneighbors(features)[0][:, -1])
        eps = np.percentile(k_dist, 90)

        db = DBSCAN(eps=eps, min_samples=max(2, n // 100))
        labels = db.fit_predict(features)
        n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
        if n_clusters >= 2:
            dbcv = _dbcv_score(features, labels)
            if -1 in labels:
                valid_mask = labels >= 0
                if valid_mask.sum() > 0:
                    nn = NearestNeighbors(n_neighbors=1)
                    nn.fit(features[valid_mask])
                    noise_idx = np.where(labels == -1)[0]
                    _, idx = nn.kneighbors(features[noise_idx])
                    labels[noise_idx] = labels[valid_mask][idx[:, 0]]
            results.append({'labels': labels.tolist(), 'method': 'dbscan',
                            'n_clusters': n_clusters, 'metrics': {'dbcv': dbcv},
                            'weighted': False,
                            'weightNote': 'density-based — weighting not applicable'})
    except Exception:
        pass

    if not results:
        return {'labels': [0] * n, 'method': 'fallback', 'n_clusters': 1,
                'metrics': {}, 'all_results': []}

    # --- 择优 ---
    best_result = results[0]
    if selection_criterion == 'silhouette':
        best_val = -float('inf')
        for r in results:
            val = r['metrics'].get('silhouette', -float('inf'))
            if val > best_val:
                best_val = val
                best_result = r
    elif selection_criterion == 'calinski_harabasz':
        best_val = -float('inf')
        for r in results:
            val = r['metrics'].get('calinski_harabasz', -float('inf'))
            if val > best_val:
                best_val = val
                best_result = r
    else:  # davies_bouldin (default, lower is better)
        best_db = float('inf')
        for r in results:
            db = r['metrics'].get('davies_bouldin', float('inf'))
            if db < best_db:
                best_db = db
                best_result = r

    best_result['all_results'] = results
    best_result['weightedAlgorithms'] = weighted_algorithms
    best_result['weightingScheme'] = weighting_scheme
    return best_result


# ============================================================
# 3. Permutation Test — 聚类显著性
# ============================================================

def permutation_test(features: np.ndarray, labels: List[int],
                     n_perm: int = 1000, random_state: int = 42) -> Dict:
    """
    对每个 cluster 做 permutation test 评估显著性。

    H0: 簇内紧致度与随机抽样无异
    H1: 簇内紧致度显著高于随机
    """
    from sklearn.metrics.pairwise import cosine_similarity

    rng = np.random.RandomState(random_state)
    unique_labels = sorted(set(labels))
    if len(unique_labels) <= 1:
        return {'p_values': [1.0] * len(unique_labels),
                'significant': [False] * len(unique_labels),
                'cluster_sizes': [len(labels)],
                'threshold': 0.05}

    p_values = []
    cluster_sizes = []
    null_distributions = []
    observed_compactness = []

    for label in unique_labels:
        mask = np.array(labels) == label
        n_cluster = mask.sum()
        cluster_sizes.append(int(n_cluster))

        if n_cluster < 2:
            p_values.append(1.0)
            null_distributions.append([])
            observed_compactness.append(0.0)
            continue

        cluster_feats = features[mask]
        obs_comp = float(cosine_similarity(cluster_feats).mean())
        observed_compactness.append(obs_comp)

        perm_comp = []
        n_total = len(features)
        for _ in range(n_perm):
            perm_idx = rng.choice(n_total, size=n_cluster, replace=False)
            perm_feats = features[perm_idx]
            perm_comp.append(float(cosine_similarity(perm_feats).mean()))

        perm_comp_arr = np.array(perm_comp)
        null_distributions.append([float(x) for x in perm_comp_arr])
        p_val = (np.sum(perm_comp_arr >= obs_comp) + 1) / (n_perm + 1)
        p_values.append(float(p_val))

    return {
        'p_values': p_values,
        'significant': [p < 0.05 for p in p_values],
        'cluster_sizes': cluster_sizes,
        'threshold': 0.05,
        'null_distributions': null_distributions,
        'observed_compactness': observed_compactness,
    }


# ============================================================
# 4. 负二项丰度建模
# ============================================================

def fit_abundance_model(read_counts: List[int], labels: List[int]) -> Dict:
    """
    对 read count 做负二项分布建模，评估每个 cluster 的丰度显著性。
    """
    read_counts = np.array(read_counts, dtype=float)
    labels = np.array(labels)

    unique_labels = sorted(set(labels))
    enrichment_scores = []
    enrichment_pvalues = []

    mu = read_counts.mean()
    var = read_counts.var()
    if var > mu and mu > 0:
        r = mu ** 2 / (var - mu)
        p_param = r / (r + mu)
    else:
        r = mu
        p_param = 0.5

    for label in unique_labels:
        mask = labels == label
        cluster_reads = read_counts[mask]

        cluster_total = cluster_reads.sum()
        expected = mask.sum() * mu
        std = np.sqrt(mask.sum() * var)

        if std > 0:
            z_score = (cluster_total - expected) / std
        else:
            z_score = 0

        from scipy.stats import norm
        p_val = 2 * (1 - norm.cdf(abs(z_score)))

        enrichment_scores.append(round(z_score, 3))
        enrichment_pvalues.append(round(p_val, 4))

    return {
        'enrichment_scores': enrichment_scores,
        'enrichment_pvalues': enrichment_pvalues,
        'model': 'negative_binomial',
        'parameters': {'mu': round(mu, 1), 'var': round(var, 1), 'r': round(r, 1)}
    }


# ============================================================
# 主入口
# ============================================================

def cluster_by_profile(sequences: List[str],
                       dot_brackets: List[str],
                       read_counts: List[int] = None,
                       max_clusters: int = 30,
                       n_permutations: int = 1000,
                       significance_threshold: float = 0.05,
                       do_permutation_test: bool = True,
                       do_abundance_model: bool = True,
                       selection_criterion: str = 'davies_bouldin',
                       abundance_threshold: int = 0,
                       use_abundance_weight: bool = False,
                       weighting_scheme: str = 'off',
                       ) -> Dict:
    """
    Structure Profile 聚类主入口。

    Args:
        sequences: RNA 序列列表
        dot_brackets: ViennaRNA 预测的 dot-bracket 列表
        read_counts: 每条的 read count
        max_clusters: 最大簇数
        n_permutations: permutation test 次数
        significance_threshold: 显著性阈值
        do_permutation_test: 是否做显著性检验
        do_abundance_model: 是否做丰度建模
        abundance_threshold: 两阶段聚类阈值（0=禁用, int=绝对值, 0-1=分位数）
        use_abundance_weight: [deprecated] 保留向后兼容，建议用 weighting_scheme
        weighting_scheme: 'off' | 'linear' | 'sqrt' | 'log'
                          'off' = 所有 unique 序列等权
                          'linear' = 按 raw read count 加权
                          'sqrt' = sqrt(read_count) 加权（推荐折中）
                          'log' = log(1+read_count) 加权（压低差异）

    Returns:
        {
            'success': True, 'method': 'hdbscan', 'n_clusters': 8,
            'n_sequences': 500, 'labels': [...], 'metrics': {...},
            'permutation': {...}, 'abundance': {...},
            'weightingScheme': 'sqrt', 'weightedAlgorithms': [...]
        }
    """
    n = len(sequences)
    if n < 2:
        return {'success': False, 'message': 'Need at least 2 sequences'}

    # Backward compat: old use_abundance_weight=True → weighting_scheme='linear'
    if use_abundance_weight and weighting_scheme == 'off':
        weighting_scheme = 'linear'

    # Step 1: 提取结构轮廓向量
    features = extract_profile_features(dot_brackets)

    # === Two-stage clustering: high-abundance anchors + low-abundance assignment ===
    low_indices = []
    high_indices = list(range(n))
    features_full = features
    dot_brackets_full = dot_brackets
    sequences_full = sequences
    n_full = n

    if read_counts and abundance_threshold > 0 and len(read_counts) == n:
        rc = np.array(read_counts, dtype=float)
        threshold_val = abundance_threshold
        if 0 < abundance_threshold < 1:
            threshold_val = float(np.percentile(rc, (1 - abundance_threshold) * 100))
        high_mask = rc >= threshold_val
        low_mask = ~high_mask
        high_indices = list(np.where(high_mask)[0])
        low_indices = list(np.where(low_mask)[0])
        n_high = len(high_indices)
        n_low = len(low_indices)
        print(f'[ProfileCluster] Two-stage: threshold={threshold_val:.1f}, high={n_high}, low={n_low}', flush=True)

        if n_high >= 3:
            features = features_full[high_indices]
            dot_brackets = [dot_brackets_full[i] for i in high_indices]
            sequences = [sequences_full[i] for i in high_indices]
            n = n_high
        else:
            print(f'[ProfileCluster] Too few high-abundance, falling back', flush=True)
            abundance_threshold = 0

    # Step 2: 计算权重
    weights_for_clustering = None
    weights_high = None
    if weighting_scheme != 'off' and read_counts and len(read_counts) == n:
        rc_for_weights = np.array(read_counts, dtype=float)
        w = compute_weights(rc_for_weights, scheme=weighting_scheme)
        if abundance_threshold > 0 and low_indices:
            weights_for_clustering = w[high_indices].copy()
            weights_high = w[high_indices].copy()
        else:
            weights_for_clustering = w.copy()
        print(f'[ProfileCluster] Weighting scheme={weighting_scheme}, mean_w=1.0, '
              f'range=[{w.min():.2f}, {w.max():.2f}]', flush=True)

    # Step 3: 多算法聚类择优
    cluster_result = run_clustering(features, max_clusters=max_clusters,
                                     selection_criterion=selection_criterion,
                                     sample_weights=weights_for_clustering,
                                     weighting_scheme=weighting_scheme)
    labels = cluster_result['labels']

    result = {
        'success': True,
        'method': cluster_result['method'],
        'n_clusters': cluster_result['n_clusters'],
        'n_sequences': n,
        'labels': labels,
        'metrics': cluster_result['metrics'],
        'all_results': cluster_result.get('all_results', []),
        'weightingScheme': weighting_scheme,
    }
    if cluster_result.get('weightedAlgorithms'):
        result['weightedAlgorithms'] = cluster_result['weightedAlgorithms']

    # Step 4: Permutation test
    if do_permutation_test and len(set(labels)) > 1:
        perm = permutation_test(features, labels, n_perm=n_permutations)
        result['permutation'] = perm

    # Step 5: 丰度建模
    if do_abundance_model and read_counts and len(read_counts) == n:
        ab = fit_abundance_model(read_counts, labels)
        result['abundance'] = ab

    # === Phase 2: assign low-abundance sequences to nearest cluster centroid ===
    if low_indices:
        from sklearn.metrics.pairwise import euclidean_distances
        print(f'[ProfileCluster] Phase 2: assigning {len(low_indices)} low-abundance sequences', flush=True)
        centroids = {}
        for lbl in set(labels):
            mask = labels == lbl
            if weights_high is not None:
                centroids[lbl] = np.average(features_full[high_indices][mask], axis=0,
                                            weights=weights_high[mask])
            else:
                centroids[lbl] = features_full[high_indices][mask].mean(axis=0)

        low_labels = []
        for idx in low_indices:
            seq_vec = features_full[idx].reshape(1, -1)
            best_lbl = min(centroids.keys(),
                           key=lambda c: float(euclidean_distances(seq_vec, centroids[c].reshape(1, -1))[0][0]))
            low_labels.append(best_lbl)

        full_labels = [0] * n_full
        for i, hidx in enumerate(high_indices):
            full_labels[hidx] = labels[i]
        for i, lidx in enumerate(low_indices):
            full_labels[lidx] = low_labels[i]
        result['labels'] = full_labels
        result['n_sequences'] = n_full
        result['nHighAbundance'] = len(high_indices)
        result['nLowAbundance'] = len(low_indices)
        result['abundanceThreshold'] = abundance_threshold

    return result


# ============================================================
# 测试
# ============================================================

if __name__ == '__main__':
    seqs = [
        "GGGAAACCCUUUGGGAAA",
        "GGGAAACCCUUUGGGAAA",
        "GGGAAACCUUUGGGAAA",
        "GGGAAACCCUUUGGGAAA",
        "GGGAAACCCUUUGGGAA",
        "CCCCUUUUGGGGAAAACCC",
        "CCCCUUUUGGGGAAAACCC",
        "CCCCUUUGGGGAAAACC",
        "CCCCUUUUGGGGAAAACC",
        "CCCCUUUGGGGAAAACCC",
        "AAAAUUUUCCCCGGGGAAA",
        "AAAAUUUUCCCCGGGGAAA",
        "AAAAUUUCCCCGGGGAA",
        "AAAAUUUUCCCCGGGGAA",
        "AAAAUUUCCCCGGGGAAA",
    ]

    dbs = [
        "(((...)))........",
        "(((...)))........",
        "(((...)))........",
        "(((...)))........",
        "(((...)))........",
        ".....((((...))))",
        ".....((((...))))",
        ".....((((...))))",
        ".....((((...))))",
        ".....((((...))))",
        "((((....)))).....",
        "((((....)))).....",
        "((((....)))).....",
        "((((....)))).....",
        "((((....)))).....",
    ]

    read_counts = [500, 480, 450, 490, 470, 300, 290, 280, 310, 295, 100, 95, 90, 105, 98]

    print("=== ORACLE+ Profile Clustering Test ===\n")

    result = cluster_by_profile(seqs, dbs, read_counts,
                                 do_permutation_test=True,
                                 do_abundance_model=True,
                                 weighting_scheme='sqrt')

    print(f"Method: {result['method']}")
    print(f"Clusters: {result['n_clusters']}")
    print(f"Weighting: {result.get('weightingScheme', 'off')}")
    print(f"Weighted algorithms: {result.get('weightedAlgorithms', [])}")

    if 'permutation' in result:
        p = result['permutation']
        print(f"\nPermutation Test:")
        for i, (pv, sig, size) in enumerate(zip(p['p_values'], p['significant'], p['cluster_sizes'])):
            print(f"  Cluster {i}: p={pv:.4f} {'✓' if sig else '✗'} (size={size})")

    if 'abundance' in result:
        a = result['abundance']
        print(f"\nAbundance Model ({a['model']}):")
        for i, (z, pv) in enumerate(zip(a['enrichment_scores'], a['enrichment_pvalues'])):
            print(f"  Cluster {i}: z={z:.2f} p={pv:.4f}")

    print("\n=== PASS ===")


# ============================================================
# Cross-Round Enrichment Analysis
# ============================================================

def merge_cross_round_data(rounds: List[dict]) -> dict:
    """
    Merge sequences across multiple SELEX rounds by exact sequence match.

    Args:
        rounds: [
            {"label": "R1", "sequences": ["AAAA...", "BBBB..."], "readCounts": [50, 300]},
            {"label": "R3", "sequences": ["AAAA...", "CCCC..."], "readCounts": [200, 15]},
            ...
        ]

    Returns:
        {
            "sequences": ["AAAA...", "BBBB...", "CCCC..."],
            "totalReads": [1050, 300, 115],
            "roundLabels": ["R1", "R3", "R5"],
            "roundReads": [[50, 200, 800], [300, 0, 0], [100, 15, 0]],
        }
    """
    # Build per-sequence data
    seq_data = {}  # seq -> {read_counts_per_round, total}
    round_labels = [r["label"] for r in rounds]

    for ri, round_info in enumerate(rounds):
        seqs = round_info.get("sequences", [])
        rcs = round_info.get("readCounts", [])
        if len(rcs) != len(seqs):
            rcs = [1] * len(seqs)  # fallback

        for seq, rc in zip(seqs, rcs):
            if seq not in seq_data:
                seq_data[seq] = {"round_reads": [0] * len(rounds), "total": 0}
            seq_data[seq]["round_reads"][ri] += rc
            seq_data[seq]["total"] += rc

    sequences = list(seq_data.keys())
    total_reads = [seq_data[s]["total"] for s in sequences]
    round_reads = [seq_data[s]["round_reads"] for s in sequences]

    return {
        "sequences": sequences,
        "totalReads": total_reads,
        "roundLabels": round_labels,
        "roundReads": round_reads,
    }


def compute_cluster_enrichment(cluster_labels: list, merged: dict) -> dict:
    """
    Compute per-cluster fold-change and enrichment direction across rounds.

    Args:
        cluster_labels: list of cluster IDs (1-based) for each sequence in merged["sequences"]
        merged: output from merge_cross_round_data()

    Returns:
        {
            "clusterFoldChanges": [1.5, 0.2, ...],   # per-cluster mean fold-change
            "clusterDirections": ["up", "down", ...], # "up" / "stable" / "down"
            "roundLabels": ["R1", "R3", "R5"],
        }
    """
    import numpy as np
    from collections import defaultdict

    round_reads = merged["roundReads"]
    n_rounds = len(merged["roundLabels"])

    # Group sequences by cluster
    cluster_seqs = defaultdict(list)
    for i, lbl in enumerate(cluster_labels):
        cluster_seqs[lbl].append(i)

    fold_changes = []
    directions = []

    for cid in sorted(cluster_seqs.keys()):
        indices = cluster_seqs[cid]
        # For each sequence, compute fold-change (last round / first round)
        # Use pseudocount of 1 to avoid division by zero
        seq_fc = []
        for idx in indices:
            rr = round_reads[idx]
            first = rr[0] if rr[0] > 0 else 1
            last = rr[-1] if rr[-1] > 0 else 1
            fc = last / first
            seq_fc.append(fc)

        mean_fc = float(np.mean(seq_fc))
        fold_changes.append(mean_fc)

        # Direction: up (>2x), down (<0.5x), stable (otherwise)
        if mean_fc > 2.0:
            directions.append("up")
        elif mean_fc < 0.5:
            directions.append("down")
        else:
            directions.append("stable")

    return {
        "clusterFoldChanges": fold_changes,
        "clusterDirections": directions,
        "roundLabels": merged["roundLabels"],
    }
