import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ConflictError,
  Database,
  ensureDatabase,
  resetDatabase,
  ValidationError,
} from '../src/index.js'

const url =
  process.env.TEST_DATABASE_URL ?? 'postgres://antiquary:antiquary@localhost:5432/antiquary_test'

let db: Database
let collectionId: string
let templateId: string
let itemId: string
let tagId: string

beforeAll(async () => {
  await ensureDatabase(url)
  await resetDatabase(url)
  db = new Database(url)
})

afterAll(async () => {
  await db.close()
})

describe('collections', () => {
  it('creates a collection', async () => {
    const collection = await db.createCollection({
      name: 'Books',
      emoji: '📚',
      description: 'Sci-fi and fantasy',
    })
    expect(collection.id).toBeDefined()
    expect(collection.name).toBe('Books')
    expect(collection.itemCount).toBe(0)
    collectionId = collection.id
  })

  it('rejects a duplicate parent cycle', async () => {
    await expect(db.updateCollection(collectionId, { parentId: collectionId })).rejects.toThrow(
      ValidationError,
    )
  })

  it('lists collections with counts', async () => {
    const list = await db.listCollections()
    expect(list).toHaveLength(1)
    expect(list[0]!.itemCount).toBe(0)
  })

  it('updates a collection', async () => {
    const updated = await db.updateCollection(collectionId, { name: 'Book Shelf' })
    expect(updated?.name).toBe('Book Shelf')
    await db.updateCollection(collectionId, { name: 'Books' })
  })

  it('returns null for unknown collection', async () => {
    expect(await db.getCollection('00000000-0000-0000-0000-000000000000')).toBeNull()
  })
})

describe('templates', () => {
  it('creates a template with fields', async () => {
    const template = await db.createTemplate({
      name: 'Book details',
      description: 'Standard fields for books',
      fields: [
        { name: 'Author', type: 'text', required: true },
        { name: 'Published', type: 'date' },
        { name: 'Pages', type: 'number' },
        { name: 'Rating', type: 'rating' },
        { name: 'Genre', type: 'select', options: ['Sci-Fi', 'Fantasy'] },
        { name: 'Owned', type: 'checkbox' },
        { name: 'Review', type: 'textarea' },
        { name: 'Store', type: 'url' },
        { name: 'Cover art', type: 'image' },
        { name: 'Purchase price', type: 'price' },
      ],
    })
    expect(template.fields).toHaveLength(10)
    expect(template.fields[0]!.required).toBe(true)
    expect(template.fields[4]!.options).toEqual(['Sci-Fi', 'Fantasy'])
    templateId = template.id
  })

  it('rejects a select field without options', async () => {
    await expect(
      db.createTemplate({ name: 'Broken', fields: [{ name: 'Pick', type: 'select' }] }),
    ).rejects.toThrow(ValidationError)
  })

  it('binds a template to the collection', async () => {
    const updated = await db.updateCollection(collectionId, { templateId })
    expect(updated?.templateId).toBe(templateId)
  })

  it('counts templates', async () => {
    const templates = await db.listTemplates()
    expect(templates).toHaveLength(1)
    expect(templates.map((t) => t.name)).toContain('Book details')
  })
})

