import { Router } from 'express'
import type { Database } from '@antiquary/database'
import { HttpError } from '../errors.js'
import { createTemplateSchema, updateTemplateSchema } from '../schemas.js'

export function templateRoutes(db: Database): Router {
  const router = Router()

  router.get('/', async (_req, res) => {
    res.json(await db.listTemplates())
  })

  router.post('/', async (req, res) => {
    const input = createTemplateSchema.parse(req.body)
    res.status(201).json(await db.createTemplate(input))
  })

  router.get('/:id', async (req, res) => {
    const template = await db.getTemplate(req.params.id)
    if (!template) throw new HttpError(404, 'Template not found')
    res.json(template)
  })

  router.patch('/:id', async (req, res) => {
    const patch = updateTemplateSchema.parse(req.body)
    const updated = await db.updateTemplate(req.params.id, patch)
    if (!updated) throw new HttpError(404, 'Template not found')
    res.json(updated)
  })

  router.delete('/:id', async (req, res) => {
    const result = await db.deleteTemplate(req.params.id)
    if (!result.ok) {
      throw new HttpError(
        409,
        `Template is used by ${result.itemCount} item${result.itemCount === 1 ? '' : 's'} and cannot be deleted`,
      )
    }
    res.json({ ok: true })
  })

  return router
}
