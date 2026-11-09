import { Router } from 'express'
import { HttpError } from '../errors.js'
import type { SupersetRegistry } from '../supersets.js'

export function supersetRoutes(registry: SupersetRegistry): Router {
  const router = Router()

  router.get('/', (_req, res) => {
    res.json(registry.list())
  })

  router.get('/:key', (req, res) => {
    const info = registry.get(req.params.key)
    if (!info) throw new HttpError(404, 'Catalog not found')
    res.json(info)
  })

  router.get('/:key/entries/:entryId', async (req, res) => {
    const entry = await registry.getEntry(req.params.key, req.params.entryId)
    if (!entry) throw new HttpError(404, 'Catalog entry not found')
    res.json(entry)
  })

  router.get('/:key/search', async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q : ''
    if (query.trim().length === 0) throw new HttpError(400, 'Missing search query (?q=)')
    const info = registry.get(req.params.key)
    if (!info) throw new HttpError(404, 'Catalog not found')
    res.json({ results: await registry.search(req.params.key, query) })
  })

  return router
}
