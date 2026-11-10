import { createHash, randomBytes } from 'node:crypto'
import {
  CamelCasePlugin,
  Kysely,
  PostgresDialect,
  sql,
  type ExpressionBuilder,
  type RawBuilder,
} from 'kysely'
import pg from 'pg'
import { ConflictError, ValidationError } from './errors.js'
import type {
  CollectionDto,
  DBSchema,
  FieldValue,
  FieldType,
  HistoryAction,
  HistoryChange,
  HistoryEventDto,
  ImageDto,
  ItemDetailDto,
  ItemFieldWithValueDto,
  ItemListItemDto,
  ItemListResultDto,
  ItemSnapshot,
  ItemTagDto,
  PriceValue,
  StatsDto,
  TagDto,
  TemplateDetailDto,
  TemplateFieldDto,
  TrashDto,
  ApiKeyDto,
} from './types.js'

/**
 * Every helper runs against either the root Kysely instance or an open
 * transaction. Transaction is runtime-compatible with Kysely; call sites cast.
 */
type Exec = Kysely<DBSchema>

function asExec(tx: unknown): Exec {
  return tx as Exec
}

/**
 * node-postgres does not JSON-encode objects passed as parameters for jsonb
 * columns (JS arrays would become postgres array literals), so jsonb params
 * are stringified here. Values are parsed back automatically on read.
 */
function jsonParam<T>(value: T): T {
  return (value === null || value === undefined ? value : JSON.stringify(value)) as unknown as T
}

export interface ItemListOptions {
  collectionId?: string
  search?: string
  favorite?: boolean
  tagId?: string
  sort?: 'created' | 'updated' | 'name'
  order?: 'asc' | 'desc'
  page?: number
  limit?: number
}

export interface CreateCollectionInput {
  name: string
  description?: string | null
  emoji?: string | null
  color?: string | null
  parentId?: string | null
  templateId?: string | null
}

export interface UpdateCollectionInput {
  name?: string
  description?: string | null
  emoji?: string | null
  color?: string | null
  parentId?: string | null
  templateId?: string | null
}

export interface TemplateFieldInput {
  id?: string
  name: string
  type: FieldType
  options?: string[] | null
  required?: boolean
  position?: number
}

export interface CreateTemplateInput {
  name: string
  description?: string | null
  superset?: string | null
  fields?: TemplateFieldInput[]
}

export interface UpdateTemplateInput {
  name?: string
  description?: string | null
  superset?: string | null
  fields?: TemplateFieldInput[]
}

export interface CreateItemInput {
  collectionId: string
  supersetEntry?: string | null
  name: string
  notes?: string | null
  quantity?: number
  isFavorite?: boolean
  fieldValues?: { fieldId: string; value: FieldValue }[]
  tagIds?: string[]
}

export interface UpdateItemInput {
  name?: string
  notes?: string | null
  quantity?: number
  isFavorite?: boolean
  supersetEntry?: string | null
  fieldValues?: { fieldId: string; value: FieldValue }[]
  tagIds?: string[]
}

export interface CreateTagInput {
  name: string
  color?: string | null
}

export interface AddImageInput {
  filename: string
  mime: string
  size: number
  caption?: string | null
}

const THUMBNAIL_SQL = sql<string | null>`(
  select '/uploads/' || im.filename from images im
  where im.item_id = items.id
  order by im.is_cover desc, im.position asc, im.created_at asc
  limit 1
)`

/** Regions offered for the auto-added Region field on superset templates. */
export const CATALOG_REGIONS = [
  'USA',
  'Japan',
  'Europe',
  'France',
  'Germany',
  'Italy',
  'Spain',
  'Sweden',
  'Australia',
  'Brazil',
  'Canada',
  'Netherlands',
  'Korea',
  'Hong Kong',
  'Taiwan',
  'China',
  'World',
]

/**
 * Fields auto-added to a template bound to a superset, so picked catalog
 * entries have somewhere to land. Existing fields with the same name
 * (case-insensitive) are kept as they are.
 */
export const CATALOG_FIELD_DEFS: TemplateFieldInput[] = [
  { name: 'Region', type: 'select', options: CATALOG_REGIONS },
  { name: 'Serial', type: 'text' },
  { name: 'Developer', type: 'text' },
  { name: 'Publisher', type: 'text' },
  { name: 'Genre', type: 'text' },
  { name: 'Year', type: 'number' },
]

