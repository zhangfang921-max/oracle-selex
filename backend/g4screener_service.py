"""
G4RNA Screener Microservice
Uses the original G4RNA Screener algorithms and pre-trained ANN model
by Jean-Michel Garant (GPL-3.0) for G-Quadruplex prediction.

Three scoring methods:
  1. cGcC  - consecutive G over consecutive C ratio
  2. G4Hunter (G4H) - per-nucleotide G/C run scoring
  3. G4NN  - ANN-based trimer frequency classifier

Ported to Python 3 with PyBrain3 compatibility patches.
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import sys
import os
import pickle
import re
from collections import Counter

import numpy as np

# ---------------------------------------------------------------------------
# PyBrain3 / scipy compatibility patches (must come BEFORE importing pybrain3)
# Modern scipy removed top-level numpy aliases that PyBrain3 still expects.
# ---------------------------------------------------------------------------
import scipy
# Exhaustively patch scipy with numpy aliases that pybrain3 expects
for attr in dir(np):
    if not attr.startswith('_') and not hasattr(scipy, attr):
        try:
            setattr(scipy, attr, getattr(np, attr))
        except Exception:
            pass
scipy.random = np.random
scipy.mat = np.matrix
scipy.size = np.size
scipy.rand = np.random.rand

# Module aliasing: the pickled ANN was saved with `pybrain`, not `pybrain3`
import pybrain3
sys.modules['pybrain'] = pybrain3
for sub in [
    'pybrain.structure', 'pybrain.structure.modules',
    'pybrain.structure.connections', 'pybrain.structure.networks',
    'pybrain.structure.modules.linearlayer',
    'pybrain.structure.modules.sigmoidlayer',
    'pybrain.structure.modules.biasunit',
    'pybrain.structure.connections.full',
    'pybrain.structure.networks.feedforward',
    'pybrain.structure.networks.network',
]:
    real = sub.replace('pybrain', 'pybrain3', 1)
    try:
        __import__(real)
        sys.modules[sub] = sys.modules[real]
    except ImportError:
        pass

PORT = 3002

# Global ANN model (loaded once at startup)
ann_model = None


# ---------------------------------------------------------------------------
# Original G4RNA Screener algorithms (adapted from g4base.py for Python 3)
# ---------------------------------------------------------------------------

def cgcc_scorer(sequence):
    """
    Returns the cGcC score of a sequence.
    Original algorithm by Jean-Michel Garant.
    Uses overlapping regex matches of consecutive G/C runs at each length.
    """
    import regex
    G_score = 0
    C_score = 0
    seq_len = len(sequence)
    for i in range(1, seq_len + 1):
        G_score += len(regex.findall(r'[gG]{%d}' % i, sequence, overlapped=True)) * 10 * i
        C_score += len(regex.findall(r'[cC]{%d}' % i, sequence, overlapped=True)) * 10 * i
    if C_score == 0:
        C_score = 1
    return float(G_score) / float(C_score)


def g4hunter(sequence):
    """
    G4Hunter score calculation.
    Original algorithm by Bedrat, Mergny & Lacroix (2016).
    Returns the mean per-nucleotide score for the whole sequence.
    """
    import regex
    g4h_list = [gr.group(1) for gr in regex.finditer(
        r'(?i)((?P<nt>[a-z])(?P=nt)*)', sequence, overlapped=False)]
    g4h_map = []
    for match_str in g4h_list:
        ch = match_str[0].upper()
        run_len = len(match_str)
        val = min(run_len, 4)
        if ch == 'G':
            g4h_map.extend([float(val)] * run_len)
        elif ch == 'C':
            g4h_map.extend([float(-val)] * run_len)
        else:
            g4h_map.extend([0.0] * run_len)
    if len(g4h_map) == 0:
        return 0.0
    return sum(g4h_map) / float(len(g4h_map))


def trimer_features(sequence):
    """
    Compute trimer (3-mer) frequency features for ANN input.
    Returns a numpy array of 64 trimer frequencies (AUCG alphabet, overlapping).
    Adapted from utils.py trimer_transfo().
    """
    seq = sequence.upper().replace('T', 'U')
    nts = ['A', 'U', 'C', 'G']
    trimers = []
    for n1 in nts:
        for n2 in nts:
            for n3 in nts:
                trimers.append(n1 + n2 + n3)

    # Count overlapping trimers
    counts = Counter()
    for i in range(len(seq) - 2):
        tri = seq[i:i+3]
        if all(c in 'AUCG' for c in tri):
            counts[tri] += 1

    total = sum(counts.values())
    if total == 0:
        return np.zeros(64, dtype=float)

    features = np.array([counts.get(t, 0) / float(total) for t in trimers], dtype=float)
    return features


def g4nn_score(sequence, ann):
    """
    G4NN score using the pre-trained ANN model.
    Computes trimer frequencies and activates the neural network directly.
    Returns a float between 0 and 1.
    """
    features = trimer_features(sequence)
    try:
        output = ann.activate(features)
        # ANN has 2 outputs: [non-G4, G4]. Return the G4 probability.
        if len(output) >= 2:
            return float(output[1])
        return float(output[0])
    except Exception as e:
        print(f"[G4Screener] ANN activation error: {e}", flush=True)
        return 0.0


def screen_sequence(sequence, ann):
    """
    Screen a single sequence with all three G4 scoring methods.
    Returns dict with cGcC, G4H, G4NN scores.
    """
    # Normalize: work with RNA (U instead of T)
    seq = sequence.upper().replace('T', 'U')
    # Remove non-nucleotide characters
    seq = ''.join(c for c in seq if c in 'ACGU')

    if len(seq) < 3:
        return {
            'cGcC': 0.0,
            'g4Hunter': 0.0,
            'g4NN': 0.0,
            'sequence': sequence,
            'length': len(seq),
        }

    cgcc = cgcc_scorer(seq)
    g4h = g4hunter(seq)
    g4nn = g4nn_score(seq, ann) if ann is not None else 0.0

    return {
        'cGcC': round(cgcc, 4),
        'g4Hunter': round(g4h, 4),
        'g4NN': round(g4nn, 4),
        'sequence': sequence,
        'length': len(seq),
    }


# ---------------------------------------------------------------------------
# HTTP Server
# ---------------------------------------------------------------------------

class G4ScreenerHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({
                'status': 'ok',
                'engine': 'G4RNA Screener (Original ANN)',
                'model_loaded': ann_model is not None,
            }).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == '/screen':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            try:
                data = json.loads(body)
                sequences = data.get('sequences', [])

                results = []
                for seq in sequences:
                    result = screen_sequence(seq, ann_model)
                    results.append(result)

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'success': True,
                    'data': results,
                    'engine': 'G4RNA Screener (Original ANN)',
                }).encode())
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'success': False,
                    'message': str(e),
                }).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def log_message(self, format, *args):
        pass


def load_ann_model():
    """Load the pre-trained G4RNA ANN model from pickle."""
    global ann_model

    # Look for the pkl file relative to this script and in known locations
    script_dir = os.path.dirname(os.path.abspath(__file__))
    pkl_paths = [
        os.path.join(script_dir, '..', 'g4rna_screener', 'G4RNA_2016-11-07.pkl'),
        '/workspace/g4rna_screener/G4RNA_2016-11-07.pkl',
    ]

    pkl_path = None
    for p in pkl_paths:
        if os.path.exists(p):
            pkl_path = os.path.abspath(p)
            break

    if pkl_path is None:
        print("[G4Screener] WARNING: ANN model file not found. G4NN scores will be 0.", flush=True)
        return

    try:
        with open(pkl_path, 'rb') as f:
            ann_model = pickle.load(f, encoding='latin1')
        print(f"[G4Screener] ANN model loaded from {pkl_path}", flush=True)

        # Quick validation: activate with a zero vector
        test_output = ann_model.activate(np.zeros(64))
        print(f"[G4Screener] ANN validation OK (output dims: {len(test_output)})", flush=True)
    except Exception as e:
        print(f"[G4Screener] Failed to load ANN model: {e}", flush=True)
        ann_model = None


if __name__ == '__main__':
    # Load the ANN model
    load_ann_model()

    server = HTTPServer(('0.0.0.0', PORT), G4ScreenerHandler)
    print(f'G4RNA Screener service running on port {PORT}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
        sys.exit(0)
