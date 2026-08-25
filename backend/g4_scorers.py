"""
G-quadruplex propensity scorers for ORACLE.

MIT-licensed, independent implementation. Nothing here is copied or adapted from
any GPL-licensed source; the two scoring functions are written directly from the
published definitions, and the G4NN feature encoder is written from the input
specification the published model expects.

Scores
------
cGcC (consecutive G over consecutive C)
    Beaudoin JD, Jodoin R, Perreault JP. New scoring system to identify RNA
    G-quadruplex folding. Nucleic Acids Res 42(2):1209-1223 (2014).
    doi:10.1093/nar/gkt904

    Every maximal run of identical G (or C) nucleotides of length L contributes
    the sum, over every sub-run length i = 1..L, of (number of sub-runs of
    length i) * 10 * i. A run of length L contains (L - i + 1) sub-runs of
    length i, so the contribution collapses to the closed form

        w(L) = 10 * sum_{i=1..L} i * (L - i + 1) = 10 * L * (L + 1) * (L + 2) / 6

    which this module evaluates directly (O(n) instead of O(n^2)). The score is
    the G total over the C total, with the denominator clamped to 1 so that
    C-free sequences stay finite.

G4Hunter
    Bedrat A, Lacroix L, Mergny JL. Re-evaluation of G-quadruplex propensity
    with G4Hunter. Nucleic Acids Res 44(4):1746-1759 (2016).
    doi:10.1093/nar/gkw006

    Each nucleotide in a maximal run of G of length L scores +min(L, 4); each
    nucleotide in a run of C scores -min(L, 4); A/U/T/other score 0. The
    sequence score is the arithmetic mean over all nucleotides.

G4NN (optional)
    Garant JM, Perreault JP, Scott MS. Bioinformatics 33(22):3532-3537 (2017).
    doi:10.1093/bioinformatics/btx498

    G4NN requires the pre-trained artificial neural network published with
    G4RNA screener. That model file is the original authors' work and is
    licensed GPL-3.0, so it is NOT distributed with ORACLE. Deployers who want
    G4NN scores install it themselves (see scripts/fetch_g4nn_model.md); when it
    is absent, g4nn_score() returns None and the rest of the pipeline degrades
    gracefully to the two threshold criteria above.
"""

from __future__ import annotations

import itertools
import os
import pickle
import sys
from typing import Iterator, Optional

# Alphabet order expected by the published G4NN model's 64-element input vector.
_G4NN_ALPHABET = ("A", "U", "C", "G")
_G4NN_TRIMERS = tuple("".join(t) for t in itertools.product(_G4NN_ALPHABET, repeat=3))

# Published decision thresholds (used for reporting, not for scoring).
CGCC_THRESHOLD = 4.5
G4HUNTER_THRESHOLD = 0.9
G4NN_THRESHOLD = 0.5


# ---------------------------------------------------------------------------
# Sequence normalisation
# ---------------------------------------------------------------------------

def normalise(sequence: str) -> str:
    """Upper-case, DNA->RNA (T->U), and drop anything that is not A/C/G/U."""
    up = sequence.upper().replace("T", "U")
    return "".join(ch for ch in up if ch in "ACGU")


def _runs(sequence: str) -> Iterator[tuple[str, int]]:
    """Yield (nucleotide, run_length) for each maximal run of identical letters."""
    for nucleotide, group in itertools.groupby(sequence):
        yield nucleotide, sum(1 for _ in group)


# ---------------------------------------------------------------------------
# cGcC
# ---------------------------------------------------------------------------

def _run_weight(length: int) -> int:
    """Closed form of 10 * sum_{i=1..L} i * (L - i + 1)."""
    return 10 * length * (length + 1) * (length + 2) // 6


def cgcc_score(sequence: str) -> float:
    """cGcC score: weighted consecutive-G total divided by consecutive-C total."""
    g_total = 0
    c_total = 0
    for nucleotide, length in _runs(sequence):
        if nucleotide == "G":
            g_total += _run_weight(length)
        elif nucleotide == "C":
            c_total += _run_weight(length)
    return g_total / float(c_total if c_total else 1)


# ---------------------------------------------------------------------------
# G4Hunter
# ---------------------------------------------------------------------------

def g4hunter_score(sequence: str) -> float:
    """G4Hunter score: mean per-nucleotide G-run / C-run score."""
    if not sequence:
        return 0.0
    total = 0
    counted = 0
    for nucleotide, length in _runs(sequence):
        counted += length
        capped = length if length < 4 else 4
        if nucleotide == "G":
            total += capped * length
        elif nucleotide == "C":
            total -= capped * length
    return total / float(counted) if counted else 0.0


# ---------------------------------------------------------------------------
# G4NN (optional, requires the externally installed GPL-3.0 model)
# ---------------------------------------------------------------------------