function ensureCatalogFields(
  fields: TemplateFieldInput[],
  superset: string | null | undefined,
): TemplateFieldInput[] {
  if (!superset) return fields
  const names = new Set(fields.map((f) => f.name.trim().toLowerCase()))
  const missing = CATALOG_FIELD_DEFS.filter((def) => !names.has(def.name.toLowerCase()))
  return [...fields, ...missing]
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`)
}

function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null
}

export function createKysely(connectionString: string): Kysely<DBSchema> {
  return new Kysely<DBSchema>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max: 10 }) }),
    plugins: [new CamelCasePlugin()],
  })
}

/**
 * Owns the Kysely instance and exposes every method needed to manipulate the
 * database. All route handlers go through this class — no SQL leaks elsewhere.
 */
export class Database {
  private readonly db: Kysely<DBSchema>

  constructor(connectionString: string) {
    this.db = createKysely(connectionString)
  }

  async close(): Promise<void> {
    await this.db.destroy()
  }

  /* --------------------------------------------------------------- */
  /* Collections                                                      */
  /* --------------------------------------------------------------- */

  async listCollections(): Promise<CollectionDto[]> {
    const rows = await this.db
      .selectFrom('collections')
      .where('collections.deletedAt', 'is', null)
      .orderBy('collections.name', 'asc')
      .select((eb) => [
        'collections.id',
        'collections.name',
        'collections.description',
        'collections.emoji',
        'collections.color',
        'collections.parentId',
        'collections.templateId',
        'collections.createdAt',
        'collections.updatedAt',
        eb
          .selectFrom('items')
          .whereRef('items.collectionId', '=', 'collections.id')
          .where('items.deletedAt', 'is', null)
          .select((eb2) => eb2.fn.countAll<number>().as('count'))
          .as('itemCount'),
      ])
      .execute()

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      emoji: row.emoji,
      color: row.color,
      parentId: row.parentId,
      templateId: row.templateId,
      itemCount: Number(row.itemCount),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }))
  }

  async createCollection(input: CreateCollectionInput): Promise<CollectionDto> {
    if (input.parentId) {
      const parent = await this.findCollectionRow(input.parentId)
      if (!parent || parent.deletedAt) {
        throw new ValidationError('Parent collection not found')
      }
    }
    if (input.templateId) {
      const template = await this.db
        .selectFrom('templates')
        .where('id', '=', input.templateId)
        .select('id')
        .executeTakeFirst()
      if (!template) throw new ValidationError('Template not found')
    }
    const row = await this.db
      .insertInto('collections')
      .values({
        name: input.name.trim(),
        description: input.description ?? null,
        emoji: input.emoji ?? null,
        color: input.color ?? null,
        parentId: input.parentId ?? null,
        templateId: input.templateId ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      emoji: row.emoji,
      color: row.color,
      parentId: row.parentId,
      templateId: row.templateId,
      itemCount: 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  }

  async getCollection(id: string): Promise<CollectionDto | null> {
    const row = await this.findCollectionRow(id)
    if (!row || row.deletedAt) return null
    const count = await this.db
      .selectFrom('items')
      .where('items.collectionId', '=', id)
      .where('items.deletedAt', 'is', null)
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow()
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      emoji: row.emoji,
      color: row.color,
      parentId: row.parentId,
      templateId: row.templateId,
      itemCount: Number(count.count),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  }

  async updateCollection(id: string, patch: UpdateCollectionInput): Promise<CollectionDto | null> {
    const row = await this.findCollectionRow(id)
    if (!row || row.deletedAt) return null
    if (patch.parentId) {
      if (patch.parentId === id) throw new ValidationError('A collection cannot be its own parent')
      const parent = await this.findCollectionRow(patch.parentId)
      if (!parent || parent.deletedAt) throw new ValidationError('Parent collection not found')
    }

    await this.db.transaction().execute(async (tx) => {
      const trx = asExec(tx)
      if (patch.templateId !== undefined) {
        let nextSuperset: string | null = null
        let nextFieldIds: string[] = []
        if (patch.templateId) {
          const template = await trx
            .selectFrom('templates')
            .where('id', '=', patch.templateId)
            .selectAll()
            .executeTakeFirst()
          if (!template) throw new ValidationError('Template not found')
          nextSuperset = template.superset
          const fields = await trx
            .selectFrom('templateFields')
            .where('templateFields.templateId', '=', patch.templateId)
            .select('templateFields.id')
            .execute()
          nextFieldIds = fields.map((f) => f.id)
        }
        // Keep item data consistent with the new template: drop field values
        // that no longer belong to it, and clear catalog matches that point
        // at a different catalog than the new template is bound to.
        const itemsOfCollection = (eb: ExpressionBuilder<DBSchema, 'itemFieldValues'>) =>
          eb.selectFrom('items').select('items.id').where('items.collectionId', '=', id)
        if (nextFieldIds.length === 0) {
          await trx.deleteFrom('itemFieldValues').where('itemId', 'in', itemsOfCollection).execute()
        } else {
          await trx
            .deleteFrom('itemFieldValues')
            .where('itemId', 'in', itemsOfCollection)
            .where('fieldId', 'not in', nextFieldIds)
            .execute()
        }
        await trx
          .updateTable('items')
          .set({ superset: null, supersetEntry: null })
          .where('collectionId', '=', id)
          .where('superset', 'is distinct from', nextSuperset)
          .execute()
      }
      await trx
        .updateTable('collections')
        .set({
          ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.emoji !== undefined ? { emoji: patch.emoji } : {}),
          ...(patch.color !== undefined ? { color: patch.color } : {}),
          ...(patch.parentId !== undefined ? { parentId: patch.parentId } : {}),
          ...(patch.templateId !== undefined ? { templateId: patch.templateId } : {}),
          updatedAt: new Date(),
        })
        .where('collections.id', '=', id)
        .execute()
    })
    return this.getCollection(id)
  }

  /**
   * Soft-deletes the collection and every active item inside it, so both stay
   * restorable from the trash. Items are stamped with the exact same timestamp
   * as the collection, which is what restoreCollection matches against.
   */
  async deleteCollection(id: string): Promise<{ trashedItems: number }> {
    return this.db.transaction().execute(async (tx) => {
      const trx = asExec(tx)
      const row = await trx
        .selectFrom('collections')
        .where('collections.id', '=', id)
        .selectAll()
        .executeTakeFirst()
      if (!row) throw new ValidationError('Collection not found')
      if (row.deletedAt) throw new ConflictError('Collection is already in the trash')

      const deletedAt = new Date()
      const itemIds = await trx
        .updateTable('items')
        .set({ deletedAt })
        .where('items.collectionId', '=', id)
        .where('items.deletedAt', 'is', null)
        .returning('items.id')
        .execute()

      await trx
        .updateTable('collections')
        .set({ deletedAt })
        .where('collections.id', '=', id)
        .execute()

      for (const item of itemIds) {
        await this.recordEvent(trx, item.id, 'deleted', null)
      }
      return { trashedItems: itemIds.length }
    })
  }

  async restoreCollection(id: string): Promise<CollectionDto> {
    await this.db.transaction().execute(async (tx) => {
      const trx = asExec(tx)
      const row = await trx
        .selectFrom('collections')
        .where('collections.id', '=', id)
        .selectAll()
        .executeTakeFirst()
      if (!row) throw new ValidationError('Collection not found')
      if (!row.deletedAt) throw new ConflictError('Collection is not in the trash')

      const restoredItems = await trx
        .updateTable('items')
        .set({ deletedAt: null })
        .where('items.collectionId', '=', id)
        .where('items.deletedAt', '=', row.deletedAt)
        .returning('items.id')
        .execute()

      await trx
        .updateTable('collections')
        .set({ deletedAt: null, updatedAt: new Date() })
        .where('collections.id', '=', id)
        .execute()

      for (const item of restoredItems) {
        await this.recordEvent(trx, item.id, 'restored', null)
      }
    })
    const restored = await this.getCollection(id)
    if (!restored) throw new ValidationError('Collection not found after restore')
    return restored
  }

  async purgeCollection(id: string): Promise<void> {
    const row = await this.findCollectionRow(id)
    if (!row) throw new ValidationError('Collection not found')
    if (!row.deletedAt) {
      throw new ConflictError('Move the collection to the trash before deleting it permanently')
    }
    await this.db.deleteFrom('collections').where('collections.id', '=', id).execute()
  }

  /** All catalog-matched active items, for collection completion math. */
  async listSupersetEntriesByCollection(): Promise<
    { collectionId: string; superset: string; supersetEntry: string }[]
  > {
    const rows = await this.db
      .selectFrom('items')
      .where('items.deletedAt', 'is', null)
      .where('items.superset', 'is not', null)
      .where('items.supersetEntry', 'is not', null)
      .select(['items.collectionId', 'items.superset', 'items.supersetEntry'])
      .execute()
    return rows.filter(
      (row): row is { collectionId: string; superset: string; supersetEntry: string } =>
        row.superset !== null && row.supersetEntry !== null,
    )
  }

  /** Catalog matches for one collection. */
  async getCollectionSupersetEntries(
    collectionId: string,
  ): Promise<{ superset: string; supersetEntry: string }[]> {
    const rows = await this.db
      .selectFrom('items')
      .where('items.deletedAt', 'is', null)
      .where('items.collectionId', '=', collectionId)
      .where('items.superset', 'is not', null)
      .where('items.supersetEntry', 'is not', null)
      .select(['items.superset', 'items.supersetEntry'])
      .execute()
    return rows.filter(
      (row): row is { superset: string; supersetEntry: string } =>
        row.superset !== null && row.supersetEntry !== null,
    )
  }

  /* --------------------------------------------------------------- */
  /* Templates                                                        */
  /* --------------------------------------------------------------- */

  async listTemplates(): Promise<TemplateDetailDto[]> {
    const templates = await this.db
      .selectFrom('templates')
      .orderBy('templates.name', 'asc')
      .select((eb) => [
        'templates.id',
        'templates.name',
        'templates.description',
        'templates.superset',
        'templates.createdAt',
        'templates.updatedAt',
        eb
          .selectFrom('templateFields')
          .whereRef('templateFields.templateId', '=', 'templates.id')
          .select((eb2) => eb2.fn.countAll<number>().as('count'))
          .as('fieldCount'),
        eb
          .selectFrom('items')
          .innerJoin('collections', (join) =>
            join.onRef('collections.id', '=', 'items.collectionId'),
          )
          .whereRef('collections.templateId', '=', 'templates.id')
          .where('items.deletedAt', 'is', null)
          .select((eb2) => eb2.fn.countAll<number>().as('count'))
          .as('itemCount'),
      ])
      .execute()
    if (templates.length === 0) return []
    const fields = await this.db
      .selectFrom('templateFields')
      .orderBy('templateFields.position', 'asc')
      .selectAll()
      .execute()
    return templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      superset: t.superset,
      fieldCount: Number(t.fieldCount),
      itemCount: Number(t.itemCount),
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      fields: fields
        .filter((f) => f.templateId === t.id)
        .map((f) => ({
          id: f.id,
          templateId: f.templateId,
          name: f.name,
          type: f.type,
          options: f.options,
          required: f.required,
          position: f.position,
        })),
    }))
  }

  async getTemplate(id: string): Promise<TemplateDetailDto | null> {
    const all = await this.listTemplates()
    return all.find((t) => t.id === id) ?? null
  }

  async createTemplate(input: CreateTemplateInput): Promise<TemplateDetailDto> {
    const id: string = await this.db.transaction().execute(async (tx) => {
      const trx = asExec(tx)
      const row = await trx
        .insertInto('templates')
        .values({
          name: input.name.trim(),
          description: input.description ?? null,
          superset: input.superset ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
      await this.insertFields(trx, row.id, ensureCatalogFields(input.fields ?? [], input.superset))
      return row.id
    })
    const created = await this.getTemplate(id)
    if (!created) throw new Error('Template vanished after creation')
    return created
  }

  async updateTemplate(id: string, patch: UpdateTemplateInput): Promise<TemplateDetailDto | null> {
    const existing = await this.getTemplate(id)
    if (!existing) return null

    await this.db.transaction().execute(async (tx) => {
      const trx = asExec(tx)
      const nextSuperset = patch.superset !== undefined ? patch.superset : existing.superset
      await trx
        .updateTable('templates')
        .set({
          ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.superset !== undefined ? { superset: patch.superset } : {}),
          updatedAt: new Date(),
        })
        .where('templates.id', '=', id)
        .execute()

      if (patch.fields) {
        patch.fields = ensureCatalogFields(patch.fields, nextSuperset)
        const existingIds = new Set(existing.fields.map((f) => f.id))
        const keptIds = new Set(patch.fields.filter((f) => f.id).map((f) => f.id as string))
        for (const fieldId of existingIds) {
          if (!keptIds.has(fieldId)) {
            await trx.deleteFrom('itemFieldValues').where('fieldId', '=', fieldId).execute()
            await trx.deleteFrom('templateFields').where('id', '=', fieldId).execute()
          }
        }
        for (const [index, field] of patch.fields.entries()) {
          if (field.id && existingIds.has(field.id)) {
            await trx
              .updateTable('templateFields')
              .set({
                name: field.name.trim(),
                type: field.type,
                options: jsonParam(normalizeOptions(field)),
                required: field.required ?? false,
                position: index,
              })
              .where('id', '=', field.id)
              .execute()
          } else {
            await trx
              .insertInto('templateFields')
              .values({
                templateId: id,
                name: field.name.trim(),
                type: field.type,
                options: normalizeOptions(field),
                required: field.required ?? false,
                position: index,
              })
              .execute()
          }
        }
      } else if (nextSuperset) {
        // Superset bound (or kept) without a field rewrite: make sure the
        // catalog fields exist on top of whatever the template already has.
        const present = new Set(existing.fields.map((f) => f.name.trim().toLowerCase()))
        let position = existing.fields.length
        for (const def of CATALOG_FIELD_DEFS) {
          if (present.has(def.name.toLowerCase())) continue
          await trx
            .insertInto('templateFields')
            .values({
              templateId: id,
              name: def.name,
              type: def.type,
              options: jsonParam(def.options ?? null),
              required: false,
              position: position++,
            })
            .execute()
        }
      }
    })
    return this.getTemplate(id)
  }

  async deleteTemplate(id: string): Promise<{ ok: boolean; collectionCount: number }> {
    const count = await this.db
      .selectFrom('collections')
      .where('collections.templateId', '=', id)
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow()
    const collectionCount = Number(count.count)
    if (collectionCount > 0) {
      return { ok: false, collectionCount }
    }
    await this.db.deleteFrom('templates').where('templates.id', '=', id).execute()
    return { ok: true, collectionCount: 0 }
  }

  /* --------------------------------------------------------------- */
  /* Items                                                            */
  /* --------------------------------------------------------------- */

  async listItems(opts: ItemListOptions = {}): Promise<ItemListResultDto> {
    const page = Math.max(1, opts.page ?? 1)
    const limit = Math.min(100, Math.max(1, opts.limit ?? 24))

    const conditions = (eb: ExpressionBuilder<DBSchema, 'items'>) => {
      const conds: RawBuilder<boolean>[] = [sql<boolean>`items.deleted_at is null`]
      if (opts.collectionId) conds.push(sql<boolean>`items.collection_id = ${opts.collectionId}`)
      if (opts.favorite) conds.push(sql<boolean>`items.is_favorite = true`)
      if (opts.tagId) {
        conds.push(
          sql<boolean>`exists (select 1 from item_tags it where it.item_id = items.id and it.tag_id = ${opts.tagId})`,
        )
      }
      if (opts.search) {
        const like = `%${escapeLike(opts.search)}%`
        conds.push(
          sql<boolean>`(items.name ilike ${like} or coalesce(items.notes, '') ilike ${like} or exists (
            select 1 from item_field_values ifv
            where ifv.item_id = items.id and ifv.value::text ilike ${like}
          ))`,
        )
      }
      return eb.and(conds)
    }

    const sortColumn =
      opts.sort === 'name'
        ? 'lower(items.name)'
        : opts.sort === 'updated'
          ? 'items.updated_at'
          : 'items.created_at'
    const direction =
      opts.order === 'asc'
        ? 'asc'
        : opts.order === 'desc'
          ? 'desc'
          : opts.sort === 'name'
            ? 'asc'
            : 'desc'

    const totalRow = await this.db
      .selectFrom('items')
      .where(conditions)
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow()

    const rows = await this.db
      .selectFrom('items')
      .innerJoin('collections', 'collections.id', 'items.collectionId')
      .where(conditions)
      .orderBy(sql.raw(`${sortColumn} ${direction}`))
      .limit(limit)
      .offset((page - 1) * limit)
      .select((_eb) => [
        'items.id',
        'items.name',
        'items.collectionId',
        'items.isFavorite',
        'items.quantity',
        'items.createdAt',
        'items.updatedAt',
        'collections.name as collectionName',
        'collections.emoji as collectionEmoji',
        THUMBNAIL_SQL.as('thumbnailUrl'),
      ])
      .execute()

    const items = await this.attachTags(rows as unknown as ItemRow[])
    return { items, total: Number(totalRow.count), page, limit }
  }

  async createItem(input: CreateItemInput): Promise<ItemDetailDto> {
    const id: string = await this.db.transaction().execute(async (tx) => {
      const trx = asExec(tx)
      const collection = await trx
        .selectFrom('collections')
        .where('collections.id', '=', input.collectionId)
        .selectAll()
        .executeTakeFirst()
      if (!collection || collection.deletedAt) {
        throw new ValidationError('Collection not found')
      }

      const template = await this.loadTemplate(trx, collection.templateId)
      if (template.superset && !input.supersetEntry) {
        throw new ValidationError(
          `This collection requires a catalog match — pick a variant from the ${template.superset} catalog first`,
        )
      }
      if (!template.superset && input.supersetEntry) {
        throw new ValidationError('Catalog entries can only be used with a superset template')
      }
      const values = this.validateFieldValues(template.fields, input.fieldValues ?? [], {
        enforceRequired: true,
      })

      const row = await trx
        .insertInto('items')
        .values({
          collectionId: input.collectionId,
          superset: template.superset,
          supersetEntry: input.supersetEntry ?? null,
          name: input.name.trim(),
          notes: input.notes ?? null,
          quantity: input.quantity ?? 1,
          isFavorite: input.isFavorite ?? false,
        })
        .returning('id')
        .executeTakeFirstOrThrow()

      if (values.length > 0) {
        await trx
          .insertInto('itemFieldValues')
          .values(
            values.map((v) => ({
              itemId: row.id,
              fieldId: v.fieldId,
              value: jsonParam(v.value),
            })),
          )
          .execute()
      }
      await this.setTagIds(trx, row.id, input.tagIds ?? [])
      await this.recordEvent(trx, row.id, 'created', null)
      return row.id
    })

    const detail = await this.getItem(id)
    if (!detail) throw new Error('Item vanished after creation')
    return detail
  }

  async getItem(
    id: string,
    opts: { includeDeleted?: boolean } = {},
  ): Promise<ItemDetailDto | null> {
    return this.db.transaction().execute(async (tx) => {
      const trx = asExec(tx)
      const item = await trx
        .selectFrom('items')
        .where('items.id', '=', id)
        .selectAll()
        .executeTakeFirst()
      if (!item) return null
      if (item.deletedAt && !opts.includeDeleted) return null
      return this.buildItemDetail(trx, item.id)
    })
  }

  async updateItem(id: string, patch: UpdateItemInput): Promise<ItemDetailDto | null> {
    const before = await this.getItem(id)
    if (!before) return null

    const after = await this.db.transaction().execute(async (tx) => {
      const trx = asExec(tx)
      const current = await trx
        .selectFrom('items')
        .where('items.id', '=', id)
        .selectAll()
        .executeTakeFirstOrThrow()

      const collection = await trx
        .selectFrom('collections')
        .where('collections.id', '=', current.collectionId)
        .selectAll()
        .executeTakeFirstOrThrow()
      const template = await this.loadTemplate(trx, collection.templateId)

      if (patch.supersetEntry !== undefined) {
        if (patch.supersetEntry === null) {
          if (template.superset) {
            throw new ValidationError('This collection requires a catalog match')
          }
        } else if (!template.superset) {
          throw new ValidationError('Catalog entries can only be used with a superset template')
        }
      }

      if (patch.fieldValues) {
        const upserts = this.validateFieldValues(template.fields, patch.fieldValues, {
          enforceRequired: false,
        })
        // Drop values that no longer belong to the collection's template,
        // then replace the ones provided in this patch.
        const fieldIds = template.fields.map((f) => f.id)
        if (fieldIds.length === 0) {
          await trx.deleteFrom('itemFieldValues').where('itemId', '=', id).execute()
        } else {
          await trx
            .deleteFrom('itemFieldValues')
            .where('itemId', '=', id)
            .where('fieldId', 'not in', fieldIds)
            .execute()
        }
        const providedIds = patch.fieldValues.map((v) => v.fieldId)
        if (providedIds.length > 0) {
          await trx
            .deleteFrom('itemFieldValues')
            .where('itemId', '=', id)
            .where('fieldId', 'in', providedIds)
            .execute()
        }
        if (upserts.length > 0) {
          await trx
            .insertInto('itemFieldValues')
            .values(
              upserts.map((v) => ({
                itemId: id,
                fieldId: v.fieldId,
                value: jsonParam(v.value),
              })),
            )
            .execute()
        }
      }

      if (patch.tagIds) {
        await this.setTagIds(trx, id, patch.tagIds)
      }

      await trx
        .updateTable('items')
        .set({
          ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
          ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
          ...(patch.quantity !== undefined ? { quantity: patch.quantity } : {}),
          ...(patch.isFavorite !== undefined ? { isFavorite: patch.isFavorite } : {}),
          ...(patch.supersetEntry !== undefined ? { supersetEntry: patch.supersetEntry } : {}),
          // Keep the catalog binding in sync with the collection's template.
          superset: template.superset,
          updatedAt: new Date(),
        })
        .where('items.id', '=', id)
        .execute()

      const after = await this.buildItemDetail(trx, id)
      const changes = diffItemDetails(before, after)
      if (changes.length > 0) {
        await this.recordEvent(trx, id, 'updated', changes)
      }
      return after
    })

    return after
  }

  async deleteItem(id: string): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      const trx = asExec(tx)
      const row = await trx
        .selectFrom('items')
        .where('items.id', '=', id)
        .selectAll()
        .executeTakeFirst()
      if (!row) throw new ValidationError('Item not found')
      if (row.deletedAt) throw new ConflictError('Item is already in the trash')
      await trx
        .updateTable('items')
        .set({ deletedAt: new Date() })
        .where('items.id', '=', id)
        .execute()
      await this.recordEvent(trx, id, 'deleted', null)
    })
  }

  async restoreItem(id: string): Promise<ItemDetailDto> {
    await this.db.transaction().execute(async (tx) => {
      const trx = asExec(tx)
      const row = await trx
        .selectFrom('items')
        .where('items.id', '=', id)
        .selectAll()
        .executeTakeFirst()
      if (!row) throw new ValidationError('Item not found')
      if (!row.deletedAt) throw new ConflictError('Item is not in the trash')
      const collection = await trx
        .selectFrom('collections')
        .where('collections.id', '=', row.collectionId)
        .selectAll()
        .executeTakeFirst()
      if (!collection) {
        throw new ValidationError(
          'The collection no longer exists, so this item cannot be restored',
        )
      }
      if (collection.deletedAt) {
        throw new ConflictError('Restore the collection first — it is also in the trash')
      }
      await trx.updateTable('items').set({ deletedAt: null }).where('items.id', '=', id).execute()
      await this.recordEvent(trx, id, 'restored', null)
    })
    const detail = await this.getItem(id)
    if (!detail) throw new Error('Item vanished after restore')
    return detail
  }

  /** Permanently deletes a trashed item. Returns the image filenames to unlink. */
  async purgeItem(id: string): Promise<string[]> {
    return this.db.transaction().execute(async (tx) => {
      const trx = asExec(tx)
      const row = await trx
        .selectFrom('items')
        .where('items.id', '=', id)
        .selectAll()
        .executeTakeFirst()
      if (!row) throw new ValidationError('Item not found')
      if (!row.deletedAt) {
        throw new ConflictError('Move the item to the trash before deleting it permanently')
      }
      const images = await trx
        .selectFrom('images')
        .where('itemId', '=', id)
        .select('filename')
        .execute()
      await trx.deleteFrom('items').where('items.id', '=', id).execute()
      return images.map((i) => i.filename)
    })
  }

  async getItemHistory(id: string): Promise<HistoryEventDto[]> {
    const events = await this.db
      .selectFrom('itemHistory')
      .where('itemId', '=', id)
      .orderBy('createdAt', 'desc')
      .selectAll()
      .execute()
    return events.map((e) => ({
      id: e.id,
      action: e.action,
      changes: e.changes,
      snapshot: e.snapshot,
      createdAt: e.createdAt.toISOString(),
    }))
  }

  /* --------------------------------------------------------------- */
  /* Tags                                                             */
  /* --------------------------------------------------------------- */

  async listTags(): Promise<TagDto[]> {
    const rows = await this.db
      .selectFrom('tags')
      .orderBy('tags.name', 'asc')
      .select((eb) => [
        'tags.id',
        'tags.name',
        'tags.color',
        eb
          .selectFrom('itemTags')
          .innerJoin('items', (join) => join.onRef('items.id', '=', 'itemTags.itemId'))
          .whereRef('itemTags.tagId', '=', 'tags.id')
          .where('items.deletedAt', 'is', null)
          .select((eb2) => eb2.fn.countAll<number>().as('count'))
          .as('itemCount'),
      ])
      .execute()
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      itemCount: Number(r.itemCount),
    }))
  }

  async createTag(input: CreateTagInput): Promise<TagDto> {
    const name = input.name.trim()
    const existing = await this.db
      .selectFrom('tags')
      .where(sql<boolean>`lower(tags.name) = lower(${name})`)
      .selectAll()
      .executeTakeFirst()
    if (existing) throw new ConflictError(`Tag "${existing.name}" already exists`)
    const row = await this.db
      .insertInto('tags')
      .values({ name, color: input.color ?? null })
      .returningAll()
      .executeTakeFirstOrThrow()
    return { id: row.id, name: row.name, color: row.color, itemCount: 0 }
  }

  async updateTag(
    id: string,
    patch: { name?: string; color?: string | null },
  ): Promise<TagDto | null> {
    const row = await this.db.selectFrom('tags').where('id', '=', id).selectAll().executeTakeFirst()
    if (!row) return null
    const name = patch.name !== undefined ? patch.name.trim() : row.name
    if (name.toLowerCase() !== row.name.toLowerCase()) {
      const clash = await this.db
        .selectFrom('tags')
        .where(sql<boolean>`lower(tags.name) = lower(${name})`)
        .where('id', '!=', id)
        .select('tags.name')
        .executeTakeFirst()
      if (clash) throw new ConflictError(`Tag "${clash.name}" already exists`)
    }
    const updated = await this.db
      .updateTable('tags')
      .set({
        name,
        ...(patch.color !== undefined ? { color: patch.color } : {}),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow()
    return { id: updated.id, name: updated.name, color: updated.color, itemCount: 0 }
  }

  async deleteTag(id: string): Promise<void> {
    await this.db.deleteFrom('tags').where('id', '=', id).execute()
  }

  /* --------------------------------------------------------------- */
  /* Images                                                           */
  /* --------------------------------------------------------------- */

  async addImage(itemId: string, input: AddImageInput): Promise<ImageDto> {
    return this.db.transaction().execute(async (tx) => {
      const trx = asExec(tx)
      const item = await trx
        .selectFrom('items')
        .where('items.id', '=', itemId)
        .selectAll()
        .executeTakeFirst()
      if (!item || item.deletedAt) throw new ValidationError('Item not found')

      const existingCount = await trx
        .selectFrom('images')
        .where('itemId', '=', itemId)
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .executeTakeFirstOrThrow()

      const row = await trx
        .insertInto('images')
        .values({
          itemId,
          filename: input.filename,
          mime: input.mime,
          size: input.size,
          caption: input.caption ?? null,
          isCover: Number(existingCount.count) === 0,
          position: Number(existingCount.count),
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      await this.recordEvent(trx, itemId, 'image_added', null)
      return toImageDto(row)
    })
  }

  async updateImage(
    id: string,
    patch: { caption?: string | null; isCover?: boolean },
  ): Promise<ImageDto | null> {
    return this.db.transaction().execute(async (tx) => {
      const trx = asExec(tx)
      const row = await trx.selectFrom('images').where('id', '=', id).selectAll().executeTakeFirst()
      if (!row) return null
      if (patch.isCover === true) {
        await trx
          .updateTable('images')
          .set({ isCover: false })
          .where('itemId', '=', row.itemId)
          .execute()
      }
      const updated = await trx
        .updateTable('images')
        .set({
          ...(patch.caption !== undefined ? { caption: patch.caption } : {}),
          ...(patch.isCover !== undefined ? { isCover: patch.isCover } : {}),
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow()
      return toImageDto(updated)
    })
  }

  async getImage(id: string): Promise<ImageDto | null> {
    const row = await this.db
      .selectFrom('images')
      .where('id', '=', id)
      .selectAll()
      .executeTakeFirst()
    return row ? toImageDto(row) : null
  }

  /** Deletes an image row and promotes the next image to cover if needed. */
  async deleteImage(id: string): Promise<{ itemId: string; filename: string } | null> {
    return this.db.transaction().execute(async (tx) => {
      const trx = asExec(tx)
      const row = await trx.selectFrom('images').where('id', '=', id).selectAll().executeTakeFirst()
      if (!row) return null
      await trx.deleteFrom('images').where('id', '=', id).execute()
      if (row.isCover) {
        const next = await trx
          .selectFrom('images')
          .where('itemId', '=', row.itemId)
          .orderBy('position', 'asc')
          .limit(1)
          .select('id')
          .executeTakeFirst()
        if (next) {
          await trx.updateTable('images').set({ isCover: true }).where('id', '=', next.id).execute()
        }
      }
      await this.recordEvent(trx, row.itemId, 'image_removed', null)
      return { itemId: row.itemId, filename: row.filename }
    })
  }

  /* --------------------------------------------------------------- */
  /* API keys (MCP access)                                            */
  /* --------------------------------------------------------------- */

  /**
   * Creates an API key. The plaintext key is returned exactly once — only a
   * SHA-256 hash is stored.
   */
  async createApiKey(name: string, readonly: boolean): Promise<{ apiKey: ApiKeyDto; key: string }> {
    const trimmed = name.trim()
    if (trimmed.length === 0) throw new ValidationError('Key name is required')
    const existing = await this.db
      .selectFrom('apiKeys')
      .where(sql<boolean>`lower(api_keys.name) = lower(${trimmed})`)
      .select('apiKeys.name')
      .executeTakeFirst()
    if (existing) throw new ConflictError(`API key "${existing.name}" already exists`)

    const key = `mcp_${randomBytes(32).toString('hex')}`
    const keyHash = createHash('sha256').update(key).digest('hex')
    const row = await this.db
      .insertInto('apiKeys')
      .values({ name: trimmed, keyHash, readonly })
      .returningAll()
      .executeTakeFirstOrThrow()
    return { apiKey: toApiKeyDto(row), key }
  }

  async listApiKeys(): Promise<ApiKeyDto[]> {
    const rows = await this.db
      .selectFrom('apiKeys')
      .orderBy('apiKeys.createdAt', 'desc')
      .selectAll()
      .execute()
    return rows.map(toApiKeyDto)
  }

  async revokeApiKey(id: string): Promise<void> {
    const row = await this.db
      .selectFrom('apiKeys')
      .where('id', '=', id)
      .select('id')
      .executeTakeFirst()
    if (!row) throw new ValidationError('API key not found')
    await this.db
      .updateTable('apiKeys')
      .set({ revokedAt: new Date() })
      .where('id', '=', id)
      .execute()
  }

  /** Looks up a key by its plaintext value; revoked keys never authenticate. */
  async authenticateApiKey(key: string): Promise<ApiKeyDto | null> {
    if (!key.startsWith('mcp_')) return null
    const keyHash = createHash('sha256').update(key).digest('hex')
    const row = await this.db
      .selectFrom('apiKeys')
      .where('keyHash', '=', keyHash)
      .selectAll()
      .executeTakeFirst()
    if (!row || row.revokedAt) return null
    return toApiKeyDto(row)
  }

  /** Best-effort last-used stamp; never blocks a request on failure. */
  touchApiKey(id: string): void {
    this.db
      .updateTable('apiKeys')
      .set({ lastUsedAt: new Date() })
      .where('id', '=', id)
      .execute()
      .catch(() => {})
  }

  /* --------------------------------------------------------------- */
  /* Trash, search, stats                                             */
  /* --------------------------------------------------------------- */

  async getTrash(): Promise<TrashDto> {
    const collections = await this.db
      .selectFrom('collections')
      .where('deletedAt', 'is not', null)
      .orderBy('deletedAt', 'desc')
      .select((eb) => [
        'id',
        'name',
        'emoji',
        'deletedAt',
        eb
          .selectFrom('items')
          .whereRef('items.collectionId', '=', 'collections.id')
          .select((eb2) => eb2.fn.countAll<number>().as('count'))
          .as('itemCount'),
      ])
      .execute()

    const items = await this.db
      .selectFrom('items')
      .innerJoin('collections', 'collections.id', 'items.collectionId')
      .where('items.deletedAt', 'is not', null)
      .orderBy('items.deletedAt', 'desc')
      .select([
        'items.id',
        'items.name',
        'items.collectionId',
        'collections.name as collectionName',
        'items.deletedAt',
        'items.createdAt',
        'items.updatedAt',
      ])
      .execute()

    return {
      collections: collections.map((c) => ({
        id: c.id,
        name: c.name,
        emoji: c.emoji,
        itemCount: Number(c.itemCount),
        deletedAt: (c.deletedAt as Date).toISOString(),
      })),
      items: items.map((i) => ({
        id: i.id,
        name: i.name,
        collectionId: i.collectionId,
        collectionName: i.collectionName,
        deletedAt: (i.deletedAt as Date).toISOString(),
        createdAt: i.createdAt.toISOString(),
        updatedAt: i.updatedAt.toISOString(),
      })),
    }
  }

  async getStats(): Promise<StatsDto> {
    const [collectionRow, itemRow, favoriteRow, tagRow] = await Promise.all([
      this.db
        .selectFrom('collections')
        .where('deletedAt', 'is', null)
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom('items')
        .where('deletedAt', 'is', null)
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom('items')
        .where('deletedAt', 'is', null)
        .where('isFavorite', '=', true)
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom('tags')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .executeTakeFirstOrThrow(),
    ])
    const recent = await this.listItems({ sort: 'created', order: 'desc', limit: 6 })
    return {
      collectionCount: Number(collectionRow.count),
      itemCount: Number(itemRow.count),
      favoriteCount: Number(favoriteRow.count),
      tagCount: Number(tagRow.count),
      recentItems: recent.items,
    }
  }

  /* --------------------------------------------------------------- */
  /* Internals                                                        */
  /* --------------------------------------------------------------- */

  private async findCollectionRow(id: string) {
    return this.db.selectFrom('collections').where('id', '=', id).selectAll().executeTakeFirst()
  }

  private async insertFields(trx: Exec, templateId: string, fields: TemplateFieldInput[]) {
    for (const [index, field] of fields.entries()) {
      await trx
        .insertInto('templateFields')
        .values({
          templateId,
          name: field.name.trim(),
          type: field.type,
          options: jsonParam(normalizeOptions(field)),
          required: field.required ?? false,
          position: index,
        })
        .execute()
    }
  }

  private async loadTemplate(
    trx: Exec,
    templateId: string | null,
  ): Promise<{ superset: string | null; fields: TemplateFieldDto[] }> {
    if (!templateId) return { superset: null, fields: [] }
    const template = await trx
      .selectFrom('templates')
      .where('id', '=', templateId)
      .selectAll()
      .executeTakeFirst()
    if (!template) throw new ValidationError('Template not found')
    const fields = await trx
      .selectFrom('templateFields')
      .where('templateFields.templateId', '=', templateId)
      .orderBy('position', 'asc')
      .selectAll()
      .execute()
    return {
      superset: template.superset,
      fields: fields.map((f) => ({
        id: f.id,
        templateId: f.templateId,
        name: f.name,
        type: f.type,
        options: f.options,
        required: f.required,
        position: f.position,
      })),
    }
  }

  private validateFieldValues(
    fields: TemplateFieldDto[],
    values: { fieldId: string; value: FieldValue }[],
    opts: { enforceRequired: boolean },
  ): { fieldId: string; value: Exclude<FieldValue, null> }[] {
    const byId = new Map(fields.map((f) => [f.id, f]))
    const result: { fieldId: string; value: Exclude<FieldValue, null> }[] = []
    const seen = new Set<string>()

    for (const { fieldId, value } of values) {
      const field = byId.get(fieldId)
      if (!field) throw new ValidationError(`Unknown field "${fieldId}" for this template`)
      if (seen.has(fieldId)) throw new ValidationError(`Duplicate value for field "${field.name}"`)
      seen.add(fieldId)

      const normalized = normalizeValue(field, value)
      if (normalized !== null) {
        result.push({ fieldId, value: normalized })
      }
    }

    if (opts.enforceRequired) {
      for (const field of fields) {
        if (field.required && field.type !== 'checkbox' && !seen.has(field.id)) {
          throw new ValidationError(`"${field.name}" is required`)
        }
      }
    }
    return result
  }

  private async setTagIds(trx: Exec, itemId: string, tagIds: string[]) {
    await trx.deleteFrom('itemTags').where('itemId', '=', itemId).execute()
    if (tagIds.length === 0) return
    const tags = await trx.selectFrom('tags').where('id', 'in', tagIds).select('id').execute()
    if (tags.length !== tagIds.length) {
      throw new ValidationError('One or more tags do not exist')
    }
    await trx
      .insertInto('itemTags')
      .values(tagIds.map((tagId) => ({ itemId, tagId })))
      .execute()
  }

  private async attachTags(rows: ItemRow[]): Promise<ItemListItemDto[]> {
    if (rows.length === 0) return []
    const ids = rows.map((r) => r.id)
    const tagRows = await this.db
      .selectFrom('itemTags')
      .innerJoin('tags', 'tags.id', 'itemTags.tagId')
      .where('itemTags.itemId', 'in', ids)
      .select(['itemTags.itemId', 'tags.id as tagId', 'tags.name', 'tags.color'])
      .execute()
    const tagsByItem = new Map<string, ItemTagDto[]>()
    for (const t of tagRows) {
      const list = tagsByItem.get(t.itemId) ?? []
      list.push({ id: t.tagId, name: t.name, color: t.color })
      tagsByItem.set(t.itemId, list)
    }
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      collectionId: r.collectionId,
      collectionName: r.collectionName,
      collectionEmoji: r.collectionEmoji,
      thumbnailUrl: r.thumbnailUrl,
      isFavorite: r.isFavorite,
      quantity: r.quantity,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      tags: tagsByItem.get(r.id) ?? [],
    }))
  }

  private async buildItemDetail(trx: Exec, itemId: string): Promise<ItemDetailDto> {
    const item = await trx
      .selectFrom('items')
      .innerJoin('collections', 'collections.id', 'items.collectionId')
      .where('items.id', '=', itemId)
      .select((eb) => [
        'items.id',
        'items.name',
        'items.notes',
        'items.quantity',
        'items.isFavorite',
        'items.collectionId',
        'items.superset',
        'items.supersetEntry',
        'items.createdAt',
        'items.updatedAt',
        'collections.name as collectionName',
        'collections.emoji as collectionEmoji',
        'collections.templateId',
        eb
          .selectFrom('templates')
          .whereRef('templates.id', '=', 'collections.templateId')
          .select('templates.name')
          .as('templateName'),
      ])
      .executeTakeFirstOrThrow()

    const fieldRows = await trx
      .selectFrom('itemFieldValues')
      .innerJoin('templateFields', 'templateFields.id', 'itemFieldValues.fieldId')
      .where('itemFieldValues.itemId', '=', itemId)
      .orderBy('templateFields.position', 'asc')
      .select([
        'templateFields.id',
        'templateFields.name',
        'templateFields.type',
        'templateFields.options',
        'templateFields.required',
        'templateFields.position',
        'itemFieldValues.value',
      ])
      .execute()

    const imageRows = await trx
      .selectFrom('images')
      .where('itemId', '=', itemId)
      .orderBy('isCover', 'desc')
      .orderBy('position', 'asc')
      .selectAll()
      .execute()

    const tagRows = await trx
      .selectFrom('itemTags')
      .innerJoin('tags', 'tags.id', 'itemTags.tagId')
      .where('itemTags.itemId', '=', itemId)
      .select(['tags.id', 'tags.name', 'tags.color'])
      .execute()

    const fields: ItemFieldWithValueDto[] = fieldRows.map((f) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      options: f.options,
      required: f.required,
      position: f.position,
      value: f.value,
    }))

    return {
      id: item.id,
      name: item.name,
      notes: item.notes,
      quantity: item.quantity,
      isFavorite: item.isFavorite,
      superset: item.superset,
      supersetEntry: item.supersetEntry,
      collectionId: item.collectionId,
      collectionName: item.collectionName,
      collectionEmoji: item.collectionEmoji,
      templateId: item.templateId,
      templateName: (item.templateName as string | null) ?? null,
      fields,
      images: imageRows.map(toImageDto),
      tags: tagRows,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    }
  }

  private async buildSnapshot(trx: Exec, itemId: string): Promise<ItemSnapshot> {
    const item = await trx
      .selectFrom('items')
      .where('id', '=', itemId)
      .selectAll()
      .executeTakeFirstOrThrow()
    const fieldRows = await trx
      .selectFrom('itemFieldValues')
      .innerJoin('templateFields', 'templateFields.id', 'itemFieldValues.fieldId')
      .where('itemFieldValues.itemId', '=', itemId)
      .orderBy('templateFields.position', 'asc')
      .select([
        'templateFields.id as fieldId',
        'templateFields.name',
        'templateFields.type',
        'itemFieldValues.value',
      ])
      .execute()
    const tagRows = await trx
      .selectFrom('itemTags')
      .innerJoin('tags', 'tags.id', 'itemTags.tagId')
      .where('itemTags.itemId', '=', itemId)
      .select('tags.name')
      .execute()
    const imageCount = await trx
      .selectFrom('images')
      .where('itemId', '=', itemId)
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow()

    return {
      name: item.name,
      notes: item.notes,
      quantity: item.quantity,
      isFavorite: item.isFavorite,
      tags: tagRows.map((t) => t.name),
      fields: fieldRows.map((f) => ({
        fieldId: f.fieldId,
        name: f.name,
        type: f.type as FieldType,
        value: f.value,
      })),
      imageCount: Number(imageCount.count),
    }
  }

  private async recordEvent(
    trx: Exec,
    itemId: string,
    action: HistoryAction,
    changes: HistoryChange[] | null,
  ) {
    const snapshot = await this.buildSnapshot(trx, itemId)
    await trx
      .insertInto('itemHistory')
      .values({ itemId, action, changes: jsonParam(changes), snapshot: jsonParam(snapshot) })
      .execute()
  }
}

interface ItemRow {
  id: string
  name: string
  collectionId: string
  collectionName: string
  collectionEmoji: string | null
  thumbnailUrl: string | null
  isFavorite: boolean
  quantity: number
  createdAt: Date
  updatedAt: Date
}

function toImageDto(row: {
  id: string
  itemId: string
  filename: string
  mime: string
  size: number
  caption: string | null
  isCover: boolean
  position: number
  createdAt: Date
}): ImageDto {
  return {
    id: row.id,
    itemId: row.itemId,
    filename: row.filename,
    url: `/uploads/${row.filename}`,
    mime: row.mime,
    size: row.size,
    caption: row.caption,
    isCover: row.isCover,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
  }
}

function toApiKeyDto(row: {
  id: string
  name: string
  readonly: boolean
  createdAt: Date
  lastUsedAt: Date | null
  revokedAt: Date | null
}): ApiKeyDto {
  return {
    id: row.id,
    name: row.name,
    readonly: row.readonly,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
  }
}

function normalizeOptions(field: TemplateFieldInput): string[] | null {
  if (field.type !== 'select') return null
  const options = (field.options ?? []).map((o) => o.trim()).filter((o) => o.length > 0)
  if (options.length === 0) {
    throw new ValidationError(`Select field "${field.name}" needs at least one option`)
  }
  return options
}

function normalizeValue(
  field: TemplateFieldDto,
  value: FieldValue,
): Exclude<FieldValue, null> | null {
  if (value === null || value === undefined) return null

  switch (field.type) {
    case 'text':
    case 'textarea': {
      if (typeof value !== 'string') throw new ValidationError(`"${field.name}" must be text`)
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : null
    }
    case 'url': {
      if (typeof value !== 'string') throw new ValidationError(`"${field.name}" must be a URL`)
      const trimmed = value.trim()
      if (trimmed.length === 0) return null
      try {
        new URL(trimmed)
      } catch {
        throw new ValidationError(`"${field.name}" must be a valid URL`)
      }
      return trimmed
    }
    case 'date': {
      if (typeof value !== 'string') throw new ValidationError(`"${field.name}" must be a date`)
      const trimmed = value.trim()
      if (trimmed.length === 0) return null
      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        throw new ValidationError(`"${field.name}" must be a date in YYYY-MM-DD format`)
      }
      return trimmed
    }
    case 'select': {
      if (typeof value !== 'string') throw new ValidationError(`"${field.name}" must be a choice`)
      const trimmed = value.trim()
      if (trimmed.length === 0) return null
      if (!(field.options ?? []).includes(trimmed)) {
        throw new ValidationError(`"${trimmed}" is not an option for "${field.name}"`)
      }
      return trimmed
    }
    case 'image': {
      if (typeof value !== 'string') {
        throw new ValidationError(`"${field.name}" must be an image URL`)
      }
      const trimmed = value.trim()
      if (trimmed.length === 0) return null
      return trimmed.slice(0, 2000)
    }
    case 'price': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new ValidationError(`"${field.name}" must be a price (amount and currency)`)
      }
      const price = value as PriceValue
      if (typeof price.amount !== 'number' || !Number.isFinite(price.amount)) {
        throw new ValidationError(`"${field.name}" needs a numeric amount`)
      }
      const currency = String(price.currency ?? '')
        .trim()
        .toUpperCase()
      if (!/^[A-Z]{3}$/.test(currency)) {
        throw new ValidationError(`"${field.name}" needs a 3-letter currency code (e.g. EUR, USD)`)
      }
      return { amount: Math.round(price.amount * 100) / 100, currency }
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new ValidationError(`"${field.name}" must be a number`)
      }
      return value
    }
    case 'rating': {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5) {
        throw new ValidationError(`"${field.name}" must be a rating between 1 and 5`)
      }
      return value
    }
    case 'checkbox': {
      if (typeof value !== 'boolean') throw new ValidationError(`"${field.name}" must be yes/no`)
      return value
    }
  }
}

const LABELS: Record<string, string> = {
  name: 'Name',
  notes: 'Notes',
  quantity: 'Quantity',
  isFavorite: 'Favorite',
  tags: 'Tags',
}

/** Computes a human-readable diff between two versions of an item. */
export function diffItemDetails(before: ItemDetailDto, after: ItemDetailDto): HistoryChange[] {
  const changes: HistoryChange[] = []
  if (before.name !== after.name) {
    changes.push({ field: 'name', label: LABELS.name!, from: before.name, to: after.name })
  }
  if (before.notes !== after.notes) {
    changes.push({ field: 'notes', label: LABELS.notes!, from: before.notes, to: after.notes })
  }
  if (before.quantity !== after.quantity) {
    changes.push({
      field: 'quantity',
      label: LABELS.quantity!,
      from: before.quantity,
      to: after.quantity,
    })
  }
  if (before.isFavorite !== after.isFavorite) {
    changes.push({
      field: 'isFavorite',
      label: LABELS.isFavorite!,
      from: before.isFavorite,
      to: after.isFavorite,
    })
  }
  const beforeTags = before.tags
    .map((t) => t.name)
    .sort()
    .join(', ')
  const afterTags = after.tags
    .map((t) => t.name)
    .sort()
    .join(', ')
  if (beforeTags !== afterTags) {
    changes.push({
      field: 'tags',
      label: LABELS.tags!,
      from: beforeTags || null,
      to: afterTags || null,
    })
  }
  const afterFields = new Map(after.fields.map((f) => [f.id, f]))
  for (const field of before.fields) {
    const next = afterFields.get(field.id)
    if (!next) continue
    if (JSON.stringify(field.value) !== JSON.stringify(next.value)) {
      changes.push({
        field: `field:${field.id}`,
        label: field.name,
        from: field.value,
        to: next.value,
      })
    }
  }
  return changes
}

export { iso }
