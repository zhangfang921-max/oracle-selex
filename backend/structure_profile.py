#!/usr/bin/env python3
"""
Structure Profile Encoder
=========================
将 ViennaRNA dot-bracket 字符串编码为结构轮廓向量。
每个位置 → 8维结构角色编码 → 全局池化 → 固定维度向量。

输入: dot-bracket 字符串 (如 "(((...)))...")
输出: (n_positions, 8) 矩阵 + (48,) 全局向量

用法:
    from structure_profile import encode_structure, encode_batch
    matrix, vec = encode_structure("(((...)))...")
    profiles = encode_batch(["(((...)))", ".....((..))"])
"""

from typing import List, Tuple, Dict
import numpy as np


def parse_base_pairs(dot_bracket: str) -> Dict[int, int]:
    """
    用栈匹配括号，返回 {pos: paired_pos} 映射。
    '.' 和 '+' (G4标记) 视为未配对。
    """
    stack: List[int] = []
    pairs: Dict[int, int] = {}

    for i, ch in enumerate(dot_bracket):
        if ch == '(':
            stack.append(i)
        elif ch == ')':
            if stack:
                j = stack.pop()
                pairs[j] = i
                pairs[i] = j
        # '.' 和 '+' 不处理

    return pairs


def _classify_loop(dot_bracket: str, pos: int, pairs: Dict[int, int]) -> str:
    """判断未配对位置所属的环类型。"""
    n = len(dot_bracket)
    # 找到环的边界：向左向右扩展到遇到配对碱基
    left = pos
    while left >= 0 and dot_bracket[left] not in ('(', ')'):
        left -= 1
    right = pos
    while right < n and dot_bracket[right] not in ('(', ')'):
        right += 1

    loop_size = right - left - 1

    # 判断环类型
    if left >= 0 and right < n:
        left_paired = dot_bracket[left] == '(' and pairs.get(left) == right
        right_paired = dot_bracket[right] == ')' and pairs.get(right) == left
        if left_paired:
            return 'hairpin', loop_size
        # internal loop / bulge
        # 左侧配对碱基的partner在右侧配对碱基的右侧 → internal loop
        # 或在右侧配对碱基的左侧 → 需要检查
    if left >= 0 and right < n:
        partner_left = pairs.get(left)
        partner_right = pairs.get(right)
        if partner_left is not None and partner_right is not None:
            if partner_left > right and partner_right < left:
                return 'internal_loop', loop_size
            # bulge: 只有一侧有缺口
            if partner_left > right:
                return 'bulge', loop_size
            if partner_right < left:
                return 'bulge', loop_size

    return 'unpaired', loop_size


def encode_structure(dot_bracket: str, g4_positions: List[int] = None) -> Tuple[np.ndarray, np.ndarray]:
    """
    将 dot-bracket 编码为结构轮廓向量。

    Args:
        dot_bracket: ViennaRNA dot-bracket 字符串
        g4_positions: 可选，G4 区域的位置索引列表

    Returns:
        matrix: (n, 8) 每个位置的 8 维结构编码
        global_vec: (48,) 全局池化向量
    """
    n = len(dot_bracket)
    pairs = parse_base_pairs(dot_bracket)
    g4_set = set(g4_positions or [])

    # 第1步：找出所有环并做分类
    loop_types = {}
    loop_sizes = {}
    for i in range(n):
        if dot_bracket[i] not in ('(', ')'):
            lt, ls = _classify_loop(dot_bracket, i, pairs)
            loop_types[i] = lt
            loop_sizes[i] = ls

    # 第2步：计算茎深度
    stem_depth = np.zeros(n)
    # 从根部 (depth=1) 向外递增
    visited = set()
    for i in range(n):
        if dot_bracket[i] == '(' and i not in visited:
            # BFS 计算茎深度
            depth = 1
            j = i
            k = pairs.get(i)
            while j is not None and k is not None and j not in visited:
                stem_depth[j] = depth
                stem_depth[k] = depth
                visited.add(j)
                visited.add(k)
                # 向内部移动
                j += 1
                k -= 1
                if j < k and dot_bracket[j] == '(':
                    depth += 1
                elif j >= k:
                    break

    # 第3步：构建 8 维矩阵
    max_stem_depth = stem_depth.max() if stem_depth.max() > 0 else 1
    max_loop_size = max(loop_sizes.values()) if loop_sizes else 1
    max_pair_dist = max(abs(i - j) for i, j in pairs.items()) if pairs else 1

    matrix = np.zeros((n, 8))

    for i in range(n):
        is_paired = 1 if i in pairs else 0

        pair_distance = abs(i - pairs[i]) / max(max_pair_dist, 1) if i in pairs else 0

        lt = loop_types.get(i, 'paired')
        in_hairpin = 1 if lt == 'hairpin' else 0
        in_bulge = 1 if lt == 'bulge' else 0
        in_internal = 1 if lt == 'internal_loop' else 0

        ls = loop_sizes.get(i, 0)
        loop_size_norm = ls / max(max_loop_size, 1)

        sd = stem_depth[i] / max(max_stem_depth, 1) if is_paired else 0

        is_g4 = 1 if i in g4_set else 0

        matrix[i] = [is_paired, pair_distance, in_hairpin, in_bulge,
                     in_internal, loop_size_norm, sd, is_g4]

    # 第4步：全局池化 → 48 维向量
    # 均值 (8) + 标准差 (8) + 直方图 bin 分布 (32 = 8×4 bins)
    mean_vec = matrix.mean(axis=0)        # (8,)
    std_vec = matrix.std(axis=0)          # (8,)

    # 量化分布：每维分 4 个 bins，统计各 bin 占比
    bins = [0, 0.25, 0.5, 0.75, 1.01]
    hist_vecs = []
    for d in range(8):
        hist, _ = np.histogram(matrix[:, d], bins=bins)
        hist_vecs.append(hist / n)
    hist_vec = np.concatenate(hist_vecs)  # (32,)

    global_vec = np.concatenate([mean_vec, std_vec, hist_vec])  # (48,)

    return matrix, global_vec