describe('items', () => {
  it('creates an item with field values', async () => {
    const template = await db.getTemplate(templateId)
    if (!template) throw new Error('template missing')
    const byName = new Map(template.fields.map((f) => [f.name, f]))
    const item = await db.createItem({
      collectionId,
      name: 'Dune',
      notes: 'First edition paperback',
      quantity: 2,
      isFavorite: true,
      fieldValues: [
        { fieldId: byName.get('Author')!.id, value: 'Frank Herbert' },
        { fieldId: byName.get('Published')!.id, value: '1965-08-01' },
        { fieldId: byName.get('Pages')!.id, value: 412 },
        { fieldId: byName.get('Rating')!.id, value: 5 },
        { fieldId: byName.get('Genre')!.id, value: 'Sci-Fi' },
        { fieldId: byName.get('Owned')!.id, value: true },
        { fieldId: byName.get('Cover art')!.id, value: '/uploads/cover-art.png' },
        { fieldId: byName.get('Purchase price')!.id, value: { amount: 8.99, currency: 'EUR' } },
      ],
    })
    expect(item.name).toBe('Dune')
    expect(item.templateName).toBe('Book details')
    expect(item.fields.find((f) => f.name === 'Author')?.value).toBe('Frank Herbert')
    expect(item.fields.find((f) => f.name === 'Rating')?.value).toBe(5)
    expect(item.fields.find((f) => f.name === 'Cover art')?.value).toBe('/uploads/cover-art.png')
    expect(item.fields.find((f) => f.name === 'Purchase price')?.value).toEqual({
      amount: 8.99,
      currency: 'EUR',
    })
    itemId = item.id
  })

  it('enforces required fields', async () => {
    const template = await db.getTemplate(templateId)
    const authorField = template!.fields.find((f) => f.name === 'Author')!
    await expect(
      db.createItem({ collectionId, name: 'No author', fieldValues: [] }),
    ).rejects.toThrow(/Author.*required/)
    await expect(
      db.createItem({
        collectionId,
        name: 'Bad author type',
        fieldValues: [{ fieldId: authorField.id, value: 42 }],
      }),
    ).rejects.toThrow(ValidationError)
  })

  it('rejects invalid select options, ratings, urls and dates', async () => {
    const template = await db.getTemplate(templateId)
    const byName = new Map(template!.fields.map((f) => [f.name, f]))
    const cases: { field: string; value: unknown }[] = [
      { field: 'Genre', value: 'Romance' },
      { field: 'Rating', value: 9 },
      { field: 'Store', value: 'not-a-url' },
      { field: 'Published', value: 'August 1965' },
      { field: 'Pages', value: 'many' },
      { field: 'Purchase price', value: { amount: 1, currency: 'euro' } },
      { field: 'Purchase price', value: { amount: 'cheap', currency: 'EUR' } },
      { field: 'Purchase price', value: 42 },
    ]
    for (const c of cases) {
      await expect(
        db.createItem({
          collectionId,
          name: 'X',
          fieldValues: [
            { fieldId: byName.get('Author')!.id, value: 'A' },
            { fieldId: byName.get(c.field)!.id, value: c.value as never },
          ],
        }),
      ).rejects.toThrow(ValidationError)
    }
  })

  it('updates an item and records a diff in history', async () => {
    const template = await db.getTemplate(templateId)
    const pagesField = template!.fields.find((f) => f.name === 'Pages')!
    const updated = await db.updateItem(itemId, {
      name: 'Dune Messiah',
      fieldValues: [{ fieldId: pagesField.id, value: 256 }],
    })
    expect(updated?.name).toBe('Dune Messiah')
    const history = await db.getItemHistory(itemId)
    const updateEvent = history.find((e) => e.action === 'updated')
    expect(updateEvent).toBeDefined()
    const nameChange = updateEvent!.changes!.find((c) => c.field === 'name')
    expect(nameChange?.from).toBe('Dune')
    expect(nameChange?.to).toBe('Dune Messiah')
    const pagesChange = updateEvent!.changes!.find((c) => c.field === `field:${pagesField.id}`)
    expect(pagesChange?.from).toBe(412)
    expect(pagesChange?.to).toBe(256)
  })

  it('skips history event when nothing changed', async () => {
    const before = await db.getItemHistory(itemId)
    await db.updateItem(itemId, { name: 'Dune Messiah' })
    const after = await db.getItemHistory(itemId)
    expect(after.length).toBe(before.length)
  })

  it('lists items with sorting and pagination', async () => {
    const result = await db.listItems({ collectionId, sort: 'name', order: 'asc' })
    expect(result.total).toBe(1)
    expect(result.items[0]!.name).toBe('Dune Messiah')
    const empty = await db.listItems({ collectionId, page: 2, limit: 10 })
    expect(empty.items).toHaveLength(0)
  })

  it('searches name, notes and field values', async () => {
    expect((await db.listItems({ search: 'messiah' })).total).toBe(1)
    expect((await db.listItems({ search: 'first edition' })).total).toBe(1)
    expect((await db.listItems({ search: 'frank herbert' })).total).toBe(1)
    expect((await db.listItems({ search: 'zzz' })).total).toBe(0)
  })
})

describe('tags', () => {
  it('creates tags and rejects duplicates', async () => {
    const tag = await db.createTag({ name: 'classic', color: '#7c3aed' })
    tagId = tag.id
    await expect(db.createTag({ name: 'Classic' })).rejects.toThrow(ConflictError)
  })

  it('assigns tags and filters by tag', async () => {
    await db.updateItem(itemId, { tagIds: [tagId] })
    const detail = await db.getItem(itemId)
    expect(detail?.tags.map((t) => t.name)).toEqual(['classic'])
    expect((await db.listItems({ tagId })).total).toBe(1)
    const tags = await db.listTags()
    expect(tags[0]!.itemCount).toBe(1)
  })
})

