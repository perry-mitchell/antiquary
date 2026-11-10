import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database, ensureDatabase, resetDatabase } from '@antiquary/database';
import { createApp } from '../src/app.js';
import { SupersetRegistry } from '../src/supersets.js';

const url =
    process.env.TEST_DATABASE_URL ?? 'postgres://antiquary:antiquary@localhost:5432/antiquary_test';

const PNG_1x1 = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0f01f0005050201edb5ca9f0000000049454e44ae426082',
    'hex',
);

let db: Database;
let uploadDir: string;
let api: request.Agent;

let collectionId: string;
let templateId: string;
let authorFieldId: string;
let itemId: string;
let imageId: string;
let imageFilename: string;

beforeAll(async () => {
    await ensureDatabase(url);
    await resetDatabase(url);
    db = new Database(url);
    uploadDir = await mkdtemp(join(tmpdir(), 'collector-uploads-'));
    const supersets = await SupersetRegistry.load();
    const app = createApp({ db, uploadDir, supersets });
    api = request(app);
});

afterAll(async () => {
    await db.close();
});

describe('health', () => {
    it('reports ok', async () => {
        const res = await api.get('/api/health');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true });
    });
});

describe('collections', () => {
    it('validates the body', async () => {
        const res = await api.post('/api/collections').send({ name: '' });
        expect(res.status).toBe(400);
        expect(res.body.error).toBeDefined();
    });

    it('creates, gets and lists collections', async () => {
        const created = await api
            .post('/api/collections')
            .send({ name: 'Vinyl', emoji: '🎵', description: 'Records' });
        expect(created.status).toBe(201);
        collectionId = created.body.id;

        const got = await api.get(`/api/collections/${collectionId}`);
        expect(got.status).toBe(200);
        expect(got.body.name).toBe('Vinyl');

        const list = await api.get('/api/collections');
        expect(list.body).toHaveLength(1);
    });

    it('404s unknown collections', async () => {
        const res = await api.get('/api/collections/00000000-0000-0000-0000-000000000000');
        expect(res.status).toBe(404);
    });

    it('rejects bad colors', async () => {
        const res = await api.post('/api/collections').send({ name: 'X', color: 'red' });
        expect(res.status).toBe(400);
    });
});

describe('templates', () => {
    it('creates a template with fields', async () => {
        const res = await api.post('/api/templates').send({
            name: 'Album',
            fields: [
                { name: 'Artist', type: 'text', required: true },
                { name: 'Pressed', type: 'date' },
                { name: 'Format', type: 'select', options: ['LP', 'EP', 'Single'] },
            ],
        });
        expect(res.status).toBe(201);
        templateId = res.body.id;
        authorFieldId = res.body.fields[0].id;
        expect(res.body.fields).toHaveLength(3);
    });

    it('lists templates', async () => {
        const res = await api.get('/api/templates');
        expect(res.body[0].name).toBe('Album');
    });

    it('binds the template to the collection', async () => {
        const res = await api.patch(`/api/collections/${collectionId}`).send({ templateId });
        expect(res.status).toBe(200);
        expect(res.body.templateId).toBe(templateId);
    });
});

describe('items', () => {
    it('creates an item', async () => {
        const res = await api.post('/api/items').send({
            collectionId,
            name: 'Random Access Memories',
            fieldValues: [{ fieldId: authorFieldId, value: 'Daft Punk' }],
            quantity: 1,
        });
        expect(res.status).toBe(201);
        itemId = res.body.id;
        expect(res.body.templateName).toBe('Album');
        expect(res.body.fields.find((f) => f.name === 'Artist')?.value).toBe('Daft Punk');
    });

    it('rejects invalid field values', async () => {
        const res = await api.post('/api/items').send({
            collectionId,
            name: 'Nope',
            fieldValues: [{ fieldId: authorFieldId, value: 123 }],
        });
        expect(res.status).toBe(400);
    });

    it('rejects unknown collections', async () => {
        const res = await api.post('/api/items').send({
            collectionId: '00000000-0000-0000-0000-000000000000',
            name: 'X',
        });
        expect(res.status).toBe(404);
    });

    it('searches items', async () => {
        const res = await api.get('/api/items?search=daft');
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(1);
    });

    it('supports favorite filter + sorting', async () => {
        await api.patch(`/api/items/${itemId}`).send({ isFavorite: true });
        const favs = await api.get('/api/items?favorite=true&sort=name&order=asc');
        expect(favs.body.total).toBe(1);
        expect(favs.body.items[0].isFavorite).toBe(true);
    });
});

