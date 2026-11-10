import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Router, type Request, type Response } from 'express';
import type { Database, ItemDetailDto } from '@antiquary/database';
import { ValidationError } from '@antiquary/database';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { requireApiKey } from '../apiKeys.js';
import type { SupersetRegistry } from '../supersets.js';
import {
    MAX_IMAGE_BYTES,
    isAllowedImageMime,
    mimeFromFilename,
    promoteStagedImage,
    saveStagedImage,
    sweepStaging,
} from '../upload.js';
import { stat } from 'node:fs/promises';

function asText(result: unknown) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
}

const imageAttachSchema = z
    .array(
        z.object({
            filename: z.string().min(1),
            caption: z.string().nullable().optional(),
        }),
    )
    .max(10)
    .optional();

/** Moves staged uploads into the upload dir and attaches them as item photos. */
async function attachStagedImages(
    db: Database,
    uploadDir: string,
    itemId: string,
    images: { filename: string; caption?: string | null }[],
): Promise<void> {
    for (const image of images) {
        const promoted = await promoteStagedImage(uploadDir, image.filename);
        if (!promoted) {
            throw new ValidationError(
                `Unknown staged image "${image.filename}" — upload it again with upload_image`,
            );
        }
        const info = await stat(join(uploadDir, image.filename));
        await db.addImage(itemId, {
            filename: image.filename,
            mime: mimeFromFilename(image.filename),
            size: info.size,
            caption: image.caption ?? null,
        });
    }
}

const fieldValuesSchema = z
    .array(
        z.object({
            fieldId: z.string().uuid(),
            value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
        }),
    )
    .optional();

/**
 * Builds a fresh MCP server for one request. Read-only (non-destructive)
 * keys get only the read tools — every deletion action is dropped.
 */
