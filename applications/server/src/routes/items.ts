import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { Router } from 'express'
import type { Database, ItemDetailDto } from '@antiquary/database'
import { HttpError } from '../errors.js'
import { createItemSchema, listItemsQuerySchema, updateItemSchema } from '../schemas.js'
import { createUploadMiddleware } from '../upload.js'
import type { SupersetRegistry } from '../supersets.js'

/** Fills in supersetLabel for items matched against a catalog entry. */
async function enrich(item: ItemDetailDto, supersets: SupersetRegistry): Promise<ItemDetailDto> {
  if (!item.superset || !item.supersetEntry) return { ...item, supersetLabel: null }
  const entry = await supersets.getEntry(item.superset, item.supersetEntry)
  return { ...item, supersetLabel: entry?.name ?? null }
}

export function itemRoutes(db: Database, uploadDir: string, supersets: SupersetRegistry): Router {
  const router = Router()
  const upload = createUploadMiddleware(uploadDir)

  router.get('/', async (req, res) => {
    const query = listItemsQuerySchema.parse(req.query)
    res.json(await db.listItems(query))
  })

  router.post('/', async (req, res) => {
    const input = createItemSchema.parse(req.body)
    const collection = await db.getCollection(input.collectionId)
    if (!collection) throw new HttpError(404, 'Collection not found')
    const template = collection.templateId ? await db.getTemplate(collection.templateId) : null

    if (template?.superset) {
      const complete = supersets.get(template.superset)?.complete ?? true
      if (input.outsideSuperset && complete) {
        throw new HttpError(
          400,
          `The ${template.superset} catalog is exhaustive — every item must match an entry`,
        )
      }
      if (input.supersetEntry) {
        if (input.outsideSuperset) {
          throw new HttpError(
            400,
            'Pick either a catalog match or "outside the superset", not both',
          )
        }
        const entry = await supersets.getEntry(template.superset, input.supersetEntry)
        if (!entry) throw new HttpError(400, 'Unknown catalog entry')
      } else if (complete) {
        throw new HttpError(
          400,
          `This collection requires a catalog match — pick a title and variant from the ${template.superset} catalog before saving`,
        )
      } else if (!input.outsideSuperset) {
        throw new HttpError(
          400,
          `The ${template.superset} catalog is not exhaustive — match an entry from it, or explicitly mark this item as outside the superset`,
        )
      }
    } else if (input.supersetEntry || input.outsideSuperset) {
      throw new HttpError(400, 'Catalog entries can only be used with a superset template')
    }

    const item = await db.createItem(input)
    res.status(201).json(await enrich(item, supersets))
  })

  router.post('/:id/images', upload.array('images', 10), async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? []
    if (files.length === 0) throw new HttpError(400, 'No images uploaded')
    const itemId = req.params.id as string
    const item = await db.getItem(itemId)
    if (!item) throw new HttpError(404, 'Item not found')
    const images = []
    for (const file of files) {
      images.push(
        await db.addImage(itemId, {
          filename: file.filename,
          mime: file.mimetype,
          size: file.size,
        }),
      )
    }
    res.status(201).json({ images })
  })

  router.get('/:id', async (req, res) => {
    const item = await db.getItem(req.params.id)
    if (!item) throw new HttpError(404, 'Item not found')
    res.json(await enrich(item, supersets))
  })

  router.patch('/:id', async (req, res) => {
    const patch = updateItemSchema.parse(req.body)

    if (patch.supersetEntry !== undefined || patch.outsideSuperset !== undefined) {
      const current = await db.getItem(req.params.id)
      if (!current) throw new HttpError(404, 'Item not found')
      const collection = await db.getCollection(current.collectionId)
      const template = collection?.templateId ? await db.getTemplate(collection.templateId) : null
      const complete = template?.superset
        ? (supersets.get(template.superset)?.complete ?? true)
        : true
      if (patch.outsideSuperset) {
        if (!template?.superset) {
          throw new HttpError(400, 'Catalog entries can only be used with a superset template')
        }
        if (complete) {
          throw new HttpError(
            400,
            `The ${template.superset} catalog is exhaustive — every item needs a match`,
          )
        }
        if (patch.supersetEntry) {
          throw new HttpError(
            400,
            'Pick either a catalog match or "outside the superset", not both',
          )
        }
      }
      if (patch.supersetEntry) {
        if (!template?.superset) {
          throw new HttpError(400, 'Catalog entries can only be used with a superset template')
        }
        const entry = await supersets.getEntry(template.superset, patch.supersetEntry)
        if (!entry) throw new HttpError(400, 'Unknown catalog entry')
      } else if (patch.supersetEntry === null && template?.superset && !patch.outsideSuperset) {
        throw new HttpError(
          400,
          'This collection requires a catalog match — pick a different variant to change it',
        )
      }
    }

    const updated = await db.updateItem(req.params.id, patch)
    if (!updated) throw new HttpError(404, 'Item not found')
    res.json(await enrich(updated, supersets))
  })

  router.delete('/:id', async (req, res) => {
    if (req.query.permanent === 'true') {
      const filenames = await db.purgeItem(req.params.id)
      await Promise.allSettled(filenames.map((f) => unlink(join(uploadDir, f))))
      res.json({ ok: true, purged: true })
    } else {
      await db.deleteItem(req.params.id)
      res.json({ ok: true })
    }
  })

  router.post('/:id/restore', async (req, res) => {
    const item = await db.restoreItem(req.params.id)
    res.json(await enrich(item, supersets))
  })

  router.get('/:id/history', async (req, res) => {
    const item = await db.getItem(req.params.id, { includeDeleted: true })
    if (!item) throw new HttpError(404, 'Item not found')
    res.json({ events: await db.getItemHistory(req.params.id) })
  })

  return router
}

export function imageRoutes(db: Database, uploadDir: string): Router {
  const router = Router()

  router.post('/', createUploadMiddleware(uploadDir).single('image'), (req, res) => {
    const file = req.file as Express.Multer.File | undefined
    if (!file) throw new HttpError(400, 'No image uploaded')
    res.status(201).json({
      filename: file.filename,
      url: `/uploads/${file.filename}`,
      mime: file.mimetype,
      size: file.size,
    })
  })

  router.patch('/:imageId', async (req, res) => {
    const body = req.body as { caption?: string | null; isCover?: boolean }
    const updated = await db.updateImage(req.params.imageId, body)
    if (!updated) throw new HttpError(404, 'Image not found')
    res.json(updated)
  })

  router.delete('/:imageId', async (req, res) => {
    const removed = await db.deleteImage(req.params.imageId)
    if (!removed) throw new HttpError(404, 'Image not found')
    await unlink(join(uploadDir, removed.filename)).catch(() => {})
    res.json({ ok: true })
  })

  return router
}