describe('images', () => {
    it('uploads an image and serves it statically', async () => {
        const res = await api
            .post(`/api/items/${itemId}/images`)
            .attach('images', PNG_1x1, { filename: 'cover.png', contentType: 'image/png' });
        expect(res.status).toBe(201);
        expect(res.body.images).toHaveLength(1);
        imageId = res.body.images[0].id;
        imageFilename = res.body.images[0].filename;

        const file = await api.get(`/uploads/${imageFilename}`);
        expect(file.status).toBe(200);
        expect(file.headers['content-type']).toBe('image/png');
    });

    it('rejects non-image uploads', async () => {
        const res = await api
            .post(`/api/items/${itemId}/images`)
            .attach('images', Buffer.from('hello'), {
                filename: 'notes.txt',
                contentType: 'text/plain',
            });
        expect(res.status).toBe(400);
    });

    it('uploads a standalone image for template fields', async () => {
        const res = await api
            .post('/api/images')
            .attach('image', PNG_1x1, { filename: 'field.png', contentType: 'image/png' });
        expect(res.status).toBe(201);
        expect(res.body.url).toMatch(/^\/uploads\/.+\.png$/);
        const file = await api.get(res.body.url);
        expect(file.status).toBe(200);
        expect(file.headers['content-type']).toBe('image/png');
    });

    it('deletes an image', async () => {
        const res = await api.delete(`/api/images/${imageId}`);
        expect(res.status).toBe(200);
        const item = await api.get(`/api/items/${itemId}`);
        expect(item.body.images).toHaveLength(0);
    });
});

describe('history and trash', () => {
    it('records history events', async () => {
        const res = await api.get(`/api/items/${itemId}/history`);
        expect(res.status).toBe(200);
        const actions = res.body.events.map((e: { action: string }) => e.action);
        expect(actions).toContain('created');
        expect(actions).toContain('updated');
        expect(actions).toContain('image_added');
        expect(actions).toContain('image_removed');
    });

    it('moves an item to trash and restores it', async () => {
        const del = await api.delete(`/api/items/${itemId}`);
        expect(del.status).toBe(200);

        const missing = await api.get(`/api/items/${itemId}`);
        expect(missing.status).toBe(404);

        const trash = await api.get('/api/trash');
        expect(trash.body.items).toHaveLength(1);
        expect(trash.body.items[0].name).toBe('Random Access Memories');

        const restore = await api.post(`/api/items/${itemId}/restore`);
        expect(restore.status).toBe(200);
        expect(restore.body.name).toBe('Random Access Memories');
    });

    it('purges a trashed item permanently', async () => {
        await api.delete(`/api/items/${itemId}`);
        const res = await api.delete(`/api/items/${itemId}?permanent=true`);
        expect(res.status).toBe(200);
        const trash = await api.get('/api/trash');
        expect(trash.body.items).toHaveLength(0);
    });

    it('trashes + restores a collection with items', async () => {
        const item = await api.post('/api/items').send({
            collectionId,
            name: 'Discovery',
            fieldValues: [{ fieldId: authorFieldId, value: 'Daft Punk' }],
        });
        const del = await api.delete(`/api/collections/${collectionId}`);
        expect(del.body.trashedItems).toBe(1);

        const restore = await api.post(`/api/collections/${collectionId}/restore`);
        expect(restore.status).toBe(200);
        const items = await api.get(`/api/items?collectionId=${collectionId}`);
        expect(items.body.total).toBe(1);
        expect(item.body.id).toBeDefined();
    });

    it('purges a trashed collection permanently', async () => {
        await api.delete(`/api/collections/${collectionId}`);
        const purge = await api.delete(`/api/collections/${collectionId}?permanent=true`);
        expect(purge.status).toBe(200);
        const trash = await api.get('/api/trash');
        expect(trash.body.collections).toHaveLength(0);
        collectionId = (await api.post('/api/collections').send({ name: 'Vinyl' })).body.id;
    });
});

