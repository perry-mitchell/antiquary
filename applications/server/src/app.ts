import { existsSync } from 'node:fs'
import { join } from 'node:path'
import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import type { Database } from '@antiquary/database'
import { errorHandler } from './errors.js'
import { collectionRoutes } from './routes/collections.js'
import { imageRoutes, itemRoutes } from './routes/items.js'
import { statsRoutes, tagRoutes, trashRoutes } from './routes/tags.js'
import { supersetRoutes } from './routes/supersets.js'
import { templateRoutes } from './routes/templates.js'
import { settingsRoutes } from './routes/settings.js'
import { mcpRoutes } from './routes/mcp.js'
import type { SupersetRegistry } from './supersets.js'

export interface AppDeps {
  db: Database
  uploadDir: string
  supersets: SupersetRegistry
  webDist?: string | null
}

export function createApp({ db, uploadDir, supersets, webDist }: AppDeps): Express {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '1mb' }))

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true })
  })

  app.use('/api/collections', collectionRoutes(db, supersets))
  app.use('/api/templates', templateRoutes(db))
  app.use('/api/items', itemRoutes(db, uploadDir, supersets))
  app.use('/api/images', imageRoutes(db, uploadDir))
  app.use('/api/tags', tagRoutes(db))
  app.use('/api/trash', trashRoutes(db))
  app.use('/api/stats', statsRoutes(db))
  app.use('/api/supersets', supersetRoutes(supersets))
  app.use('/api/settings', settingsRoutes(db))
  app.use('/mcp', mcpRoutes(db, supersets))

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' })
  })

  app.use('/uploads', express.static(uploadDir, { maxAge: '1d', index: false }))

  const dist = webDist && existsSync(webDist) ? webDist : null
  if (dist) {
    app.use(express.static(dist, { index: 'index.html', maxAge: '1h' }))
    // SPA fallback: send index.html for any non-API GET that did not match a file.
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET') return next()
      res.sendFile(join(dist, 'index.html'))
    })
  }

  app.use(errorHandler())
  return app
}
