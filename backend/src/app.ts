import express, { Application } from 'express'
import cors from 'cors'
import compression from 'compression'
import 'express-async-errors'
import path from 'path'
import { env } from './config/env'
import { errorHandler } from './middleware/errorHandler'
import { httpLogger } from './middleware/logger'
import { systemRouter } from './modules/system'
import { analysisRouter } from './modules/analysis'

export const createApp = (): Application => {
  const app = express()

  // Enable BigInt JSON serialization (Prisma returns BigInt for large integer columns)
  app.set('json replacer', (_key: string, value: unknown) =>
    typeof value === 'bigint' ? Number(value) : value
  )

  // HTTP request logging
  app.use(httpLogger)

  app.use(
    cors({
      origin: env.CORS_ORIGIN === '*' ? '*' : env.CORS_ORIGIN,
      credentials: env.CORS_ORIGIN !== '*',
    })
  )

  // Body parsing and compression
  app.use(express.json({ limit: '100mb' }))
  app.use(express.urlencoded({ extended: true, limit: '100mb' }))
  app.use(compression())

  // API routes - System & Health
  app.use(env.API_PREFIX, systemRouter)

  app.use(`${env.API_PREFIX}/analysis`, analysisRouter)

  // Serve React frontend (production build)
  app.use(express.static(path.resolve(__dirname, '../../frontend/dist')))
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.resolve(__dirname, '../../frontend/dist/index.html'))
  })

  // Error handling
  app.use(errorHandler)

  return app
}
