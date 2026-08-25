"""
Regression test: the MIT implementation in g4_scorers.py must reproduce the
scores ORACLE has been serving, so existing analyses stay comparable.

The baseline fixture (tests/fixtures/g4_baseline.json) holds cGcC / G4Hunter /
G4NN values for 318 sequences (18 hand-picked edge cases plus 300 real SELEX
round-5 sequences). Functional equivalence is what is being asserted here;
outputs are facts, not protected expression.

Run:  python3 tests/test_g4_scorers.py
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from g4_scorers import (  # noqa: E402
    cgcc_score,
    g4hunter_score,
    load_g4nn_model,
    normalise,
    screen_sequence,
    trimer_frequencies,
)

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "g4_baseline.json")
TOLERANCE = 1e-4  # fixture values are rounded to 4 decimals


def test_closed_form_matches_naive_run_weight():
    """w(L) = 10 * sum_i i*(L-i+1) must equal the closed form for every L."""
    from g4_scorers import _run_weight

    for length in range(1, 60):
        naive = sum((length - i + 1) * 10 * i for i in range(1, length + 1))
        assert _run_weight(length) == naive, (length, naive, _run_weight(length))
    print("  closed-form run weight == naive summation for L = 1..59")


def test_hand_computed_values():
    """A few values worked out by hand from the published definitions."""
    # GGGG: one G-run of 4 -> every nucleotide scores +4 -> mean 4.0
    assert abs(g4hunter_score("GGGG") - 4.0) < 1e-12
    # CCCC mirrors it
    assert abs(g4hunter_score("CCCC") + 4.0) < 1e-12
    # GGAACC: +2,+2,0,0,-2,-2 -> mean 0
    assert abs(g4hunter_score("GGAACC") - 0.0) < 1e-12
    # GGGAAA: +3 x3 then 0 x3 -> 9/6 = 1.5
    assert abs(g4hunter_score("GGGAAA") - 1.5) < 1e-12
    # GGGGG (L=5): capped at 4 -> mean 4.0
    assert abs(g4hunter_score("GGGGG") - 4.0) < 1e-12
    # cGcC of "GG" = w(2)/1 = 40 ; of "GGCC" = w(2)/w(2) = 1
    assert abs(cgcc_score("GG") - 40.0) < 1e-12
    assert abs(cgcc_score("GGCC") - 1.0) < 1e-12
    print("  hand-computed G4Hunter / cGcC values match")


def test_normalisation():
    assert normalise("atcg") == "AUCG"
    assert normalise("ACGTN-x") == "ACGU"
    assert normalise("") == ""
    print("  normalisation (upper-case, T->U, non-ACGU dropped) OK")


def test_trimer_vector():
    vec = trimer_frequencies("AAAA")
    assert len(vec) == 64
    assert abs(sum(vec) - 1.0) < 1e-12
    assert abs(vec[0] - 1.0) < 1e-12  # index 0 is 'AAA'
    assert trimer_frequencies("AA") == [0.0] * 64
    print("  trimer feature vector: 64 dims, normalised, AAA at index 0")


def test_against_baseline():
    with open(FIXTURE, encoding="utf-8") as handle:
        baseline = json.load(handle)

    model = load_g4nn_model()
    print(f"  G4NN model installed: {model is not None}")

    checked = {"cGcC": 0, "g4Hunter": 0, "g4NN": 0}
    skipped_nn = 0
    failures = []

    for entry in baseline:
        got = screen_sequence(entry["sequence"], model)

        assert got["length"] == entry["length"], (entry["sequence"], got["length"], entry["length"])

        for key in ("cGcC", "g4Hunter"):
            if abs(got[key] - entry[key]) > TOLERANCE:
                failures.append((entry["sequence"], key, entry[key], got[key]))
            else:
                checked[key] += 1

        if model is None or got["g4NN"] is None:
            skipped_nn += 1
        elif abs(got["g4NN"] - entry["g4NN"]) > TOLERANCE:
            failures.append((entry["sequence"], "g4NN", entry["g4NN"], got["g4NN"]))
        else:
            checked["g4NN"] += 1

    print(f"  sequences compared: {len(baseline)}")
    print(f"  cGcC matches:     {checked['cGcC']}/{len(baseline)}")
    print(f"  G4Hunter matches: {checked['g4Hunter']}/{len(baseline)}")
    print(f"  G4NN matches:     {checked['g4NN']}/{len(baseline) - skipped_nn}"
          f" (skipped {skipped_nn})")

    if failures:
        print(f"\n  {len(failures)} MISMATCHES (first 10):")
        for seq, key, want, got_value in failures[:10]:
            print(f"    {key:9s} baseline={want!r:12} new={got_value!r:12} {seq[:40]}")
        raise AssertionError(f"{len(failures)} value mismatches against baseline")


def main():
    tests = [
        test_closed_form_matches_naive_run_weight,
        test_hand_computed_values,
        test_normalisation,
        test_trimer_vector,
        test_against_baseline,
    ]
    for test in tests:
        print(f"{test.__name__}:")
        test()
    print("\nAll G4 scorer tests passed.")


if __name__ == "__main__":
    main()