def trimer_frequencies(sequence: str) -> list[float]:
    """Overlapping 3-mer frequencies over the AUCG alphabet, in model input order."""
    counts: dict[str, int] = {}
    total = 0
    for i in range(len(sequence) - 2):
        trimer = sequence[i:i + 3]
        counts[trimer] = counts.get(trimer, 0) + 1
        total += 1
    if not total:
        return [0.0] * len(_G4NN_TRIMERS)
    return [counts.get(t, 0) / float(total) for t in _G4NN_TRIMERS]


def _prepare_pybrain_runtime() -> None:
    """
    Make the vendored PyBrain3 importable on modern SciPy/NumPy.

    PyBrain3 still expects NumPy aliases that SciPy removed from its top level,
    and the published model was pickled under the module name `pybrain`.
    """
    import numpy
    import scipy

    for name in dir(numpy):
        if not name.startswith("_") and not hasattr(scipy, name):
            try:
                setattr(scipy, name, getattr(numpy, name))
            except Exception:
                pass
    scipy.random = numpy.random  # type: ignore[attr-defined]
    scipy.rand = numpy.random.rand  # type: ignore[attr-defined]
    # Legacy names PyBrain3 imports that neither modern SciPy nor NumPy 2.x
    # expose any more, so dir(numpy) above cannot supply them.
    legacy = {
        "mat": numpy.asmatrix,
        "size": numpy.size,
        "sum": numpy.sum,
        "sqrt": numpy.sqrt,
        "zeros": numpy.zeros,
        "ones": numpy.ones,
        "array": numpy.array,
        "asarray": numpy.asarray,
        "dot": numpy.dot,
        "exp": numpy.exp,
        "log": numpy.log,
        "isscalar": numpy.isscalar,
        "isinf": numpy.isinf,
        "isnan": numpy.isnan,
    }
    for name, value in legacy.items():
        if not hasattr(scipy, name):
            try:
                setattr(scipy, name, value)
            except Exception:
                pass

    import pybrain3

    sys.modules.setdefault("pybrain", pybrain3)
    for suffix in (
        "structure",
        "structure.modules",
        "structure.connections",
        "structure.networks",
        "structure.modules.linearlayer",
        "structure.modules.sigmoidlayer",
        "structure.modules.biasunit",
        "structure.connections.full",
        "structure.networks.feedforward",
        "structure.networks.network",
    ):
        real = f"pybrain3.{suffix}"
        try:
            __import__(real)
        except ImportError:
            continue
        sys.modules.setdefault(f"pybrain.{suffix}", sys.modules[real])


def default_model_paths() -> list[str]:
    """Candidate locations for the externally installed G4NN model."""
    override = os.environ.get("G4NN_MODEL_PATH")
    if override:
        return [override]
    here = os.path.dirname(os.path.abspath(__file__))
    repo = os.path.dirname(here)
    return [
        os.path.join(repo, "models", "G4RNA_2016-11-07.pkl"),
        os.path.join(repo, "g4rna_screener", "G4RNA_2016-11-07.pkl"),
    ]


def load_g4nn_model(paths: Optional[list[str]] = None):
    """
    Load the pre-trained G4NN network, or return None when it is not installed.

    The model file is the original authors' GPL-3.0 work and is not shipped with
    ORACLE. Absence is a supported state, not an error.
    """
    for path in paths or default_model_paths():
        if not os.path.exists(path):
            continue
        try:
            _prepare_pybrain_runtime()
            with open(path, "rb") as handle:
                model = pickle.load(handle, encoding="latin1")
            model.activate([0.0] * len(_G4NN_TRIMERS))  # smoke-test the network
            return model
        except Exception as exc:  # pragma: no cover - depends on local install
            print(f"[g4] G4NN model at {path} could not be loaded: {exc}", flush=True)
            return None
    return None


def g4nn_score(sequence: str, model) -> Optional[float]:
    """G4NN probability, or None when the model is not installed."""
    if model is None:
        return None
    try:
        output = model.activate(trimer_frequencies(sequence))
    except Exception as exc:  # pragma: no cover
        print(f"[g4] G4NN activation failed: {exc}", flush=True)
        return None
    return float(output[1]) if len(output) >= 2 else float(output[0])


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def screen_sequence(sequence: str, model=None) -> dict:
    """
    Score one sequence. Response shape is ORACLE's stable G4 service contract.

    `g4NN` is None when the optional model is not installed.
    """
    seq = normalise(sequence)
    if len(seq) < 3:
        return {
            "cGcC": 0.0,
            "g4Hunter": 0.0,
            "g4NN": None if model is None else 0.0,
            "sequence": sequence,
            "length": len(seq),
        }

    nn = g4nn_score(seq, model)
    return {
        "cGcC": round(cgcc_score(seq), 4),
        "g4Hunter": round(g4hunter_score(seq), 4),
        "g4NN": None if nn is None else round(nn, 4),
        "sequence": sequence,
        "length": len(seq),
    }