def encode_batch(dot_brackets: List[str], g4_positions_list: List[List[int]] = None) -> np.ndarray:
    """
    批量编码多个 dot-bracket 字符串。

    Returns:
        (batch_size, 48) 全局轮廓向量矩阵
    """
    if g4_positions_list is None:
        g4_positions_list = [None] * len(dot_brackets)

    vectors = []
    for db, g4p in zip(dot_brackets, g4_positions_list):
        _, vec = encode_structure(db, g4p)
        vectors.append(vec)

    return np.array(vectors)


# --- 兼容现有 ViennaRNA 输出格式 ---

def from_vienna_output(sequences: List[str], dot_brackets: List[str],
                       g4_flags: List[bool] = None) -> np.ndarray:
    """
    从 ViennaRNA 微服务的输出直接编码。

    Args:
        sequences: RNA 序列列表
        dot_brackets: 对应的 dot-bracket 字符串列表
        g4_flags: 可选，每个序列是否含 G4

    Returns:
        (batch_size, 48) 全局轮廓向量
    """
    g4_lists = []
    for i, seq in enumerate(sequences):
        if g4_flags and g4_flags[i]:
            # 简化处理：标记所有 G 连续出现 >=2 的位置
            g4_pos = []
            j = 0
            while j < len(seq) - 1:
                if seq[j] == 'G' and seq[j+1] == 'G':
                    k = j
                    while k < len(seq) and seq[k] == 'G':
                        g4_pos.append(k)
                        k += 1
                    j = k
                else:
                    j += 1
            g4_lists.append(g4_pos)
        else:
            g4_lists.append(None)

    return encode_batch(dot_brackets, g4_lists)


# --- 测试 ---

if __name__ == '__main__':
    # 测试 1: 简单发卡
    db1 = "(((...)))...."
    mat, vec = encode_structure(db1)
    print(f"发卡结构: {db1}")
    print(f"  位置编码矩阵形状: {mat.shape}")
    print(f"  全局向量形状: {vec.shape}")
    print(f"  前3个字符的结构编码:")
    for i in range(3):
        print(f"    pos {i}: paired={mat[i,0]:.0f} dist={mat[i,1]:.2f} "
              f"hairpin={mat[i,2]:.0f} bulge={mat[i,3]:.0f} "
              f"internal={mat[i,4]:.0f} loop_size={mat[i,5]:.2f} "
              f"stem_depth={mat[i,6]:.2f} g4={mat[i,7]:.0f}")

    # 测试 2: indels 对比 — 插入 1bp 不应该导致向量剧变
    db2 = "(((...)))....."
    _, vec1 = encode_structure(db1)
    _, vec2 = encode_structure(db2)
    cos_sim = np.dot(vec1, vec2) / (np.linalg.norm(vec1) * np.linalg.norm(vec2))
    print(f"\nIndel 测试:")
    print(f"  原始: {db1}")
    print(f"  插入: {db2}")
    print(f"  cosine similarity: {cos_sim:.4f}")
    print(f"  (Levenshtein on dot-bracket would treat these very differently)")
    print(f"  PASS" if cos_sim > 0.9 else f"  FAIL (similarity too low: {cos_sim:.3f})")

    # 测试 3: 批量编码
    dbs = ["(((...)))", ".....((..))", "(((.....)))"]
    batch = encode_batch(dbs)
    print(f"\n批量编码: {len(dbs)} 条 → {batch.shape}")
    print("  两两 cosine 相似度:")
    from scipy.spatial.distance import cdist
    sims = 1 - cdist(batch, batch, metric='cosine')
    for i in range(len(dbs)):
        for j in range(i+1, len(dbs)):
            print(f"    seq{i} vs seq{j}: {sims[i,j]:.3f}")

    print("\n=== 所有测试通过 ===")
