"""Probe the service's actual boundary rules, rather than inferring them.

Two questions matter for real data:
  Q1  How are non-ACGT characters (N) treated? Dropped before averaging (which
      shrinks the denominator and inflates the score), or scored as 0 while still
      counting toward length?
  Q2  Are runs of length 1 scored at all? Bedrat 2016 says yes (+/-1).

Each probe pairs a clean sequence with an N-padded or single-run variant whose
correct answer differs measurably between the competing rules.
"""
import json
import urllib.request

NEW_URL = "http://localhost:3013"

PROBES = [
    # (label, sequence, note)
    ("clean 21nt G4",        "GGGTTAGGGTTAGGGTTAGGG",     "reference: 36/21 = 1.714286"),
    ("same + 3 leading N",   "NNNGGGTTAGGGTTAGGGTTAGGG",  "drop-N -> 1.714286 | N-as-0 -> 36/24 = 1.500000"),
    ("same + 6 N both ends", "NNNGGGTTAGGGTTAGGGTTAGGGNNN", "drop-N -> 1.714286 | N-as-0 -> 36/27 = 1.333333"),
    ("single G",             "G",                          "Bedrat -> 1/1 = 1.0 | run>=2 only -> 0.0"),
    ("single C",             "C",                          "Bedrat -> -1.0 | run>=2 only -> 0.0"),
    ("isolated G in A",      "AAGAA",                      "Bedrat -> 1/5 = 0.2 | run>=2 only -> 0.0"),
    ("isolated C in A",      "AACAA",                      "Bedrat -> -0.2 | run>=2 only -> 0.0"),
    ("GG pair in A",         "AAGGAA",                     "Bedrat -> 4/6 = 0.666667"),
    ("AC (the mismatch)",    "AC",                         "Bedrat -> -0.5 | run>=2 only -> 0.0"),
    ("all N",                "NNNNNN",                     "drop-N -> empty sequence, watch for 0 or error"),
]

body = json.dumps({"sequences": [p[1] for p in PROBES]}).encode()
req = urllib.request.Request(f"{NEW_URL}/screen", data=body,
                            headers={"Content-Type": "application/json"})
with urllib.request.urlopen(req, timeout=120) as resp:
    data = json.load(resp)["data"]

print(f"{'label':<22} {'sequence':<28} {'cGcC':>8} {'G4Hunter':>9} {'G4NN':>7}")
print("-" * 82)
for (label, seq, note), d in zip(PROBES, data):
    def f(v):
        return "null" if v is None else f"{float(v):.4f}"
    print(f"{label:<22} {seq:<28} {f(d.get('cGcC')):>8} "
          f"{f(d.get('g4Hunter')):>9} {f(d.get('g4NN')):>7}")
    print(f"{'':<22} expect: {note}")
