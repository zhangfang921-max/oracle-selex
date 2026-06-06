import { createApp } from './app'
import { env } from './config/env'
import { prisma } from './config/database'
import { Prisma } from '@prisma/client'
import { logger } from './config/logger'
import { spawn, ChildProcess } from 'child_process'
import path from 'path'


// CJS
// CJS

let rnafoldProcess: ChildProcess | null = null
let g4screenerProcess: ChildProcess | null = null
let tsneProcess: ChildProcess | null = null

/**
 * Start the ViennaRNA RNAfold microservice (Python) on port 3001.
 * Runs as a child process so it lives alongside the Express backend.
 */
function startRNAFoldService(): void {
  const scriptPath = path.resolve(__dirname, '..', 'rnafold_service.py')
  rnafoldProcess = spawn('python3', [scriptPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  })

  rnafoldProcess.stdout?.on('data', (data: Buffer) => {
    const msg = data.toString().trim()
    if (msg) console.log(`[ViennaRNA] ${msg}`)
  })

  rnafoldProcess.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim()
    if (msg) console.error(`[ViennaRNA] ${msg}`)
  })

  rnafoldProcess.on('error', (err) => {
    console.warn(`[ViennaRNA] Failed to start service: ${err.message}`)
    rnafoldProcess = null
  })

  rnafoldProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.warn(`[ViennaRNA] Service exited with code ${code}`)
    }
    rnafoldProcess = null
  })
}

/**
 * Start the G4RNA Screener microservice (Python) on port 3002.
 * Uses the original ANN model by Jean-Michel Garant.
 */
function startG4ScreenerService(): void {
  const scriptPath = path.resolve(__dirname, '..', 'g4screener_service.py')
  g4screenerProcess = spawn('python3', [scriptPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  })

  g4screenerProcess.stdout?.on('data', (data: Buffer) => {
    const msg = data.toString().trim()
    if (msg) console.log(`[G4Screener] ${msg}`)
  })

  g4screenerProcess.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim()
    if (msg) console.error(`[G4Screener] ${msg}`)
  })

  g4screenerProcess.on('error', (err) => {
    console.warn(`[G4Screener] Failed to start service: ${err.message}`)
    g4screenerProcess = null
  })

  g4screenerProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.warn(`[G4Screener] Service exited with code ${code}`)
    }
    g4screenerProcess = null
  })
}

function stopRNAFoldService(): void {
  if (rnafoldProcess) {
    rnafoldProcess.kill('SIGTERM')
    rnafoldProcess = null
  }
}

function stopG4ScreenerService(): void {
  if (g4screenerProcess) {
    g4screenerProcess.kill('SIGTERM')
    g4screenerProcess = null
  }
}

/**
 * Start the t-SNE visualization microservice (Python) on port 3003.
 */
function startTSNEService(): void {
  const scriptPath = path.resolve(__dirname, '..', 'tsne_service.py')
  tsneProcess = spawn('python3', [scriptPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  })

  tsneProcess.stdout?.on('data', (data: Buffer) => {
    const msg = data.toString().trim()
    if (msg) console.log(`[tSNE] ${msg}`)
  })

  tsneProcess.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim()
    if (msg) console.error(`[tSNE] ${msg}`)
  })

  tsneProcess.on('error', (err) => {
    console.warn(`[tSNE] Failed to start service: ${err.message}`)
    tsneProcess = null
  })

  tsneProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.warn(`[tSNE] Service exited with code ${code}`)
    }
    tsneProcess = null
  })
}

function stopTSNEService(): void {
  if (tsneProcess) {
    tsneProcess.kill('SIGTERM')
    tsneProcess = null
  }
}

const startServer = async () => {
  try {
    // Start Python microservices
    startRNAFoldService()
    startG4ScreenerService()
    startTSNEService()

    // Test database connection silently
    if (env.DATABASE_URL) {
      // Retry connecting to database
      for (let i = 0;; i++) {
        try {
          await prisma.$connect()
          break
        }catch(e) {
          if (i >= 100 || !(e instanceof Prisma.PrismaClientInitializationError)) {
            throw e
          }
          await new Promise(resolve => setTimeout(resolve, 50))
        }
      }
    }

    const app = createApp()

    app.listen(env.PORT, () => {
      // Only show minimal startup info in development
      if (env.NODE_ENV === 'development') {
        console.log(`Server running on http://localhost:${env.PORT}${env.API_PREFIX}`)
      }
    })
  } catch (error) {
    logger.error({ err: error }, 'Failed to start server')
    process.exit(1)
  }
}

// Handle graceful shutdown silently
process.on('SIGTERM', async () => {
  stopRNAFoldService()
  stopG4ScreenerService()
  stopTSNEService()
  await prisma.$disconnect()
  process.exit(0)
})

process.on('SIGINT', async () => {
  stopRNAFoldService()
  stopG4ScreenerService()
  stopTSNEService()
  await prisma.$disconnect()
  process.exit(0)
})

startServer()