function buildServer(
    db: Database,
    supersets: SupersetRegistry,
    uploadDir: string,
    readonly: boolean,
): McpServer {
    const server = new McpServer(
        { name: 'antiquary', version: '0.1.0' },
        { capabilities: { tools: {} } },
    );

    // ---- read tools (always available) ----
    server.registerTool(
        'get_stats',
        {
            description:
                'Dashboard stats: collection/item/favorite/tag counts and recently added items.',
        },
        async () => asText(await db.getStats()),
    );

    server.registerTool(
        'list_collections',
        { description: 'List collections with item counts.' },
        async () => asText(await db.listCollections()),
    );

    server.registerTool(
        'get_collection',
        {
            description: 'Get one collection by id, including its item count.',
            inputSchema: { id: z.string().uuid() },
        },
        async ({ id }) => {
            const collection = await db.getCollection(id);
            return collection ? asText(collection) : asText({ error: 'Collection not found' });
        },
    );

    server.registerTool(
        'list_templates',
        { description: 'List templates with their fields and superset catalog binding.' },
        async () => asText(await db.listTemplates()),
    );

    server.registerTool('list_tags', { description: 'List tags with item counts.' }, async () =>
        asText(await db.listTags()),
    );

    server.registerTool(
        'search_items',
        {
            description:
                'Search items across names, notes and custom field values. Filter by collection, tag or favorites; sort and page results.',
            inputSchema: {
                search: z.string().optional(),
                collectionId: z.string().uuid().optional(),
                tagId: z.string().uuid().optional(),
                favorite: z.boolean().optional(),
                sort: z.enum(['created', 'updated', 'name']).optional(),
                order: z.enum(['asc', 'desc']).optional(),
                page: z.number().int().min(1).optional(),
                limit: z.number().int().min(1).max(100).optional(),
            },
        },
        async (params) => asText(await db.listItems(params)),
    );

    server.registerTool(
        'get_item',
        {
            description:
                'Get one item in full detail: custom field values, images, tags and (optionally) its history events.',
            inputSchema: { id: z.string().uuid(), includeHistory: z.boolean().optional() },
        },
        async ({ id, includeHistory }) => {
            const item = await db.getItem(id);
            if (!item) return asText({ error: 'Item not found' });
            let label: string | null = null;
            if (item.superset && item.supersetEntry) {
                label = (await supersets.getEntry(item.superset, item.supersetEntry))?.name ?? null;
            }
            const detail: ItemDetailDto & { supersetLabel: string | null } = {
                ...item,
                supersetLabel: label,
            };
            if (includeHistory) {
                return asText({ item: detail, history: await db.getItemHistory(id) });
            }
            return asText(detail);
        },
    );

    server.registerTool(
        'search_catalog',
        {
            description:
                'Search a bundled superset catalog (e.g. key "snes", "nes", "megadrive", "ps1", "pc", "dos"). ' +
                'Returns titles grouped by their release variants (region, serial, year).',
            inputSchema: {
                superset: z.string().min(1),
                query: z.string().min(1),
            },
        },
        async ({ superset, query }) => {
            if (!supersets.get(superset)) return asText({ error: `Unknown catalog "${superset}"` });
            return asText({ results: await supersets.search(superset, query) });
        },
    );

    server.registerTool(
        'list_supersets',
        { description: 'List the bundled superset catalogs with their keys and sizes.' },
        async () => asText(supersets.list()),
    );

    server.registerTool(
        'get_image',
        {
            description:
                'Download an image by id — returns the raw image (base64) with its mime type. ' +
                'Image ids appear in search_items results, get_item and upload_image confirmations.',
            inputSchema: { imageId: z.string().uuid() },
        },
        async ({ imageId }) => {
            const image = await db.getImage(imageId);
            if (!image) return asText({ error: 'Image not found' });
            try {
                const data = await readFile(join(uploadDir, image.filename));
                return {
                    content: [
                        {
                            type: 'image' as const,
                            data: data.toString('base64'),
                            mimeType: image.mime,
                        },
                    ],
                };
            } catch {
                return asText({ error: 'The image file is missing on the server' });
            }
        },
    );

    if (readonly) return server;

    // ---- write tools (full keys only) ----
    server.registerTool(
        'create_collection',
        {
            description: 'Create a collection.',
            inputSchema: {
                name: z.string().min(1),
                description: z.string().nullable().optional(),
                emoji: z.string().nullable().optional(),
                color: z
                    .string()
                    .regex(/^#[0-9a-fA-F]{6}$/)
                    .nullable()
                    .optional(),
            },
        },
        async (params) => asText(await db.createCollection(params)),
    );

    server.registerTool(
        'upload_image',
        {
            description:
                'Upload an image (base64) to attach to items. Returns a staged filename — pass it as ' +
                'images[].filename in create_item or update_item. Unattached staged files expire after ~24h. ' +
                'For image-type template fields, use the /uploads/<filename> URL as the field value after attaching.',
            inputSchema: {
                data: z.string().min(1),
                mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']),
            },
        },
        async ({ data, mime }) => {
            const buffer = Buffer.from(data, 'base64');
            if (buffer.length === 0)
                throw new ValidationError('Empty or invalid base64 image data');
            if (buffer.length > MAX_IMAGE_BYTES) {
                throw new ValidationError(
                    `Image exceeds ${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)} MB`,
                );
            }
            if (!isAllowedImageMime(mime))
                throw new ValidationError(`Unsupported image type ${mime}`);
            await sweepStaging(uploadDir).catch(() => {});
            const filename = await saveStagedImage(uploadDir, buffer, mime);
            return asText({
                filename,
                note: 'Attach with images[].filename in create_item/update_item',
            });
        },
    );

    server.registerTool(
        'create_item',
        {
            description:
                "Create an item in a collection. The collection's template provides the custom fields " +
                '(see list_templates / get_collection). When that template is bound to a superset catalog, ' +
                'a catalog match is REQUIRED: first search_catalog, then pass the chosen variant id as supersetEntry. ' +
                'Photos can be attached with images[] from upload_image.',
            inputSchema: {
                collectionId: z.string().uuid(),
                supersetEntry: z.string().nullable().optional(),
                name: z.string().min(1),
                notes: z.string().nullable().optional(),
                quantity: z.number().int().min(1).optional(),
                isFavorite: z.boolean().optional(),
                fieldValues: fieldValuesSchema,
                tagIds: z.array(z.string().uuid()).optional(),
                images: imageAttachSchema,
            },
        },
        async (params) => {
            const { images, ...input } = params;
            const collection = await db.getCollection(params.collectionId);
            if (!collection) return asText({ error: 'Collection not found' });
            const template = collection.templateId
                ? await db.getTemplate(collection.templateId)
                : null;
            if (template?.superset) {
                if (!params.supersetEntry) {
                    throw new ValidationError(
                        `This collection requires a catalog match — pick a variant via search_catalog ("${template.superset}") first`,
                    );
                }
                const entry = await supersets.getEntry(template.superset, params.supersetEntry);
                if (!entry) throw new ValidationError('Unknown catalog entry');
            } else if (params.supersetEntry) {
                throw new ValidationError(
                    'Catalog entries can only be used with a superset template',
                );
            }
            const created = await db.createItem(input);
            if (images) await attachStagedImages(db, uploadDir, created.id, images);
            return asText((await db.getItem(created.id)) ?? created);
        },
    );

    server.registerTool(
        'update_item',
        {
            description:
                'Update an item (name, notes, quantity, favorite, tags, custom field values, catalog match ' +
                'or attach photos from upload_image). The item stays in its collection and keeps the ' +
                "collection's template.",
            inputSchema: {
                id: z.string().uuid(),
                name: z.string().min(1).optional(),
                notes: z.string().nullable().optional(),
                quantity: z.number().int().min(1).optional(),
                isFavorite: z.boolean().optional(),
                supersetEntry: z.string().nullable().optional(),
                fieldValues: fieldValuesSchema,
                tagIds: z.array(z.string().uuid()).optional(),
                images: imageAttachSchema,
            },
        },
        async ({ id, images, ...patch }) => {
            if (patch.supersetEntry !== undefined) {
                const current = await db.getItem(id);
                if (!current) return asText({ error: 'Item not found' });
                const collection = await db.getCollection(current.collectionId);
                const template = collection?.templateId
                    ? await db.getTemplate(collection.templateId)
                    : null;
                if (patch.supersetEntry === null) {
                    if (template?.superset) {
                        throw new ValidationError('This collection requires a catalog match');
                    }
                } else if (!template?.superset) {
                    throw new ValidationError(
                        'Catalog entries can only be used with a superset template',
                    );
                } else {
                    const entry = await supersets.getEntry(template.superset, patch.supersetEntry);
                    if (!entry) throw new ValidationError('Unknown catalog entry');
                }
            }
            const updated = await db.updateItem(id, patch);
            if (!updated) return asText({ error: 'Item not found' });
            if (images) await attachStagedImages(db, uploadDir, id, images);
            return asText((await db.getItem(id)) ?? updated);
        },
    );

    server.registerTool(
        'create_tag',
        {
            description: 'Create a tag that can be attached to items.',
            inputSchema: {
                name: z.string().min(1),
                color: z
                    .string()
                    .regex(/^#[0-9a-fA-F]{6}$/)
                    .nullable()
                    .optional(),
            },
        },
        async (params) => asText(await db.createTag(params)),
    );

    // ---- deletion actions (full keys only — dropped for non-destructive keys) ----
    server.registerTool(
        'trash_item',
        {
            description: 'Move an item to the trash (soft delete — restorable).',
            inputSchema: { id: z.string().uuid() },
        },
        async ({ id }) => {
            await db.deleteItem(id);
            return asText({ ok: true, note: 'Item moved to trash; restore with restore_item' });
        },
    );

    server.registerTool(
        'restore_item',
        { description: 'Restore an item from the trash.', inputSchema: { id: z.string().uuid() } },
        async ({ id }) => asText(await db.restoreItem(id)),
    );

    server.registerTool(
        'trash_collection',
        {
            description:
                'Move a collection and all of its items to the trash (soft delete — restorable).',
            inputSchema: { id: z.string().uuid() },
        },
        async ({ id }) => asText(await db.deleteCollection(id)),
    );

    server.registerTool(
        'restore_collection',
        {
            description: 'Restore a collection (and its items) from the trash.',
            inputSchema: { id: z.string().uuid() },
        },
        async ({ id }) => asText(await db.restoreCollection(id)),
    );

    server.registerTool(
        'purge_item',
        {
            description:
                'PERMANENTLY delete a trashed item, including photos and history. Cannot be undone.',
            inputSchema: { id: z.string().uuid() },
        },
        async ({ id }) => {
            await db.purgeItem(id);
            return asText({ ok: true, purged: true });
        },
    );

    server.registerTool(
        'purge_collection',
        {
            description:
                'PERMANENTLY delete a trashed collection and every item inside it. Cannot be undone.',
            inputSchema: { id: z.string().uuid() },
        },
        async ({ id }) => {
            await db.purgeCollection(id);
            return asText({ ok: true, purged: true });
        },
    );

    return server;
}

export function mcpRoutes(db: Database, supersets: SupersetRegistry, uploadDir: string): Router {
    const router = Router();
    const auth = requireApiKey(db);

    const handle = async (req: Request, res: Response) => {
        const readonly = req.apiKey?.readonly ?? true;
        const server = buildServer(db, supersets, uploadDir, readonly);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on('close', () => {
            transport.close().catch(() => {});
            server.close().catch(() => {});
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    };

    router.post('/', auth, handle);
    // Stateless streamable HTTP: no SSE stream and no session termination.
    router.get('/', auth, (_req, res) => {
        res.status(405).json({ error: 'GET not supported; POST MCP messages to /mcp' });
    });
    router.delete('/', auth, (_req, res) => {
        res.status(405).json({ error: 'Not supported (stateless server)' });
    });

    return router;
}