describe('tags', () => {
    it('creates, lists and rejects duplicates', async () => {
        const created = await api
            .post('/api/tags')
            .send({ name: 'french house', color: '#22d3ee' });
        expect(created.status).toBe(201);
        const dup = await api.post('/api/tags').send({ name: 'French House' });
        expect(dup.status).toBe(409);
        const list = await api.get('/api/tags');
        expect(list.body).toHaveLength(1);
    });
});

describe('stats + api 404', () => {
    it('returns stats', async () => {
        const res = await api.get('/api/stats');
        expect(res.status).toBe(200);
        expect(res.body.collectionCount).toBe(1);
        expect(res.body.itemCount).toBe(0);
    });

    it('returns json 404 for unknown api routes', async () => {
        const res = await api.get('/api/definitely-not-a-route');
        expect(res.status).toBe(404);
        expect(res.body.error).toBe('Not found');
    });
});

describe('settings: api keys', () => {
    it('validates key names', async () => {
        expect((await api.post('/api/settings/api-keys').send({ name: '' })).status).toBe(400);
    });

    it('creates a key shown exactly once and never lists the secret', async () => {
        const created = await api
            .post('/api/settings/api-keys')
            .send({ name: 'Test client', readonly: true });
        expect(created.status).toBe(201);
        expect(created.body.key).toMatch(/^mcp_[0-9a-f]{64}$/);
        expect(created.body.apiKey.readonly).toBe(true);
        expect(created.body.apiKey.name).toBe('Test client');

        const dup = await api.post('/api/settings/api-keys').send({ name: 'test client' });
        expect(dup.status).toBe(409);

        const list = await api.get('/api/settings/api-keys');
        expect(list.body).toHaveLength(1);
        expect(JSON.stringify(list.body)).not.toContain(created.body.key);
    });
});

