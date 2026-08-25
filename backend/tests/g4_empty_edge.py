"""Verify the empty-input edge case, which the 317-sequence cross-check skipped.

The baseline fixture holds 318 records; one of them is an empty sequence. Because
the cross-check filtered records without a sequence, the empty-input path had
never actually been exercised against either service.
"""
import json
import urllib.error
import urllib.request

PROBES = ["", "G", "GG", "GGG", "GGGTTAGGGTTAGGGTTAGGG"]
LABELS = ["(empty)", "G", "GG", "GGG", "GGGTTAGGG..."]


def call(url, seqs):
    body = json.dumps({"sequences": seqs}).encode()
    req = urllib.request.Request(
        f"{url}/screen", data=body, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.load(resp), None
    except Exception as exc:  # noqa: BLE001 - want the failure mode verbatim
        return None, repr(exc)[:300]


for url, label in (("http://localhost:3013", "new (3013)"),
                   ("http://localhost:3002", "old (3002)")):
    print(f"=== {label} ===")
    payload, err = call(url, PROBES)
    if err:
        print(f"    REQUEST FAILED: {err}")
        continue
    for name, d in zip(LABELS, payload["data"]):
        print(f"    {name:<16} cGcC={d.get('cGcC')!s:<8} "
              f"g4Hunter={d.get('g4Hunter')!s:<8} g4NN={d.get('g4NN')!s:<8} "
              f"motifs={d.get('numG4Motifs')}")

# also confirm the fixture's own recorded values for the empty record
with open("tests/fixtures/g4_baseline.json") as fh:
    raw = json.load(fh)
empties = [r for r in raw if isinstance(r, dict) and not r.get("sequence")]
print("\nfixture records with empty sequence:", len(empties))
for r in empties:
    print("   ", r)
