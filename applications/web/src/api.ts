import type {
    ApiKeyDto,
    CollectionDto,
    HistoryEventDto,
    ImageDto,
    ItemDetailDto,
    ItemListResultDto,
    ItemListItemDto,
    StatsDto,
    TagDto,
    TemplateDetailDto,
    TrashDto,
} from '@antiquary/database';

export class ApiError extends Error {
    constructor(
        message: string,
        public readonly status: number,
    ) {
        super(message);
    }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(path, init);
    if (!res.ok) {
        let message = `${res.status} ${res.statusText}`;
        try {
            const body = (await res.json()) as { error?: string };
            if (body.error) message = body.error;
        } catch {
            /* keep status text */
        }
        throw new ApiError(message, res.status);
    }
    return (await res.json()) as T;
}

function jsonInit(method: string, body: unknown): RequestInit {
    return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export interface ItemListParams {
    collectionId?: string;
    search?: string;
    favorite?: boolean;
    tagId?: string;
    sort?: 'created' | 'updated' | 'name';
    order?: 'asc' | 'desc';
    page?: number;
    limit?: number;
}

export interface SupersetRarityDto {
    rarity: number;
    rarityLabel: string | null;
    rarityPercent: number | null;
}

export interface SupersetEntryDto {
    id: string;
    name: string;
    parentTitle: string;
    region: string | null;
    serial: string | null;
    developer: string | null;
    publisher: string | null;
    genre: string | null;
    year: number | null;
    /** Compiled reference rarity, when the superset has one. */
    rarity?: SupersetRarityDto;
}

export interface SupersetEntryListItemDto extends SupersetEntryDto {
    owned: boolean;
    itemId: string | null;
}

export interface SupersetEntryListResultDto {
    entries: SupersetEntryListItemDto[];
    total: number;
    page: number;
    limit: number;
    ownedCount: number;
}

export interface SupersetInfoDto {
    key: string;
    name: string;
    source: string;
    sourceUrl: string;
    license: string;
    attribution: string;
    datVersion: string | null;
    /** False for curated (not exhaustive) catalogs — items may be marked outside them. */
    complete: boolean;
    generatedAt: string;
    variantCount: number;
    titleCount: number;
}

export const api = {
    stats: () => request<StatsDto>('/api/stats'),

    supersets: {
        list: () => request<SupersetInfoDto[]>('/api/supersets'),
        get: (key: string) => request<SupersetInfoDto>(`/api/supersets/${key}`),
        entries: (
            key: string,
            params: { q?: string; ownership?: string; page?: number; limit?: number } = {},
        ) => {
            const qs = new URLSearchParams();
            for (const [k, value] of Object.entries(params)) {
                if (value !== undefined && value !== null && value !== '') qs.set(k, String(value));
            }
            const suffix = qs.size > 0 ? `?${qs.toString()}` : '';
            return request<SupersetEntryListResultDto>(`/api/supersets/${key}/entries${suffix}`);
        },
        search: (key: string, q: string) =>
            request<{ results: { title: string; variants: SupersetEntryDto[] }[] }>(
                `/api/supersets/${key}/search?q=${encodeURIComponent(q)}`,
            ),
        entry: (key: string, id: string) =>
            request<SupersetEntryDto>(`/api/supersets/${key}/entries/${id}`),
    },

    collections: {
        list: () => request<CollectionDto[]>('/api/collections'),
        get: (id: string) => request<CollectionDto>(`/api/collections/${id}`),
        create: (body: {
            name: string;
            description?: string | null;
            emoji?: string | null;
            color?: string | null;
            templateId?: string | null;
        }) => request<CollectionDto>('/api/collections', jsonInit('POST', body)),
        update: (
            id: string,
            body: {
                name?: string;
                description?: string | null;
                emoji?: string | null;
                color?: string | null;
                templateId?: string | null;
            },
        ) => request<CollectionDto>(`/api/collections/${id}`, jsonInit('PATCH', body)),
        remove: (id: string) =>
            request<{ ok: boolean; trashedItems: number }>(`/api/collections/${id}`, {
                method: 'DELETE',
            }),
        purge: (id: string) =>
            request<{ ok: boolean }>(`/api/collections/${id}?permanent=true`, { method: 'DELETE' }),
        restore: (id: string) =>
            request<CollectionDto>(`/api/collections/${id}/restore`, { method: 'POST' }),
    },

    templates: {
        list: () => request<TemplateDetailDto[]>('/api/templates'),
        get: (id: string) => request<TemplateDetailDto>(`/api/templates/${id}`),
        create: (body: {
            name: string;
            description?: string | null;
            superset?: string | null;
            fields?: {
                name: string;
                type: string;
                options?: string[] | null;
                required?: boolean;
            }[];
        }) => request<TemplateDetailDto>('/api/templates', jsonInit('POST', body)),
        update: (
            id: string,
            body: {
                name?: string;
                description?: string | null;
                superset?: string | null;
                fields?: {
                    id?: string;
                    name: string;
                    type: string;
                    options?: string[] | null;
                    required?: boolean;
                }[];
            },
        ) => request<TemplateDetailDto>(`/api/templates/${id}`, jsonInit('PATCH', body)),
        remove: (id: string) =>
            request<{ ok: boolean }>(`/api/templates/${id}`, { method: 'DELETE' }),
    },

    items: {
        list: (params: ItemListParams = {}) => {
            const qs = new URLSearchParams();
            for (const [key, value] of Object.entries(params)) {
                if (value !== undefined && value !== null && value !== '')
                    qs.set(key, String(value));
            }
            const suffix = qs.size > 0 ? `?${qs.toString()}` : '';
            return request<ItemListResultDto>(`/api/items${suffix}`);
        },
        get: (id: string) => request<ItemDetailDto>(`/api/items/${id}`),
        create: (body: {
            collectionId: string;
            supersetEntry?: string | null;
            outsideSuperset?: boolean;
            name: string;
            notes?: string | null;
            quantity?: number;
            isFavorite?: boolean;
            fieldValues?: {
                fieldId: string;
                value: string | number | boolean | { amount: number; currency: string } | null;
            }[];
            tagIds?: string[];
        }) => request<ItemDetailDto>('/api/items', jsonInit('POST', body)),
        update: (
            id: string,
            body: {
                name?: string;
                notes?: string | null;
                quantity?: number;
                isFavorite?: boolean;
                supersetEntry?: string | null;
                outsideSuperset?: boolean;
                fieldValues?: {
                    fieldId: string;
                    value: string | number | boolean | { amount: number; currency: string } | null;
                }[];
                tagIds?: string[];
            },
        ) => request<ItemDetailDto>(`/api/items/${id}`, jsonInit('PATCH', body)),
        remove: (id: string) => request<{ ok: boolean }>(`/api/items/${id}`, { method: 'DELETE' }),
        purge: (id: string) =>
            request<{ ok: boolean }>(`/api/items/${id}?permanent=true`, { method: 'DELETE' }),
        restore: (id: string) =>
            request<ItemDetailDto>(`/api/items/${id}/restore`, { method: 'POST' }),
        history: (id: string) => request<{ events: HistoryEventDto[] }>(`/api/items/${id}/history`),
    },

    images: {
        upload: async (itemId: string, files: File[]) => {
            const form = new FormData();
            for (const file of files) form.append('images', file);
            return request<{ images: ImageDto[] }>(`/api/items/${itemId}/images`, {
                method: 'POST',
                body: form,
            });
        },
        uploadStandalone: async (file: File) => {
            const form = new FormData();
            form.append('image', file);
            return request<{ filename: string; url: string; mime: string; size: number }>(
                '/api/images',
                {
                    method: 'POST',
                    body: form,
                },
            );
        },
        update: (id: string, body: { caption?: string | null; isCover?: boolean }) =>
            request<ImageDto>(`/api/images/${id}`, jsonInit('PATCH', body)),
        remove: (id: string) => request<{ ok: boolean }>(`/api/images/${id}`, { method: 'DELETE' }),
    },

    tags: {
        list: () => request<TagDto[]>('/api/tags'),
        create: (body: { name: string; color?: string | null }) =>
            request<TagDto>('/api/tags', jsonInit('POST', body)),
        update: (id: string, body: { name?: string; color?: string | null }) =>
            request<TagDto>(`/api/tags/${id}`, jsonInit('PATCH', body)),
        remove: (id: string) => request<{ ok: boolean }>(`/api/tags/${id}`, { method: 'DELETE' }),
    },

    trash: () => request<TrashDto>('/api/trash'),

    settings: {
        apiKeys: {
            list: () => request<ApiKeyDto[]>('/api/settings/api-keys'),
            create: (body: { name: string; readonly?: boolean }) =>
                request<{ apiKey: ApiKeyDto; key: string }>(
                    '/api/settings/api-keys',
                    jsonInit('POST', body),
                ),
            revoke: (id: string) =>
                request<{ ok: boolean }>(`/api/settings/api-keys/${id}`, { method: 'DELETE' }),
        },
    },
};

export type { ItemListItemDto };
