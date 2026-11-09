import { Router } from 'express'
import type { Database } from '@antiquary/database'
import { HttpError } from '../errors.js'
import { createCollectionSchema, updateCollectionSchema } from '../schemas.js'
import type { SupersetRegistry } from '../supersets.js'
import { computeCompletion } from '../supersets.js'

export function collectionRoutes(db: Database, supersets: SupersetRegistry): Router {
  const router = Router()

  router.get('/', async (_req, res) => {
    const [collections, templates, entries] = await Promise.all([
      db.listCollections(),
      db.listTemplates(),
      db.listSupersetEntriesByCollection(),
    ])
    const supersetByTemplate = new Map(templates.map((t) => [t.id, t.superset]))
    const entriesByCollection = new Map<string, { superset: string; supersetEntry: string }[]>()
    for (const entry of entries) {
      const list = entriesByCollection.get(entry.collectionId) ?? []
      list.push({ superset: entry.superset, supersetEntry: entry.supersetEntry })
      entriesByCollection.set(entry.collectionId, list)
    }
    const collectionsWithCompletion = await Promise.all(
      collections.map(async (collection) => {
        const key = collection.templateId ? supersetByTemplate.get(collection.templateId) : null
        return {
          ...collection,
          completion: key
            ? await computeCompletion(entriesByCollection.get(collection.id) ?? [], supersets, key)
            : null,
        }
      }),
    )
    res.json(collectionsWithCompletion)
  })

  router.post('/', async (req, res) => {
    const input = createCollectionSchema.parse(req.body)
    res.status(201).json(await db.createCollection(input))
  })

  router.get('/:id', async (req, res) => {
    const collection = await db.getCollection(req.params.id)
    if (!collection) throw new HttpError(404, 'Collection not found')
    let completion = null
    if (collection.templateId) {
      const template = await db.getTemplate(collection.templateId)
      if (template?.superset) {
        const entries = await db.getCollectionSupersetEntries(collection.id)
        completion = await computeCompletion(entries, supersets, template.superset)
      }
    }
    res.json({ ...collection, completion })
  })

  router.patch('/:id', async (req, res) => {
    const patch = updateCollectionSchema.parse(req.body)
    const updated = await db.updateCollection(req.params.id, patch)
    if (!updated) throw new HttpError(404, 'Collection not found')
    res.json(updated)
  })

  router.delete('/:id', async (req, res) => {
    if (req.query.permanent === 'true') {
      await db.purgeCollection(req.params.id)
      res.json({ ok: true, purged: true })
    } else {
      const existing = await db.getCollection(req.params.id)
      if (!existing) throw new HttpError(404, 'Collection not found')
      const { trashedItems } = await db.deleteCollection(req.params.id)
      res.json({ ok: true, trashedItems })
    }
  })

  router.post('/:id/restore', async (req, res) => {
    const existing = await db.getCollection(req.params.id)
    if (existing) throw new HttpError(409, 'Collection is not in the trash')
    res.json(await db.restoreCollection(req.params.id))
  })

  return router
}
