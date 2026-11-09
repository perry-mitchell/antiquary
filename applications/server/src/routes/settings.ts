import { Router } from 'express'
import { z } from 'zod'
import type { Database } from '@antiquary/database'
import { HttpError } from '../errors.js'

const createApiKeySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  readonly: z.boolean().optional(),
})

export function settingsRoutes(db: Database): Router {
  const router = Router()

  router.get('/api-keys', async (_req, res) => {
    res.json(await db.listApiKeys())
  })

  router.post('/api-keys', async (req, res) => {
    const input = createApiKeySchema.parse(req.body)
    const { apiKey, key } = await db.createApiKey(input.name, input.readonly ?? false)
    // The plaintext key is returned exactly once; only a hash is stored.
    res.status(201).json({ apiKey, key })
  })

  router.delete('/api-keys/:id', async (req, res) => {
    try {
      await db.revokeApiKey(req.params.id)
    } catch {
      throw new HttpError(404, 'API key not found')
    }
    res.json({ ok: true })
  })

  return router
}
