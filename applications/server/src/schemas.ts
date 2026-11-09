import { FIELD_TYPES } from '@antiquary/database'
import { z } from 'zod'

const uuid = z.string().uuid()
const nullableString = z.string().max(5000).nullable()

export const createCollectionSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  description: nullableString.optional(),
  emoji: z.string().max(16).nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a hex value like #7c3aed')
    .nullable()
    .optional(),
  parentId: uuid.nullable().optional(),
  templateId: uuid.nullable().optional(),
})

export const updateCollectionSchema = createCollectionSchema.partial()

export const templateFieldSchema = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1, 'Field name is required').max(200),
  type: z.enum(FIELD_TYPES),
  options: z.array(z.string().trim().min(1)).max(200).nullable().optional(),
  required: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
})

export const createTemplateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  description: nullableString.optional(),
  superset: z.string().max(50).nullable().optional(),
  fields: z.array(templateFieldSchema).max(100).optional(),
})

export const updateTemplateSchema = createTemplateSchema.partial()

const fieldValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.object({ amount: z.number(), currency: z.string() }),
])

export const createItemSchema = z.object({
  collectionId: uuid,
  templateId: uuid.nullable().optional(),
  superset: z.string().max(50).nullable().optional(),
  supersetEntry: z.string().max(100).nullable().optional(),
  name: z.string().trim().min(1, 'Name is required').max(300),
  notes: nullableString.optional(),
  quantity: z.number().int().min(1).max(1_000_000).optional(),
  isFavorite: z.boolean().optional(),
  fieldValues: z
    .array(z.object({ fieldId: uuid, value: fieldValueSchema }))
    .max(200)
    .optional(),
  tagIds: z.array(uuid).max(100).optional(),
})

export const updateItemSchema = createItemSchema.partial()

export const listItemsQuerySchema = z.object({
  collectionId: uuid.optional(),
  search: z.string().trim().max(200).optional(),
  favorite: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  tagId: uuid.optional(),
  sort: z.enum(['created', 'updated', 'name']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

export const createTagSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(50),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
})

export const updateTagSchema = createTagSchema.partial()

export const updateImageSchema = z.object({
  caption: z.string().trim().max(300).nullable().optional(),
  isCover: z.boolean().optional(),
})

export type CreateCollectionBody = z.infer<typeof createCollectionSchema>
export type UpdateCollectionBody = z.infer<typeof updateCollectionSchema>
export type CreateTemplateBody = z.infer<typeof createTemplateSchema>
export type UpdateTemplateBody = z.infer<typeof updateTemplateSchema>
export type CreateItemBody = z.infer<typeof createItemSchema>
export type UpdateItemBody = z.infer<typeof updateItemSchema>
export type ListItemsQuery = z.infer<typeof listItemsQuerySchema>
export type CreateTagBody = z.infer<typeof createTagSchema>
export type UpdateTagBody = z.infer<typeof updateTagSchema>