describe('images', () => {
  it('adds images, first becomes cover, delete promotes next', async () => {
    const first = await db.addImage(itemId, { filename: 'a.png', mime: 'image/png', size: 10 })
    const second = await db.addImage(itemId, { filename: 'b.png', mime: 'image/png', size: 10 })
    expect(first.isCover).toBe(true)
    expect(second.isCover).toBe(false)

    let detail = await db.getItem(itemId)
    expect(detail?.images).toHaveLength(2)
    expect(detail?.images[0]!.filename).toBe('a.png')

    await db.deleteImage(first.id)
    detail = await db.getItem(itemId)
    expect(detail?.images).toHaveLength(1)
    expect(detail?.images[0]!.isCover).toBe(true)

    const history = await db.getItemHistory(itemId)
    expect(history.filter((e) => e.action === 'image_added').length).toBe(2)
    expect(history.filter((e) => e.action === 'image_removed').length).toBe(1)
  })
})

describe('trash and restore', () => {
  it('soft deletes an item, hides it from lists, and restores it', async () => {
    await db.deleteItem(itemId)
    expect(await db.getItem(itemId)).toBeNull()
    expect((await db.listItems({ collectionId })).total).toBe(0)

    const trash = await db.getTrash()
    expect(trash.items).toHaveLength(1)
    expect(trash.items[0]!.name).toBe('Dune Messiah')

    await expect(db.deleteItem(itemId)).rejects.toThrow(ConflictError)

    const restored = await db.restoreItem(itemId)
    expect(restored.name).toBe('Dune Messiah')
    expect((await db.listItems({ collectionId })).total).toBe(1)

    const history = await db.getItemHistory(itemId)
    expect(history[0]!.action).toBe('restored')
    expect(history.find((e) => e.action === 'deleted')).toBeDefined()
  })

  it('purges a trashed item permanently', async () => {
    const template = await db.getTemplate(templateId)
    const author = template!.fields.find((f) => f.name === 'Author')!
    const scratch = await db.createItem({
      collectionId,
      name: 'Scratch',
      fieldValues: [{ fieldId: author.id, value: 'Nobody' }],
    })
    await db.deleteItem(scratch.id)
    await expect(db.purgeItem(scratch.id)).resolves.toEqual([])
    const trash = await db.getTrash()
    expect(trash.items.find((i) => i.id === scratch.id)).toBeUndefined()
  })

  it('refuses to purge an item that is not trashed', async () => {
    await expect(db.purgeItem(itemId)).rejects.toThrow(ConflictError)
  })

  it('trashes a collection together with its items and restores both', async () => {
    const { trashedItems } = await db.deleteCollection(collectionId)
    expect(trashedItems).toBe(1)
    expect((await db.listCollections()).length).toBe(0)

    const trash = await db.getTrash()
    expect(trash.collections).toHaveLength(1)

    // Item cannot be restored while its collection is trashed.
    await expect(db.restoreItem(itemId)).rejects.toThrow(ConflictError)

    await db.restoreCollection(collectionId)
    expect(await db.listCollections()).toHaveLength(1)
    expect((await db.listItems({ collectionId })).total).toBe(1)
    const history = await db.getItemHistory(itemId)
    expect(history[0]!.action).toBe('restored')
  })

  it('purges a trashed collection', async () => {
    await db.deleteCollection(collectionId)
    await db.purgeCollection(collectionId)
    expect((await db.getTrash()).collections).toHaveLength(0)
    expect(await db.getItem(itemId, { includeDeleted: true })).toBeNull()
    collectionId = (await db.createCollection({ name: 'Books' })).id
  })
})

describe('template updates preserve values', () => {
  it('keeps values for surviving fields and drops removed ones', async () => {
    await db.updateCollection(collectionId, { templateId })
    const template = await db.getTemplate(templateId)
    if (!template) throw new Error('template missing')
    const author = template.fields.find((f) => f.name === 'Author')!
    const pages = template.fields.find((f) => f.name === 'Pages')!
    const item = await db.createItem({
      collectionId,
      name: 'Foundation',
      fieldValues: [
        { fieldId: author.id, value: 'Isaac Asimov' },
        { fieldId: pages.id, value: 255 },
      ],
    })

    await db.updateTemplate(templateId, {
      fields: [
        { id: author.id, name: 'Author', type: 'text', required: true },
        { id: pages.id, name: 'Page Count', type: 'number' },
        { name: 'Series', type: 'text' },
      ],
    })

    const after = await db.getItem(item.id)
    expect(after?.fields.find((f) => f.id === author.id)?.value).toBe('Isaac Asimov')
    expect(after?.fields.find((f) => f.id === pages.id)?.value).toBe(255)
    expect(after?.fields.find((f) => f.name === 'Page Count')).toBeDefined()

    const usage = await db.deleteTemplate(templateId)
    expect(usage).toEqual({ ok: false, collectionCount: 1 })
  })
})

