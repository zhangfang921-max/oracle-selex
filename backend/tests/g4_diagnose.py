"""Isolate the sequences where the service's G4Hunter disagrees with the
independent Bedrat 2016 implementation, and show the per-base breakdown so the
cause is visible rather than guessed at.
"""
import json
import urllib.request

BASELINE = "tests/fixtures/g4_baseline.json"
NEW_URL = "http://localhost:3013"


def runs(seq: str):
    """Yield (base, start, length) for every homopolymer run."""
    s = seq.upper().replace("U", "T")
    i = 0
    while i < len(s):
        j = i
        while j < len(s) and s[j] == s[i]:
            j += 1
        yield s[i], i, j - i
        i = j


def g4hunter_independent(seq: str, cap: int = 4) -> float:
    s = seq.upper().replace("U", "T")
    if not s:
        return 0.0
    total = 0
    for base, _, length in runs(s):
        if base == "G":
            total += min(length, cap) * length
        elif base == "C":
            total -= min(length, cap) * length
    return total / len(s)


with open(BASELINE) as fh:
    raw = json.load(fh)
records = raw if isinstance(raw, list) else (raw.get("sequences") or raw.get("data") or [])
seqs, recs = [], []
for r in records:
    if isinstance(r, str):
        seqs.append(r); recs.append({})
    else:
        s = r.get("sequence") or r.get("seq")
        if s:
            seqs.append(s); recs.append(r)

body = json.dumps({"sequences": seqs}).encode()
req = urllib.request.Request(f"{NEW_URL}/screen", data=body,
                            headers={"Content-Type": "application/json"})
with urllib.request.urlopen(req, timeout=300) as resp:
    data = json.load(resp)["data"]

print(f"{len(seqs)} sequences; hunting disagreements > 1e-4\n")
bad = []
for seq, rec, d in zip(seqs, recs, data):
    svc = d.get("g4Hunter")
    if svc is None:
        continue
    ind = g4hunter_independent(seq)
    if abs(float(svc) - ind) > 1e-4:
        bad.append((seq, ind, float(svc), rec))

print(f"disagreements: {len(bad)}\n")
for seq, ind, svc, rec in bad:
    print("=" * 74)
    print(f"sequence  : {seq!r}")
    print(f"length    : {len(seq)}")
    print(f"runs      : {[(b, l) for b, _, l in runs(seq)]}")
    print(f"independent (cap=4) : {ind:.6f}")
    print(f"service             : {svc:.6f}")
    print(f"difference          : {svc - ind:+.6f}")
    # try alternative interpretations to identify which rule differs
    alt_nocap = g4hunter_independent(seq, cap=10**6)
    print(f"  if run length were NOT capped at 4 : {alt_nocap:.6f}"
          f"{'   <-- matches service' if abs(alt_nocap - svc) < 1e-4 else ''}")
    uniq = set(seq.upper())
    print(f"  distinct characters : {sorted(uniq)}")
    non_acgt = uniq - set("ACGTU")
    if non_acgt:
        print(f"  NON-ACGT CHARACTERS PRESENT: {sorted(non_acgt)}  <-- likely cause")
    if rec:
        keys = {k: v for k, v in rec.items() if k != "sequence"}
        print(f"  fixture record      : {keys}")
