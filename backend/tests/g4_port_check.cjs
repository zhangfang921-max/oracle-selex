/**
 * Proves G4_PORT actually reaches the Node client, not just the Python service.
 *
 * Two G4 services are running with deliberately different engine strings:
 *   3002 -> old service            ("G4RNA Screener (Original ANN)")
 *   3013 -> new service            ("ORACLE G4 scorers ...")
 * So the engine string in the response tells us which port was dialled.
 * Before the fix the URL was hard-coded to 3002 and G4_PORT was ignored.
 */
const { scoreG4Batch } = require('../dist/services/g4Screener')

const SEQ = 'GGGTTAGGGTTAGGGTTAGGGTTAGGGTTAGG'

scoreG4Batch([SEQ])
  .then((results) => {
    const r = results[0]
    console.log(JSON.stringify({
      G4_PORT: process.env.G4_PORT ?? '(unset)',
      engine: r.engine,
      degraded: r.degraded ?? false,
      cGcC: r.cGcC,
      g4Hunter: r.g4Hunter,
      g4NN: r.g4NN,
    }))
  })
  .catch((err) => {
    console.error('FAILED:', err.message)
    process.exitCode = 1
  })