describe('api keys', () => {
  it('creates keys with one-time plaintext, unique names, and authenticates by hash', async () => {
    const { apiKey, key } = await db.createApiKey('Claude desktop', true)
    expect(key).toMatch(/^mcp_[0-9a-f]{64}$/)
    expect(apiKey.name).toBe('Claude desktop')
    expect(apiKey.readonly).toBe(true)

    await expect(db.createApiKey('claude desktop', false)).rejects.toThrow(ConflictError)
    await expect(db.createApiKey('  ', false)).rejects.toThrow(ValidationError)

    const authed = await db.authenticateApiKey(key)
    expect(authed?.id).toBe(apiKey.id)
    expect(await db.authenticateApiKey('mcp_not-a-real-key')).toBeNull()
    expect(await db.authenticateApiKey('nope')).toBeNull()

    const list = await db.listApiKeys()
    expect(list).toHaveLength(1)
    expect(list[0]!.lastUsedAt).toBeNull()
  })

  it('revoked keys no longer authenticate', async () => {
    const { apiKey, key } = await db.createApiKey('Old client', false)
    await db.revokeApiKey(apiKey.id)
    expect(await db.authenticateApiKey(key)).toBeNull()
    const list = await db.listApiKeys()
    expect(list.find((k) => k.id === apiKey.id)?.revokedAt).toBeTruthy()
    await expect(db.revokeApiKey('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      ValidationError,
    )
  })
})

describe('stats', () => {
  it('computes dashboard stats', async () => {
    const stats = await db.getStats()
    expect(stats.collectionCount).toBe(1)
    expect(stats.itemCount).toBe(1)
    expect(stats.tagCount).toBe(1)
    expect(stats.recentItems.length).toBeGreaterThan(0)
  })
})

describe('supersets', () => {
  it('auto-adds catalog fields to a superset template', async () => {
    const template = await db.createTemplate({
      name: 'SNES games',
      superset: 'snes',
      fields: [{ name: 'Condition', type: 'text' }],
    })
    expect(template.superset).toBe('snes')
    expect(template.fields.map((f) => f.name)).toEqual([
      'Condition',
      'Region',
      'Serial',
      'Developer',
      'Publisher',
      'Genre',
      'Year',
    ])
    const region = template.fields.find((f) => f.name === 'Region')!
    expect(region.type).toBe('select')
    expect(region.options).toContain('USA')
  })

  it('appends catalog fields when a superset is added to an existing template', async () => {
    const plain = await db.createTemplate({
      name: 'Plain games template',
      fields: [{ name: 'Condition', type: 'text' }],
    })
    const updated = await db.updateTemplate(plain.id, { superset: 'snes' })
    expect(updated?.fields.map((f) => f.name)).toEqual([
      'Condition',
      'Region',
      'Serial',
      'Developer',
      'Publisher',
      'Genre',
      'Year',
    ])
  })

  it('keeps user-defined fields with matching names', async () => {
    const template = await db.createTemplate({
      name: 'Custom region field',
      superset: 'snes',
      fields: [{ name: 'region', type: 'textarea' }],
    })
    expect(template.fields[0]!.name).toBe('region')
    expect(template.fields[0]!.type).toBe('textarea')
    expect(template.fields.filter((f) => f.name.toLowerCase() === 'region')).toHaveLength(1)
  })

  it('stores superset + entry on items and follows collection template changes', async () => {
    const tpl = await db.createTemplate({
      name: 'SNES catalog template',
      superset: 'snes',
      fields: [],
    })
    const coll = await db.createCollection({ name: 'SNES shelf', templateId: tpl.id })

    await expect(db.createItem({ collectionId: coll.id, name: 'Chrono Trigger' })).rejects.toThrow(
      ValidationError,
    )

    const item = await db.createItem({
      collectionId: coll.id,
      supersetEntry: '2D206BF7',
      name: 'Chrono Trigger',
    })
    expect(item.superset).toBe('snes')
    expect(item.supersetEntry).toBe('2D206BF7')

    const plain = await db.createTemplate({ name: 'No catalog template' })
    await db.updateCollection(coll.id, { templateId: plain.id })
    const after = await db.getItem(item.id)
    expect(after?.superset).toBeNull()
    expect(after?.supersetEntry).toBeNull()
    expect(after?.templateName).toBe('No catalog template')
  })
})