describe('mcp endpoint', () => {
    let fullKey: string;
    let readOnlyKey: string;

    beforeAll(async () => {
        fullKey = (
            await api.post('/api/settings/api-keys').send({ name: 'mcp full', readonly: false })
        ).body.key;
        readOnlyKey = (
            await api.post('/api/settings/api-keys').send({ name: 'mcp readonly', readonly: true })
        ).body.key;
    });

    const rpc = async (key: string | null, body: unknown) =>
        api
            .post('/mcp')
            .set(key ? { Authorization: `Bearer ${key}` } : {})
            .set('Accept', 'application/json, text/event-stream')
            .send(body);

    // The streamable HTTP transport answers with an SSE frame when the client
    // accepts it — unwrap the single `data:` message into plain JSON.
    const unwrap = (res: { body: unknown; text?: string }) => {
        const dataLine = res.text?.split('\n').find((line) => line.startsWith('data: '));
        return dataLine
            ? (JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>)
            : res.body;
    };

    const toolNames = async (key: string) => {
        const res = await rpc(key, {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/list',
        });
        const result = unwrap(res).result as { tools: { name: string }[] };
        return result.tools.map((t) => t.name);
    };

    it('requires a valid key', async () => {
        expect((await rpc(null, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401);
        expect((await rpc('mcp_bogus', { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(
            401,
        );
    });

    it('initializes and responds to ping', async () => {
        const init = await rpc(readOnlyKey, {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2025-03-26',
                capabilities: {},
                clientInfo: { name: 'test', version: '0' },
            },
        });
        expect(init.status).toBe(200);
        expect((unwrap(init).result as { serverInfo: { name: string } }).serverInfo.name).toBe(
            'antiquary',
        );

        const ping = await rpc(readOnlyKey, { jsonrpc: '2.0', id: 2, method: 'ping' });
        expect(ping.status).toBe(200);
        expect(unwrap(ping).result as unknown).toEqual({});
    });

    it('read-only keys drop deletion and write actions', async () => {
        const tools = await toolNames(readOnlyKey);
        expect(tools).toContain('search_items');
        expect(tools).toContain('search_catalog');
        expect(tools).toContain('get_stats');
        for (const banned of [
            'trash_item',
            'purge_item',
            'trash_collection',
            'purge_collection',
            'restore_item',
            'restore_collection',
            'create_item',
            'create_collection',
            'update_item',
            'create_tag',
            'upload_image',
        ]) {
            expect(tools).not.toContain(banned);
        }
    });

    it('full keys expose write and deletion actions', async () => {
        const tools = await toolNames(fullKey);
        expect(tools).toContain('create_item');
        expect(tools).toContain('trash_item');
        expect(tools).toContain('purge_collection');
    });

    it('tools work end to end: create an item via MCP, find it, trash it', async () => {
        const created = await rpc(fullKey, {
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: {
                name: 'create_item',
                arguments: { collectionId, name: 'MCP created item' },
            },
        });
        expect(created.status).toBe(200);
        const createdResult = unwrap(created).result as {
            isError?: boolean;
            content: { text: string }[];
        };
        expect(createdResult.isError).toBeFalsy();
        const itemId = JSON.parse(createdResult.content[0]!.text).id;

        const found = await rpc(readOnlyKey, {
            jsonrpc: '2.0',
            id: 4,
            method: 'tools/call',
            params: { name: 'search_items', arguments: { search: 'MCP created' } },
        });
        const foundResult = unwrap(found).result as { content: { text: string }[] };
        expect(JSON.parse(foundResult.content[0]!.text).total).toBe(1);

        const trashed = await rpc(fullKey, {
            jsonrpc: '2.0',
            id: 5,
            method: 'tools/call',
            params: { name: 'trash_item', arguments: { id: itemId } },
        });
        const trashedResult = unwrap(trashed).result as { content: { text: string }[] };
        expect(JSON.parse(trashedResult.content[0]!.text).ok).toBe(true);

        const gone = await rpc(readOnlyKey, {
            jsonrpc: '2.0',
            id: 6,
            method: 'tools/call',
            params: { name: 'search_items', arguments: { search: 'MCP created' } },
        });
        const goneResult = unwrap(gone).result as { content: { text: string }[] };
        expect(JSON.parse(goneResult.content[0]!.text).total).toBe(0);
    });

    it('rejects unknown and dropped tools cleanly', async () => {
        const res = await rpc(readOnlyKey, {
            jsonrpc: '2.0',
            id: 7,
            method: 'tools/call',
            params: {
                name: 'trash_item',
                arguments: { id: '00000000-0000-0000-0000-000000000000' },
            },
        });
        expect(res.status).toBe(200);
        const result = unwrap(res).result as { isError?: boolean; content: { text: string }[] };
        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toContain('trash_item');
        expect(result.content[0]!.text).toContain('not found');
    });

    it('requires a catalog match when creating items in a superset collection', async () => {
        const tpl = await api.post('/api/templates').send({
            name: 'MCP snes template',
            superset: 'snes',
            fields: [],
        });
        const shelf = await api
            .post('/api/collections')
            .send({ name: 'MCP snes shelf', templateId: tpl.body.id });

        const missing = await rpc(fullKey, {
            jsonrpc: '2.0',
            id: 9,
            method: 'tools/call',
            params: {
                name: 'create_item',
                arguments: { collectionId: shelf.body.id, name: 'Mario Golf (GOLF)' },
            },
        });
        const missingResult = unwrap(missing).result as {
            isError?: boolean;
            content: { text: string }[];
        };
        expect(missingResult.isError).toBe(true);
        expect(missingResult.content[0]!.text).toContain('catalog');

        const matched = await rpc(fullKey, {
            jsonrpc: '2.0',
            id: 10,
            method: 'tools/call',
            params: {
                name: 'create_item',
                arguments: {
                    collectionId: shelf.body.id,
                    name: 'Mario Golf',
                    supersetEntry: '2D206BF7',
                },
            },
        });
        const matchedResult = unwrap(matched).result as {
            isError?: boolean;
            content: { text: string }[];
        };
        expect(matchedResult.isError).toBeFalsy();
        expect(JSON.parse(matchedResult.content[0]!.text).superset).toBe('snes');
    });

    it('creates items outside incomplete catalogs via MCP with the explicit flag', async () => {
        const tpl = await api.post('/api/templates').send({
            name: 'MCP pc template',
            superset: 'pc',
            fields: [],
        });
        const shelf = await api
            .post('/api/collections')
            .send({ name: 'MCP pc shelf', templateId: tpl.body.id });

        const missing = await rpc(fullKey, {
            jsonrpc: '2.0',
            id: 16,
            method: 'tools/call',
            params: {
                name: 'create_item',
                arguments: { collectionId: shelf.body.id, name: 'Obscure Shareware Game' },
            },
        });
        const missingResult = unwrap(missing).result as {
            isError?: boolean;
            content: { text: string }[];
        };
        expect(missingResult.isError).toBe(true);
        expect(missingResult.content[0]!.text).toContain('not exhaustive');

        const outside = await rpc(fullKey, {
            jsonrpc: '2.0',
            id: 17,
            method: 'tools/call',
            params: {
                name: 'create_item',
                arguments: {
                    collectionId: shelf.body.id,
                    name: 'Obscure Shareware Game',
                    outsideSuperset: true,
                },
            },
        });
        const outsideResult = unwrap(outside).result as {
            isError?: boolean;
            content: { text: string }[];
        };
        expect(outsideResult.isError).toBeFalsy();
        const outsideItem = JSON.parse(outsideResult.content[0]!.text) as {
            superset: string;
            supersetEntry: string | null;
        };
        expect(outsideItem.superset).toBe('pc');
        expect(outsideItem.supersetEntry).toBeNull();
    });

    it('uploads, attaches and downloads images over MCP', async () => {
        // 1. upload_image → staged filename
        const upload = await rpc(fullKey, {
            jsonrpc: '2.0',
            id: 11,
            method: 'tools/call',
            params: {
                name: 'upload_image',
                arguments: { data: PNG_1x1.toString('base64'), mime: 'image/png' },
            },
        });
        const uploadResult = unwrap(upload).result as {
            isError?: boolean;
            content: { text: string }[];
        };
        expect(uploadResult.isError).toBeFalsy();
        const { filename } = JSON.parse(uploadResult.content[0]!.text) as { filename: string };

        // 2. create_item with the staged file attached
        const created = await rpc(fullKey, {
            jsonrpc: '2.0',
            id: 12,
            method: 'tools/call',
            params: {
                name: 'create_item',
                arguments: {
                    collectionId,
                    name: 'MCP photo item',
                    images: [{ filename, caption: 'front cover' }],
                },
            },
        });
        const createdResult = unwrap(created).result as {
            isError?: boolean;
            content: { text: string }[];
        };
        expect(createdResult.isError).toBeFalsy();
        const item = JSON.parse(createdResult.content[0]!.text) as {
            id: string;
            images: { id: string; url: string; caption: string | null }[];
        };
        expect(item.images).toHaveLength(1);
        expect(item.images[0]!.caption).toBe('front cover');

        // the staged file was promoted into the real upload dir
        const served = await api.get(item.images[0]!.url);
        expect(served.status).toBe(200);
        expect(served.headers['content-type']).toBe('image/png');

        // 3. search_items listings include images
        const found = await rpc(fullKey, {
            jsonrpc: '2.0',
            id: 13,
            method: 'tools/call',
            params: { name: 'search_items', arguments: { search: 'MCP photo' } },
        });
        const foundResult = unwrap(found).result as { content: { text: string }[] };
        const listing = JSON.parse(foundResult.content[0]!.text) as {
            items: { images: { id: string; isCover: boolean }[] }[];
        };
        expect(listing.items[0]!.images).toHaveLength(1);
        expect(listing.items[0]!.images[0]!.isCover).toBe(true);
        const imageId = listing.items[0]!.images[0]!.id;

        // 4. get_image returns the raw bytes as an image content block
        const downloaded = await rpc(fullKey, {
            jsonrpc: '2.0',
            id: 14,
            method: 'tools/call',
            params: { name: 'get_image', arguments: { imageId } },
        });
        const downloadResult = unwrap(downloaded).result as {
            isError?: boolean;
            content: { type: string; data?: string; mimeType?: string }[];
        };
        expect(downloadResult.isError).toBeFalsy();
        expect(downloadResult.content[0]!.type).toBe('image');
        expect(downloadResult.content[0]!.mimeType).toBe('image/png');
        expect(Buffer.from(downloadResult.content[0]!.data!, 'base64')).toEqual(PNG_1x1);

        // 5. attaching an unknown staged filename fails loudly
        const bogus = await rpc(fullKey, {
            jsonrpc: '2.0',
            id: 15,
            method: 'tools/call',
            params: {
                name: 'update_item',
                arguments: { id: item.id, images: [{ filename: 'not-a-staged-file.png' }] },
            },
        });
        const bogusResult = unwrap(bogus).result as {
            isError?: boolean;
            content: { text: string }[];
        };
        expect(bogusResult.isError).toBe(true);
        expect(bogusResult.content[0]!.text).toContain('staged');
    });

    it('revoking a key immediately blocks access', async () => {
        const list = await api.get('/api/settings/api-keys');
        const target = list.body.find((k: { name: string }) => k.name === 'mcp readonly');
        const revoke = await api.delete(`/api/settings/api-keys/${target.id}`);
        expect(revoke.status).toBe(200);
        expect((await rpc(readOnlyKey, { jsonrpc: '2.0', id: 8, method: 'ping' })).status).toBe(
            401,
        );
    });
});

describe('supersets', () => {
    it('lists bundled catalogs with attribution', async () => {
        const res = await api.get('/api/supersets');
        expect(res.status).toBe(200);
        const snes = res.body.find((s: { key: string }) => s.key === 'snes');
        expect(snes).toBeDefined();
        expect(snes.license).toBe('CC-BY-SA-4.0');
        expect(snes.attribution).toContain('libretro-database');
        expect(snes.variantCount).toBeGreaterThan(3000);
        expect(snes.titleCount).toBeGreaterThan(2000);
    });

    it('searches the catalog grouped by title', async () => {
        const res = await api.get('/api/supersets/snes/search?q=chrono+trigger');
        expect(res.status).toBe(200);
        const match = res.body.results.find((r: { title: string }) => r.title === 'Chrono Trigger');
        expect(match).toBeDefined();
        expect(match.variants.length).toBeGreaterThanOrEqual(2);
        expect(match.variants.map((v: { serial: string | null }) => v.serial)).toContain(
            'SNS-ACTE-USA',
        );
    });

    it('resolves a single entry', async () => {
        const res = await api.get('/api/supersets/snes/entries/2D206BF7');
        expect(res.status).toBe(200);
        expect(res.body.name).toBe('Chrono Trigger (USA)');
        expect((await api.get('/api/supersets/snes/entries/DEADBEEF')).status).toBe(404);
    });

    it('validates the search query and catalog key', async () => {
        expect((await api.get('/api/supersets/snes/search')).status).toBe(400);
        expect((await api.get('/api/supersets/nope/search?q=x')).status).toBe(404);
    });

    it('requires a catalog match when the collection template has a superset', async () => {
        const tpl = await api.post('/api/templates').send({
            name: 'SNES template',
            superset: 'snes',
            fields: [{ name: 'Condition', type: 'text' }],
        });
        const shelf = await api
            .post('/api/collections')
            .send({ name: 'SNES shelf', templateId: tpl.body.id });

        const noMatch = await api
            .post('/api/items')
            .send({ collectionId: shelf.body.id, name: 'X' });
        expect(noMatch.status).toBe(400);
        expect(noMatch.body.error).toContain('catalog');

        const unknownEntry = await api
            .post('/api/items')
            .send({ collectionId: shelf.body.id, name: 'X', supersetEntry: 'DEADBEEF' });
        expect(unknownEntry.status).toBe(400);

        const good = await api.post('/api/items').send({
            collectionId: shelf.body.id,
            name: 'Chrono Trigger',
            supersetEntry: '2D206BF7',
        });
        expect(good.status).toBe(201);
        expect(good.body.superset).toBe('snes');
        expect(good.body.supersetLabel).toBe('Chrono Trigger (USA)');
    });

    it('rejects catalog entries on plain templates', async () => {
        const tpl = await api.post('/api/templates').send({ name: 'Plain template no superset' });
        const plain = await api
            .post('/api/collections')
            .send({ name: 'Plain shelf', templateId: tpl.body.id });
        const res = await api
            .post('/api/items')
            .send({ collectionId: plain.body.id, name: 'X', supersetEntry: '2D206BF7' });
        expect(res.status).toBe(400);
    });

    it('marks supersets complete or not, and gates items accordingly', async () => {
        const list = await api.get('/api/supersets');
        const snes = list.body.find((s: { key: string }) => s.key === 'snes');
        const pc = list.body.find((s: { key: string }) => s.key === 'pc');
        expect(snes.complete).toBe(true);
        expect(pc.complete).toBe(false);

        // Complete catalogs refuse outsideSuperset outright
        const snesTpl = await api
            .post('/api/templates')
            .send({ name: 'SNES strict', superset: 'snes', fields: [] });
        const snesShelf = await api
            .post('/api/collections')
            .send({ name: 'SNES strict shelf', templateId: snesTpl.body.id });
        const sneaky = await api.post('/api/items').send({
            collectionId: snesShelf.body.id,
            name: 'X',
            outsideSuperset: true,
        });
        expect(sneaky.status).toBe(400);
        expect(sneaky.body.error).toContain('exhaustive');

        // Incomplete catalogs require an explicit outsideSuperset flag
        const pcTpl = await api
            .post('/api/templates')
            .send({ name: 'PC games', superset: 'pc', fields: [] });
        const pcShelf = await api
            .post('/api/collections')
            .send({ name: 'PC shelf', templateId: pcTpl.body.id });

        const missingFlag = await api.post('/api/items').send({
            collectionId: pcShelf.body.id,
            name: 'Totally Unknown Indie',
        });
        expect(missingFlag.status).toBe(400);
        expect(missingFlag.body.error).toContain('not exhaustive');

        const both = await api.post('/api/items').send({
            collectionId: pcShelf.body.id,
            name: 'Confused',
            supersetEntry: 'Q42',
            outsideSuperset: true,
        });
        expect(both.status).toBe(400);

        const outside = await api.post('/api/items').send({
            collectionId: pcShelf.body.id,
            name: 'Totally Unknown Indie',
            outsideSuperset: true,
        });
        expect(outside.status).toBe(201);
        expect(outside.body.superset).toBe('pc');
        expect(outside.body.supersetEntry).toBeNull();

        // A matched PC item works too
        const matched = await api.post('/api/items').send({
            collectionId: pcShelf.body.id,
            name: 'The Ultimate Doom',
            supersetEntry: 'Q1319860',
        });
        expect(matched.status).toBe(201);
        expect(matched.body.supersetLabel).toBe('The Ultimate Doom');

        // Moving a matched item outside requires the flag; unmatching outright does not fly
        const unmatch = await api.patch(`/api/items/${matched.body.id}`).send({
            supersetEntry: null,
        });
        expect(unmatch.status).toBe(400);
        const moveOut = await api.patch(`/api/items/${matched.body.id}`).send({
            supersetEntry: null,
            outsideSuperset: true,
        });
        expect(moveOut.status).toBe(200);
        expect(moveOut.body.supersetEntry).toBeNull();
    });

    it('reports catalog completion for superset collections', async () => {
        const tpl = await api
            .post('/api/templates')
            .send({ name: 'Completion template', superset: 'snes', fields: [] });
        const shelf = await api
            .post('/api/collections')
            .send({ name: 'Completion shelf', templateId: tpl.body.id });
        expect(shelf.status).toBe(201);

        // Both variants of Chrono Trigger — counts as one title owned.
        await api.post('/api/items').send({
            collectionId: shelf.body.id,
            name: 'CT',
            supersetEntry: '2D206BF7',
        });
        await api.post('/api/items').send({
            collectionId: shelf.body.id,
            name: 'CT JP',
            supersetEntry: '4D014C20',
        });

        const list = await api.get('/api/collections');
        const found = list.body.find((c: { id: string }) => c.id === shelf.body.id);
        expect(found.completion.owned).toBe(1);
        expect(found.completion.total).toBeGreaterThan(2000);
        expect(found.completion.percent).toBeLessThan(1);

        const detail = await api.get(`/api/collections/${shelf.body.id}`);
        expect(detail.body.completion.owned).toBe(1);
        expect(detail.body.completion.total).toBe(found.completion.total);

        // Plain collections report no completion
        const plain = list.body.find((c: { name: string }) => c.name === 'Vinyl');
        expect(plain.completion).toBeNull();
    });
});
