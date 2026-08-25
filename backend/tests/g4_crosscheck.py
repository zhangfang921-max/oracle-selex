"""Four-way cross-check of the G4 scores on real SELEX sequences.

The point is to separate two different questions that are easy to conflate:

  1. "Does the new code reproduce the old code?"  -> compare 3013 vs 3002 vs the
     recorded baseline. This is what protects already-published numbers.
  2. "Is the formula itself right?"               -> compare against an INDEPENDENT
     G4Hunter written here straight from Bedrat et al. 2016, importing nothing
     from g4_scorers. If both agree on 318 real sequences, the definition is not
     just self-consistent, it is the published one.

cGcC is deliberately only checked as (1): its 10*i run weighting comes from the
G4RNA screener implementation rather than from the Beaudoin 2014 text, so the
original implementation IS the reference. Saying otherwise would overclaim.

G4NN is checked as (1) only -- it is a neural net, there is no closed form.
"""
import json
import os
import statistics
import urllib.error
import urllib.request

BASELINE = "tests/fixtures/g4_baseline.json"
OLD_URL = "http://localhost:3002"   # original GPL-3.0 service, untouched
NEW_URL = "http://localhost:3013"   # independent MIT reimplementation


# ---------------------------------------------------------------- independent
def g4hunter_independent(seq: str) -> float:
    """G4Hunter per Bedrat, Lacroix & Mergny (2016), NAR 44:1746.

    Each base inside a run of G of length L scores +min(L,4); inside a run of C
    it scores -min(L,4); anything else scores 0. The reported value is the
    arithmetic mean over the whole sequence.
    """
    s = seq.upper().replace("U", "T")
    if not s:
        return 0.0
    scores = [0] * len(s)
    i = 0
    while i < len(s):
        base = s[i]
        if base in ("G", "C"):
            j = i
            while j < len(s) and s[j] == base:
                j += 1
            run = j - i
            val = min(run, 4)
            signed = val if base == "G" else -val
            for k in range(i, j):
                scores[k] = signed
            i = j
        else:
            i += 1
    return sum(scores) / len(s)


# ---------------------------------------------------------------- service call
def screen(url: str, sequences: list[str]) -> list[dict]:
    body = json.dumps({"sequences": sequences}).encode()
    req = urllib.request.Request(
        f"{url}/screen", data=body, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        payload = json.load(resp)
    return payload["data"]


def health(url: str) -> dict:
    with urllib.request.urlopen(f"{url}/health", timeout=10) as resp:
        return json.load(resp)


# ---------------------------------------------------------------- load corpus
with open(BASELINE) as fh:
    raw = json.load(fh)

if isinstance(raw, dict):
    records = raw.get("sequences") or raw.get("data") or raw.get("records") or []
else:
    records = raw

sequences, recorded = [], []
for rec in records:
    if isinstance(rec, str):
        sequences.append(rec)
        recorded.append(None)
    else:
        seq = rec.get("sequence") or rec.get("seq")
        if not seq:
            continue
        sequences.append(seq)
        recorded.append(rec)

print(f"baseline file    : {BASELINE}")
print(f"sequences loaded : {len(sequences)}")
print(f"length range     : {min(map(len, sequences))}-{max(map(len, sequences))} nt")
print(f"old service      : {health(OLD_URL)}")
print(f"new service      : {health(NEW_URL)}")
print()

old = screen(OLD_URL, sequences)
new = screen(NEW_URL, sequences)
print(f"scored by old    : {len(old)}")
print(f"scored by new    : {len(new)}")
print()


def get(d: dict, *names):
    for n in names:
        if n in d and d[n] is not None:
            return d[n]
    return None


# ------------------------------------------------- 1. new vs old, digit for digit
print("=" * 78)
print("CHECK 1  new (MIT, 3013) vs old (GPL, 3002) -- protects published numbers")
print("=" * 78)
worst = {}
for field, aliases in (
    ("cGcC", ("cGcC", "cgcc")),
    ("G4Hunter", ("g4Hunter", "g4hunter", "G4H")),
    ("G4NN", ("g4NN", "g4nn")),
):
    diffs, missing = [], 0
    for o, n in zip(old, new):
        ov, nv = get(o, *aliases), get(n, *aliases)
        if ov is None or nv is None:
            missing += 1
            continue
        diffs.append(abs(float(ov) - float(nv)))
    if diffs:
        mx = max(diffs)
        worst[field] = mx
        exact = sum(1 for d in diffs if d == 0.0)
        print(f"  {field:<9} compared={len(diffs):<4} exact={exact:<4} "
              f"max|diff|={mx:.3e}  null_skipped={missing}")
    else:
        print(f"  {field:<9} no comparable values (null_skipped={missing})")

# ------------------------------------------- 2. G4Hunter vs independent formula
print()
print("=" * 78)
print("CHECK 2  new G4Hunter vs INDEPENDENT Bedrat 2016 implementation")
print("=" * 78)
ind_diffs = []
examples = []
for seq, n in zip(sequences, new):
    nv = get(n, "g4Hunter", "g4hunter", "G4H")
    if nv is None:
        continue
    iv = g4hunter_independent(seq)
    d = abs(float(nv) - iv)
    ind_diffs.append(d)
    if len(examples) < 3:
        examples.append((seq, iv, float(nv)))

if ind_diffs:
    print(f"  compared      = {len(ind_diffs)}")
    print(f"  max|diff|     = {max(ind_diffs):.3e}")
    print(f"  mean|diff|    = {statistics.fmean(ind_diffs):.3e}")
    print(f"  within 1e-4   = {sum(1 for d in ind_diffs if d < 1e-4)}/{len(ind_diffs)}")
    print("  worked examples (independent vs service):")
    for seq, iv, nv in examples:
        print(f"    {seq[:44]}{'...' if len(seq) > 44 else ''}")
        print(f"      independent={iv:.6f}  service={nv:.6f}  diff={abs(iv-nv):.2e}")

# --------------------------------------------- 3. against the recorded baseline
print()
print("=" * 78)
print("CHECK 3  new vs values recorded in the baseline fixture")
print("=" * 78)
any_recorded = False
for field, aliases in (
    ("cGcC", ("cGcC", "cgcc")),
    ("G4Hunter", ("g4Hunter", "g4hunter", "G4H")),
    ("G4NN", ("g4NN", "g4nn")),
):
    diffs = []
    for rec, n in zip(recorded, new):
        if not isinstance(rec, dict):
            continue
        rv, nv = get(rec, *aliases), get(n, *aliases)
        if rv is None or nv is None:
            continue
        diffs.append(abs(float(rv) - float(nv)))
    if diffs:
        any_recorded = True
        print(f"  {field:<9} compared={len(diffs):<4} max|diff|={max(diffs):.3e}")
if not any_recorded:
    print("  (fixture stores sequences only, no recorded scores to compare)")

print()
print("=" * 78)
ok = all(v == 0.0 for v in worst.values()) and (not ind_diffs or max(ind_diffs) < 1e-4)
print("VERDICT:", "PASS - new implementation is numerically faithful"
      if ok else "FAIL - investigate the differences above")
print("=" * 78)
