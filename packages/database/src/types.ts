import type { Generated, GeneratedAlways } from 'kysely';

export const FIELD_TYPES = [
    'text',
    'textarea',
    'number',
    'date',
    'url',
    'select',
    'rating',
    'checkbox',
    'image',
    'price',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

/** A price value: amount plus a 3-letter ISO 4217 currency code. */
export interface PriceValue {
    amount: number;
    currency: string;
}

export type FieldValue = string | number | boolean | PriceValue | null;

export const HISTORY_ACTIONS = [
    'created',
    'updated',
    'deleted',
    'restored',
    'image_added',
    'image_removed',
] as const;

export type HistoryAction = (typeof HISTORY_ACTIONS)[number];

export interface CollectionsTable {
    id: Generated<string>;
    name: string;
    description: string | null;
    emoji: string | null;
    color: string | null;
    parentId: string | null;
    templateId: string | null;
    deletedAt: Date | null;
    createdAt: GeneratedAlways<Date>;
    updatedAt: Generated<Date>;
}

export interface TemplatesTable {
    id: Generated<string>;
    name: string;
    description: string | null;
    superset: string | null;
    createdAt: GeneratedAlways<Date>;
    updatedAt: Generated<Date>;
}

export interface TemplateFieldsTable {
    id: Generated<string>;
    templateId: string;
    name: string;
    type: FieldType;
    options: string[] | null;
    required: boolean;
    position: number;
    createdAt: GeneratedAlways<Date>;
}

export interface ItemsTable {
    id: Generated<string>;
    collectionId: string;
    superset: string | null;
    supersetEntry: string | null;
    name: string;
    notes: string | null;
    quantity: number;
    isFavorite: Generated<boolean>;
    deletedAt: Date | null;
    createdAt: GeneratedAlways<Date>;
    updatedAt: Generated<Date>;
}

export interface ItemFieldValuesTable {
    id: Generated<string>;
    itemId: string;
    fieldId: string;
    value: FieldValue;
}

export interface ImagesTable {
    id: Generated<string>;
    itemId: string;
    filename: string;
    mime: string;
    size: number;
    caption: string | null;
    isCover: boolean;
    position: number;
    createdAt: GeneratedAlways<Date>;
}

export interface TagsTable {
    id: Generated<string>;
    name: string;
    color: string | null;
    createdAt: GeneratedAlways<Date>;
}

export interface ItemTagsTable {
    itemId: string;
    tagId: string;
}

export interface HistoryChange {
    field: string;
    label: string;
    from: unknown;
    to: unknown;
}

export interface ItemSnapshot {
    name: string;
    notes: string | null;
    quantity: number;
    isFavorite: boolean;
    tags: string[];
    fields: { fieldId: string; name: string; type: FieldType; value: FieldValue }[];
    imageCount: number;
}

export interface ItemHistoryTable {
    id: Generated<string>;
    itemId: string;
    action: HistoryAction;
    changes: HistoryChange[] | null;
    snapshot: ItemSnapshot;
    createdAt: GeneratedAlways<Date>;
}

export interface ApiKeysTable {
    id: Generated<string>;
    name: string;
    keyHash: string;
    readonly: boolean;
    createdAt: GeneratedAlways<Date>;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
}

export interface DBSchema {
    apiKeys: ApiKeysTable;
    collections: CollectionsTable;
    templates: TemplatesTable;
    templateFields: TemplateFieldsTable;
    items: ItemsTable;
    itemFieldValues: ItemFieldValuesTable;
    images: ImagesTable;
    tags: TagsTable;
    itemTags: ItemTagsTable;
    itemHistory: ItemHistoryTable;
}

/* ------------------------------------------------------------------ */
/* DTOs shared between the API server and the web app                  */
/* ------------------------------------------------------------------ */

export interface CollectionDto {
    id: string;
    name: string;
    description: string | null;
    emoji: string | null;
    color: string | null;
    parentId: string | null;
    templateId: string | null;
    itemCount: number;
    /** Catalog coverage, filled in by the API when the collection's template uses a superset. */
    completion?: { owned: number; total: number; percent: number } | null;
    createdAt: string;
    updatedAt: string;
}

export interface DeletedCollectionDto {
    id: string;
    name: string;
    emoji: string | null;
    itemCount: number;
    deletedAt: string;
}

export interface TemplateFieldDto {
    id: string;
    templateId: string;
    name: string;
    type: FieldType;
    options: string[] | null;
    required: boolean;
    position: number;
}

export interface TemplateDto {
    id: string;
    name: string;
    description: string | null;
    superset: string | null;
    fieldCount: number;
    itemCount: number;
    createdAt: string;
    updatedAt: string;
}

export interface TemplateDetailDto extends Omit<TemplateDto, 'fieldCount'> {
    fields: TemplateFieldDto[];
}

export interface TagDto {
    id: string;
    name: string;
    color: string | null;
    itemCount: number;
}

export interface ImageDto {
    id: string;
    itemId: string;
    filename: string;
    url: string;
    mime: string;
    size: number;
    caption: string | null;
    isCover: boolean;
    position: number;
    createdAt: string;
}

export interface ItemTagDto {
    id: string;
    name: string;
    color: string | null;
}

export interface ItemListImageDto {
    id: string;
    url: string;
    isCover: boolean;
}

export interface ItemListItemDto {
    id: string;
    name: string;
    collectionId: string;
    collectionName: string;
    collectionEmoji: string | null;
    thumbnailUrl: string | null;
    isFavorite: boolean;
    quantity: number;
    createdAt: string;
    updatedAt: string;
    tags: ItemTagDto[];
    images: ItemListImageDto[];
}

export interface DeletedItemDto {
    id: string;
    name: string;
    collectionId: string;
    collectionName: string;
    deletedAt: string;
    createdAt: string;
    updatedAt: string;
}

export interface ItemFieldWithValueDto {
    id: string;
    name: string;
    type: FieldType;
    options: string[] | null;
    required: boolean;
    position: number;
    value: FieldValue;
}

export interface ItemDetailDto {
    id: string;
    name: string;
    notes: string | null;
    quantity: number;
    isFavorite: boolean;
    superset: string | null;
    supersetEntry: string | null;
    /** Filled in by the API layer when the item is matched to a catalog entry. */
    supersetLabel?: string | null;
    collectionId: string;
    collectionName: string;
    collectionEmoji: string | null;
    templateId: string | null;
    templateName: string | null;
    fields: ItemFieldWithValueDto[];
    images: ImageDto[];
    tags: ItemTagDto[];
    createdAt: string;
    updatedAt: string;
}

export interface HistoryEventDto {
    id: string;
    action: HistoryAction;
    changes: HistoryChange[] | null;
    snapshot: ItemSnapshot;
    createdAt: string;
}

export interface StatsDto {
    collectionCount: number;
    itemCount: number;
    favoriteCount: number;
    tagCount: number;
    recentItems: ItemListItemDto[];
}

export interface ItemListResultDto {
    items: ItemListItemDto[];
    total: number;
    page: number;
    limit: number;
}

export interface ApiKeyDto {
    id: string;
    name: string;
    readonly: boolean;
    createdAt: string;
    lastUsedAt: string | null;
    revokedAt: string | null;
}

export interface TrashDto {
    items: DeletedItemDto[];
    collections: DeletedCollectionDto[];
}
