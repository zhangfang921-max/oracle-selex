"""
ViennaRNA RNAfold Microservice
Provides RNA secondary structure prediction with G-Quadruplex support
using the ViennaRNA package (locally installed).
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import RNA
import sys

PORT = 3001

class RNAFoldHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({
                'status': 'ok',
                'engine': 'ViennaRNA',
                'version': RNA.__version__ if hasattr(RNA, '__version__') else '2.7.x'
            }).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == '/fold':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            try:
                data = json.loads(body)
                sequences = data.get('sequences', [])
                gquad = data.get('gquad', True)

                results = []
                for seq in sequences:
                    result = fold_sequence(seq, gquad)
                    results.append(result)

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'success': True, 'data': results}).encode())
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'success': False, 'message': str(e)}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def log_message(self, format, *args):
        # Suppress default logging
        pass


def fold_sequence(sequence: str, gquad: bool = True) -> dict:
    """Fold a single RNA sequence using ViennaRNA with optional G-Quadruplex."""
    # Clean sequence: uppercase, T->U
    seq = sequence.upper().replace('T', 'U')
    # Remove non-RNA characters
    seq = ''.join(c for c in seq if c in 'ACGURNYWSMKHBVD')

    if len(seq) == 0:
        return {
            'sequence': sequence,
            'dotBracket': '',
            'mfe': 0.0,
            'numBasePairs': 0,
            'hasGQuad': False,
            'gquadEnabled': gquad,
            'engine': 'ViennaRNA',
        }

    # Cap at 10000 nt for safety
    if len(seq) > 10000:
        seq = seq[:10000]

    # Set model details
    md = RNA.md()
    md.gquad = 1 if gquad else 0

    # Create fold compound and compute MFE
    fc = RNA.fold_compound(seq, md)
    (structure, mfe) = fc.mfe()

    # Count base pairs and G-quadruplex markers
    num_bp = structure.count('(')
    has_gquad = '+' in structure

    return {
        'sequence': sequence,
        'rnaSequence': seq,
        'dotBracket': structure,
        'mfe': round(mfe, 2),
        'numBasePairs': num_bp,
        'hasGQuad': has_gquad,
        'gquadEnabled': gquad,
        'length': len(seq),
        'engine': 'ViennaRNA',
    }


if __name__ == '__main__':
    server = HTTPServer(('0.0.0.0', PORT), RNAFoldHandler)
    print(f'ViennaRNA RNAfold service running on port {PORT}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
        sys.exit(0)
