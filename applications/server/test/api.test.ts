import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import archiver from 'archiver';
import extract from 'extract-zip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database, ensureDatabase, resetDatabase } from '@antiquary/database';
import { createApp } from '../src/app.js';
import { SupersetRegistry } from '../src/supersets.js';
import { sweepOrphanedUploads } from '../src/upload.js';

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

describe('upload sweeper', () => {
    it('removes unreferenced uuid files past the TTL, keeps referenced and fresh ones', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'sweeper-'));
        const old = Date.now() / 1000 - 30 * 24 * 60 * 60;
        const referenced = '00000000-0000-0000-0000-000000000001.png';
        const orphaned = '00000000-0000-0000-0000-000000000002.png';
        const fresh = '00000000-0000-0000-0000-000000000003.png';
        const foreign = 'keep-me.txt';
        for (const name of [referenced, orphaned, fresh, foreign]) {
            await writeFile(join(dir, name), 'x');
            await utimes(join(dir, name), old, old);
        }
        // fresh orphan should survive
        await utimes(join(dir, fresh), Date.now() / 1000, Date.now() / 1000);

        const removed = await sweepOrphanedUploads(dir, [referenced]);
        expect(removed).toBe(1);
        expect(existsSync(join(dir, orphaned))).toBe(false);
        expect(existsSync(join(dir, referenced))).toBe(true);
        expect(existsSync(join(dir, fresh))).toBe(true);
        expect(existsSync(join(dir, foreign))).toBe(true);
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
            'add_wanted',
            'remove_wanted',
            'add_shop_link',
            'remove_shop_link',
        ]) {
            expect(tools).not.toContain(banned);
        }
    });

    it('full keys expose write and deletion actions', async () => {
        const tools = await toolNames(fullKey);
        expect(tools).toContain('create_item');
        expect(tools).toContain('trash_item');
        expect(tools).toContain('purge_collection');
        expect(tools).toContain('update_collection');
        expect(tools).toContain('create_template');
        expect(tools).toContain('update_template');
        expect(tools).toContain('delete_template');
        expect(tools).toContain('list_wanted');
        expect(tools).toContain('add_wanted');
        expect(tools).toContain('remove_wanted');
        expect(tools).toContain('list_shop_links');
        expect(tools).toContain('add_shop_link');
        expect(tools).toContain('remove_shop_link');
    });

    it('manages templates and template-bound collections over MCP', async () => {
        // create a template bound to a superset
        const template = await rpc(fullKey, {
            jsonrpc: '2.0',
            id: 30,
            method: 'tools/call',
            params: {
                name: 'create_template',
                arguments: {
                    name: 'MCP dos shelf',
                    superset: 'dos',
                    fields: [
                        { name: 'Notes', type: 'text' },
                        { name: 'Setup', type: 'select', options: ['DOSBox', 'Native'] },
                    ],
                },
            },
        });
        const templateResult = unwrap(template).result as {
            isError?: boolean;
            content: { text: string }[];
        };
        expect(templateResult.isError).toBeFalsy();
        const tpl = JSON.parse(templateResult.content[0]!.text) as { id: string };
        expect(tpl.id).toBeTruthy();

        // invalid superset key is rejected
        const bogusSuperset = await rpc(fullKey, {
            jsonrpc: '2.0',
            id: 31,
            method: 'tools/call',
            params: {
                name: 'create_template',
                arguments: { name: 'Bogus', superset: 'nonsense' },
            },
        });
        const bogusResult = unwrap(bogusSuperset).result as {
            isError?: boolean;
            content: { text: string }[];
        };
        expect(bogusResult.isError).toBe(true);
        expect(bogusResult.content[0]!.text).toContain('Unknown superset');

        // create a collection bound to the template directly
        const collection = await rpc(fullKey, {
            jsonrpc: '2.0',
            id: 32,
            method: 'tools/call',
            params: {
                name: 'create_collection',
                arguments: { name: 'MCP dos games', templateId: tpl.id },
            },
        });
        const collectionResult = unwrap(collection).result as { content: { text: string }[] };
        const col = JSON.parse(collectionResult.content[0]!.text) as {
            id: string;
            templateId: string;
        };
        expect(col.templateId).toBe(tpl.id);

        // items in the bound collection must match the catalog
        const matched = await rpc(fullKey, {
            jsonrpc: '2.0',
            id: 33,
            method: 'tools/call',
            params: {
                name: 'create_item',
                arguments: { collectionId: col.id, name: 'Silverball', supersetEntry: 'Q16267078' },
            },
        });
        const matchedResult = unwrap(matched).result as {
            isError?: boolean;
            content: { text: string }[];
        };
        expect(matchedResult.isError).toBeFalsy();
        const item = JSON.parse(matchedResult.content[0]!.text) as { superset: string };
        expect(item.superset).toBe('dos');

        // update_collection can rebind to another template
        const pcTemplate = await rpc(fullKey, {
            jsonrpc: '2.0',
            id: 34,
            method: 'tools/call',
            params: {
                name: 'create_template',
                arguments: { name: 'MCP pc shelf', superset: 'pc' },
            },
        });
        const pcTemplateResult = unwrap(pcTemplate).result as { content: { text: string }[] };
        const pcTpl = JSON.parse(pcTemplateResult.content[0]!.text) as { id: string };

        const rebound = await rpc(fullKey, {
            jsonrpc: '2.0',
            id: 35,
            method: 'tools/call',
            params: {
                name: 'update_collection',
                arguments: { id: col.id, templateId: pcTpl.id },
            },
        });
        const reboundResult = unwrap(rebound).result as { content: { text: string }[] };
        const reboundCol = JSON.parse(reboundResult.content[0]!.text) as { templateId: string };
        expect(reboundCol.templateId).toBe(pcTpl.id);

        // delete_template refuses while a collection uses it
        const inUse = await rpc(fullKey, {
            jsonrpc: '2.0',
            id: 36,
            method: 'tools/call',
            params: { name: 'delete_template', arguments: { id: pcTpl.id } },
        });
        const inUseResult = unwrap(inUse).result as {
            isError?: boolean;
            content: { text: string }[];
        };
        expect(inUseResult.isError).toBe(true);
        expect(inUseResult.content[0]!.text).toContain('used by');

        // cleanup: unbind, delete unused templates, trash collection
        await rpc(fullKey, {
            jsonrpc: '2.0',
            id: 37,
            method: 'tools/call',
            params: { name: 'update_collection', arguments: { id: col.id, templateId: null } },
        });
        const tplDelete = await rpc(fullKey, {
            jsonrpc: '2.0',
            id: 38,
            method: 'tools/call',
            params: { name: 'delete_template', arguments: { id: pcTpl.id } },
        });
        expect((unwrap(tplDelete).result as { isError?: boolean }).isError).toBeFalsy();
        await rpc(fullKey, {
            jsonrpc: '2.0',
            id: 39,
            method: 'tools/call',
            params: { name: 'delete_template', arguments: { id: tpl.id } },
        });
        await rpc(fullKey, {
            jsonrpc: '2.0',
            id: 40,
            method: 'tools/call',
            params: { name: 'trash_collection', arguments: { id: col.id } },
        });
        const listed = await api.get('/api/collections');
        expect(listed.body.some((c: { id: string }) => c.id === col.id)).toBe(false);
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

    it('manages the wanted list over MCP', async () => {
        const call = async (key: string, id: number, name: string, arguments_: unknown) => {
            const res = await rpc(key, {
                jsonrpc: '2.0',
                id,
                method: 'tools/call',
                params: { name, arguments: arguments_ },
            });
            return unwrap(res).result as { isError?: boolean; content: { text: string }[] };
        };

        // read-only keys can list the wanted list
        const listed = await call(readOnlyKey, 21, 'list_wanted', {});
        expect(listed.isError).toBeFalsy();
        expect(Array.isArray(JSON.parse(listed.content[0]!.text))).toBe(true);

        const added = await call(fullKey, 22, 'add_wanted', {
            superset: 'gb',
            entryId: 'AF6BDC50',
        });
        expect(added.isError).toBeFalsy();
        const addedRow = JSON.parse(added.content[0]!.text) as {
            superset: string;
            supersetName: string;
            entry: { name: string };
        };
        expect(addedRow.superset).toBe('gb');
        expect(addedRow.supersetName).toContain('Game Boy');
        expect(addedRow.entry.name).toContain('Aladdin');

        const duplicate = await call(fullKey, 23, 'add_wanted', {
            superset: 'gb',
            entryId: 'AF6BDC50',
        });
        expect(duplicate.isError).toBe(true);
        expect(duplicate.content[0]!.text).toContain('already');

        const bogusCatalog = await call(fullKey, 24, 'add_wanted', {
            superset: 'nonsense',
            entryId: 'X',
        });
        expect(bogusCatalog.isError).toBe(true);
        expect(bogusCatalog.content[0]!.text).toContain('Unknown catalog');

        const bogusEntry = await call(fullKey, 25, 'add_wanted', {
            superset: 'gb',
            entryId: 'DEADBEEF',
        });
        expect(bogusEntry.isError).toBe(true);
        expect(bogusEntry.content[0]!.text).toContain('Unknown catalog entry');

        const removed = await call(fullKey, 26, 'remove_wanted', {
            superset: 'gb',
            entryId: 'AF6BDC50',
        });
        expect(removed.isError).toBeFalsy();
        expect(JSON.parse(removed.content[0]!.text).ok).toBe(true);

        const removeAgain = await call(fullKey, 27, 'remove_wanted', {
            superset: 'gb',
            entryId: 'AF6BDC50',
        });
        expect(removeAgain.isError).toBeFalsy();
        expect(JSON.parse(removeAgain.content[0]!.text).error).toContain('not on the wanted list');
    });

    it('manages shop links over MCP', async () => {
        const call = async (key: string, id: number, name: string, arguments_: unknown) => {
            const res = await rpc(key, {
                jsonrpc: '2.0',
                id,
                method: 'tools/call',
                params: { name, arguments: arguments_ },
            });
            return unwrap(res).result as { isError?: boolean; content: { text: string }[] };
        };

        const added = await call(fullKey, 30, 'add_shop_link', {
            superset: 'snes',
            entryId: 'AA0E31DE',
            title: 'eStarland',
            url: 'https://www.estarland.com/f-zero',
            price: 44.99,
            currency: 'USD',
        });
        expect(added.isError).toBeFalsy();
        const link = JSON.parse(added.content[0]!.text) as {
            id: string;
            price: number;
            currency: string;
        };
        expect(link.id).toBeTruthy();
        expect(link.price).toBe(44.99);
        expect(link.currency).toBe('USD');

        const unpriced = await call(fullKey, 31, 'add_shop_link', {
            superset: 'snes',
            entryId: 'AA0E31DE',
            title: 'Local shop',
            url: 'https://retro.example/f-zero',
        });
        expect(unpriced.isError).toBeFalsy();
        const unpricedLink = JSON.parse(unpriced.content[0]!.text) as { id: string; price: null };
        expect(unpricedLink.price).toBeNull();

        const mismatched = await call(fullKey, 32, 'add_shop_link', {
            superset: 'snes',
            entryId: 'AA0E31DE',
            title: 'Broken',
            url: 'https://retro.example/x',
            price: 10,
        });
        expect(mismatched.isError).toBe(true);
        expect(mismatched.content[0]!.text).toContain('together');

        const bogusCatalog = await call(fullKey, 33, 'add_shop_link', {
            superset: 'nonsense',
            entryId: 'X',
            title: 'Broken',
            url: 'https://retro.example/x',
        });
        expect(bogusCatalog.isError).toBe(true);
        expect(bogusCatalog.content[0]!.text).toContain('Unknown catalog');

        const bogusEntry = await call(fullKey, 34, 'add_shop_link', {
            superset: 'snes',
            entryId: 'DEADBEEF',
            title: 'Broken',
            url: 'https://retro.example/x',
        });
        expect(bogusEntry.isError).toBe(true);
        expect(bogusEntry.content[0]!.text).toContain('Unknown catalog entry');

        // read-only keys can list, filtered by catalog and entry
        const listed = await call(readOnlyKey, 35, 'list_shop_links', {
            superset: 'snes',
            entryId: 'AA0E31DE',
        });
        const links = JSON.parse(listed.content[0]!.text) as { id: string; title: string }[];
        expect(links).toHaveLength(2);

        const removed = await call(fullKey, 36, 'remove_shop_link', { id: link.id });
        expect(removed.isError).toBeFalsy();
        expect(JSON.parse(removed.content[0]!.text).ok).toBe(true);

        const removeAgain = await call(fullKey, 37, 'remove_shop_link', { id: link.id });
        expect(JSON.parse(removeAgain.content[0]!.text).error).toContain('Shop link not found');

        // leave nothing behind for the REST suite
        const cleanup = await call(fullKey, 38, 'remove_shop_link', { id: unpricedLink.id });
        expect(cleanup.isError).toBeFalsy();
        const remaining = await call(readOnlyKey, 39, 'list_shop_links', {
            superset: 'snes',
            entryId: 'AA0E31DE',
        });
        expect(JSON.parse(remaining.content[0]!.text)).toHaveLength(0);
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
        const marioItem = JSON.parse(matchedResult.content[0]!.text) as {
            superset: string;
            fields: { name: string; value: unknown }[];
        };
        expect(marioItem.superset).toBe('snes');
        const publisher = marioItem.fields.find((f) => f.name === 'Publisher');
        expect(publisher?.value).toBe('Square');
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
        // 0. instructions tool points agents at the HTTP upload endpoint
        const instructions = await rpc(readOnlyKey, {
            jsonrpc: '2.0',
            id: 18,
            method: 'tools/call',
            params: { name: 'get_image_upload_instructions', arguments: {} },
        });
        const instructionsResult = unwrap(instructions).result as { content: { text: string }[] };
        const guide = JSON.parse(instructionsResult.content[0]!.text) as {
            upload: { path: string; fileField: string };
        };
        expect(guide.upload.path).toBe('/api/images');
        expect(guide.upload.fileField).toBe('image');

        // 0b. HTTP multipart upload → attach on create_item
        const uploaded = await api.post(guide.upload.path).attach(guide.upload.fileField, PNG_1x1, {
            filename: 'http-cover.png',
            contentType: 'image/png',
        });
        expect(uploaded.status).toBe(201);
        const httpFilename = uploaded.body.filename as string;

        const httpAttached = await rpc(fullKey, {
            jsonrpc: '2.0',
            id: 19,
            method: 'tools/call',
            params: {
                name: 'create_item',
                arguments: {
                    collectionId,
                    name: 'MCP http photo item',
                    images: [{ filename: httpFilename, caption: 'http cover' }],
                },
            },
        });
        const httpAttachedResult = unwrap(httpAttached).result as {
            isError?: boolean;
            content: { text: string }[];
        };
        expect(httpAttachedResult.isError).toBeFalsy();
        const httpItem = JSON.parse(httpAttachedResult.content[0]!.text) as {
            id: string;
            images: { filename: string; caption: string | null }[];
        };
        expect(httpItem.images[0]!.filename).toBe(httpFilename);
        expect(httpItem.images[0]!.caption).toBe('http cover');

        // re-attaching an already-attached file is rejected
        const reuse = await rpc(fullKey, {
            jsonrpc: '2.0',
            id: 20,
            method: 'tools/call',
            params: {
                name: 'update_item',
                arguments: { id: httpItem.id, images: [{ filename: httpFilename }] },
            },
        });
        const reuseResult = unwrap(reuse).result as {
            isError?: boolean;
            content: { text: string }[];
        };
        expect(reuseResult.isError).toBe(true);
        expect(reuseResult.content[0]!.text).toContain('already attached');

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
        expect(bogusResult.content[0]!.text).toContain('Unknown image');
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

    it('browses catalog entries paginated, searchable and ordered', async () => {
        const list = await api.get('/api/supersets');
        const snes = list.body.find((s: { key: string }) => s.key === 'snes');

        const res = await api.get('/api/supersets/snes/entries?limit=5&page=2');
        expect(res.status).toBe(200);
        expect(res.body.entries).toHaveLength(5);
        expect(res.body.page).toBe(2);
        expect(res.body.limit).toBe(5);
        expect(res.body.total).toBe(snes.variantCount);
        const titles = res.body.entries.map((e: { parentTitle: string }) => e.parentTitle);
        expect(titles).toEqual([...titles].sort((a: string, b: string) => a.localeCompare(b)));

        const search = await api.get('/api/supersets/snes/entries?q=chrono+trigger');
        expect(search.status).toBe(200);
        expect(search.body.total).toBeGreaterThanOrEqual(2);
        expect(search.body.entries.map((e: { id: string }) => e.id)).toContain('2D206BF7');
        expect(search.body.total).toBeLessThan(res.body.total);

        expect((await api.get('/api/supersets/nope/entries')).status).toBe(404);
        expect((await api.get('/api/supersets/snes/entries?ownership=bogus')).status).toBe(400);
    });

    it('flags owned entries across collections and filters by ownership', async () => {
        // Earlier tests matched Chrono Trigger (USA) in another collection —
        // ownership spans every collection.
        const before = await api.get('/api/supersets/snes/entries?q=chrono+trigger');
        expect(before.body.entries.find((e: { id: string }) => e.id === '2D206BF7').owned).toBe(
            true,
        );

        const tpl = await api
            .post('/api/templates')
            .send({ name: 'Browse template', superset: 'snes', fields: [] });
        const shelf = await api
            .post('/api/collections')
            .send({ name: 'Browse shelf', templateId: tpl.body.id });
        const target = before.body.entries.find((e: { owned: boolean }) => !e.owned);
        expect(target).toBeDefined();
        const created = await api.post('/api/items').send({
            collectionId: shelf.body.id,
            name: target.parentTitle,
            supersetEntry: target.id,
        });
        expect(created.status).toBe(201);

        const all = await api.get('/api/supersets/snes/entries?q=chrono+trigger');
        const match = all.body.entries.find((e: { id: string }) => e.id === target.id);
        expect(match.owned).toBe(true);
        expect(match.itemId).toBe(created.body.id);

        const owned = await api.get('/api/supersets/snes/entries?ownership=owned&q=chrono+trigger');
        expect(owned.body.entries.every((e: { owned: boolean }) => e.owned)).toBe(true);
        expect(owned.body.entries.map((e: { id: string }) => e.id)).toContain(target.id);

        const missing = await api.get(
            '/api/supersets/snes/entries?ownership=missing&q=chrono+trigger',
        );
        expect(missing.body.entries.every((e: { owned: boolean }) => !e.owned)).toBe(true);
        expect(missing.body.entries.map((e: { id: string }) => e.id)).not.toContain(target.id);
        expect(owned.body.total + missing.body.total).toBe(all.body.total);
    });

    it('enriches entries and search results with compiled rarity', async () => {
        // Aladdin (USA) on Game Boy ships a compiled rarity file
        const entry = await api.get('/api/supersets/gb/entries/AF6BDC50');
        expect(entry.status).toBe(200);
        expect(entry.body.rarity).toEqual({
            rarity: 5,
            rarityLabel: 'Sought After',
            rarityPercent: 44,
        });

        const search = await api.get('/api/supersets/gb/search?q=aladdin');
        expect(search.status).toBe(200);
        const title = search.body.results.find((r: { title: string }) =>
            r.title.startsWith('Aladdin'),
        );
        expect(title).toBeDefined();
        expect(title.variants.every((v: { rarity?: unknown }) => v.rarity !== undefined)).toBe(
            true,
        );

        // supersets with a rarity file return it on plain entries too
        const rated = await api.get('/api/supersets/snes/entries/2D206BF7');
        expect(rated.body.rarity).toEqual({
            rarity: 8,
            rarityLabel: 'Extremely Collectible',
            rarityPercent: 76,
        });

        // supersets without a rarity file keep entries plain
        const plain = await api.get('/api/supersets/fds/entries/DCC7A8D6');
        expect(plain.status).toBe(200);
        expect(plain.body.rarity).toBeUndefined();
    });

    it('validates the search query and catalog key', async () => {
        expect((await api.get('/api/supersets/snes/search')).status).toBe(400);
        expect((await api.get('/api/supersets/nope/search?q=x')).status).toBe(404);
    });

    it('exposes compiled rarity on matched item details', async () => {
        const tpl = await api.post('/api/templates').send({
            name: 'GB template',
            superset: 'gb',
            fields: [{ name: 'Condition', type: 'text' }],
        });
        const shelf = await api
            .post('/api/collections')
            .send({ name: 'GB shelf', templateId: tpl.body.id });
        const created = await api.post('/api/items').send({
            collectionId: shelf.body.id,
            name: 'Aladdin',
            supersetEntry: 'AF6BDC50',
        });
        expect(created.status).toBe(201);

        const detail = await api.get(`/api/items/${created.body.id}`);
        expect(detail.status).toBe(200);
        expect(detail.body.supersetRarity).toEqual({
            rarity: 5,
            rarityLabel: 'Sought After',
            rarityPercent: 44,
        });

        // list results carry rarity for the item grid
        const listed = await api.get(`/api/items?collectionId=${shelf.body.id}`);
        expect(listed.status).toBe(200);
        const listedItem = listed.body.items.find((i: { id: string }) => i.id === created.body.id);
        expect(listedItem.supersetRarity).toEqual({
            rarity: 5,
            rarityLabel: 'Sought After',
            rarityPercent: 44,
        });

        // a rarer sibling drives the minRarity filter and the rare stats
        const rare = await api.post('/api/items').send({
            collectionId: shelf.body.id,
            name: 'The Blues Brothers',
            supersetEntry: 'ADB66EFF',
        });
        expect(rare.status).toBe(201);

        const filtered = await api.get(`/api/items?collectionId=${shelf.body.id}&minRarity=7`);
        expect(filtered.status).toBe(200);
        expect(filtered.body.total).toBe(1);
        expect(filtered.body.items[0].id).toBe(rare.body.id);
        expect(filtered.body.items[0].supersetRarity.rarity).toBe(9);

        const none = await api.get(`/api/items?collectionId=${shelf.body.id}&minRarity=10`);
        expect(none.body.total).toBe(0);
        expect(none.body.items).toEqual([]);

        const stats = await api.get('/api/stats');
        expect(stats.status).toBe(200);
        expect(stats.body.rareItemCount).toBeGreaterThanOrEqual(1);
        const rareRecent = stats.body.recentItems.find(
            (i: { id: string }) => i.id === rare.body.id,
        );
        expect(rareRecent.supersetRarity.rarity).toBe(9);
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
        expect(good.body.fields.find((f) => f.name === 'Region')?.value).toBe('USA');
        expect(good.body.fields.find((f) => f.name === 'Serial')?.value).toBe('SNS-ACTE-USA');
        expect(good.body.fields.find((f) => f.name === 'Year')?.value).toBe(1995);
    });

    it('prefills catalog details server-side, caller values win', async () => {
        const tpl = await api.post('/api/templates').send({
            name: 'Prefill template',
            superset: 'snes',
            fields: [{ name: 'Notes', type: 'text' }],
        });
        const shelf = await api
            .post('/api/collections')
            .send({ name: 'Prefill shelf', templateId: tpl.body.id });
        const genreField = tpl.body.fields.find((f: { name: string }) => f.name === 'Genre');

        const created = await api.post('/api/items').send({
            collectionId: shelf.body.id,
            name: 'MARIO',
            supersetEntry: '2D206BF7',
            fieldValues: [{ fieldId: genreField.id, value: 'Time travel' }],
        });
        expect(created.status).toBe(201);
        const byName = new Map(
            created.body.fields.map((f: { name: string; value: unknown }) => [f.name, f.value]),
        );
        expect(byName.get('Publisher')).toBe('Square');
        expect(byName.get('Developer')).toBe('Square');
        expect(byName.get('Serial')).toBe('SNS-ACTE-USA');
        expect(byName.get('Genre')).toBe('Time travel');
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

describe('wanted', () => {
    it('validates the body', async () => {
        expect((await api.post('/api/wanted').send({ superset: '' })).status).toBe(400);
    });

    it('rejects unknown catalogs and entries', async () => {
        const bogusCatalog = await api
            .post('/api/wanted')
            .send({ superset: 'nope', supersetEntry: 'X' });
        expect(bogusCatalog.status).toBe(404);
        expect(bogusCatalog.body.error).toContain('Catalog not found');

        const bogusEntry = await api
            .post('/api/wanted')
            .send({ superset: 'snes', supersetEntry: 'DEADBEEF' });
        expect(bogusEntry.status).toBe(404);
        expect(bogusEntry.body.error).toContain('entry');
    });

    it('adds, lists and removes entries with catalog enrichment', async () => {
        // F-Zero (USA) is not owned anywhere; Chrono Trigger (USA) is owned by an earlier test
        const missing = await api
            .post('/api/wanted')
            .send({ superset: 'snes', supersetEntry: 'AA0E31DE' });
        expect(missing.status).toBe(201);
        expect(missing.body.superset).toBe('snes');
        expect(missing.body.supersetName).toBe('Super Nintendo Entertainment System');
        expect(missing.body.entry.name).toBe('F-Zero (USA)');
        expect(missing.body.owned).toBe(false);
        expect(missing.body.ownedItemId).toBeNull();

        const owned = await api
            .post('/api/wanted')
            .send({ superset: 'snes', supersetEntry: '2D206BF7' });
        expect(owned.status).toBe(201);
        expect(owned.body.owned).toBe(true);
        expect(owned.body.ownedItemId).toBeTruthy();

        const duplicate = await api
            .post('/api/wanted')
            .send({ superset: 'snes', supersetEntry: '2D206BF7' });
        expect(duplicate.status).toBe(409);

        const list = await api.get('/api/wanted');
        expect(list.body).toHaveLength(2);
        // newest first
        expect(list.body[0].supersetEntry).toBe('2D206BF7');

        // catalog browsing flags wanted entries
        const entries = await api.get('/api/supersets/snes/entries?q=chrono+trigger');
        expect(entries.status).toBe(200);
        const byId = new Map(
            entries.body.entries.map((e: { id: string; wanted: boolean }) => [e.id, e.wanted]),
        );
        expect(byId.get('2D206BF7')).toBe(true);
        expect(byId.get('4D014C20')).toBe(false);

        const removed = await api.delete('/api/wanted/snes/entries/AA0E31DE');
        expect(removed.status).toBe(200);
        expect(removed.body).toEqual({ ok: true });
        expect((await api.get('/api/wanted')).body).toHaveLength(1);

        const removeAgain = await api.delete('/api/wanted/snes/entries/AA0E31DE');
        expect(removeAgain.status).toBe(404);
    });
});

describe('shop links', () => {
    it('validates the body', async () => {
        const badUrl = await api.post('/api/shop-links').send({
            superset: 'snes',
            supersetEntry: 'AA0E31DE',
            title: 'X',
            url: 'not a url',
        });
        expect(badUrl.status).toBe(400);

        const priceOnly = await api.post('/api/shop-links').send({
            superset: 'snes',
            supersetEntry: 'AA0E31DE',
            title: 'X',
            url: 'https://retro.example/x',
            price: 10,
        });
        expect(priceOnly.status).toBe(400);
        expect(priceOnly.body.error).toContain('together');

        const badCurrency = await api.post('/api/shop-links').send({
            superset: 'snes',
            supersetEntry: 'AA0E31DE',
            title: 'X',
            url: 'https://retro.example/x',
            price: 10,
            currency: 'dollars',
        });
        expect(badCurrency.status).toBe(400);
    });

    it('rejects unknown catalogs and entries', async () => {
        const bogusCatalog = await api
            .post('/api/shop-links')
            .send({ superset: 'nope', supersetEntry: 'X', title: 'X', url: 'https://x.example' });
        expect(bogusCatalog.status).toBe(404);
        expect((await api.get('/api/shop-links?superset=nope')).status).toBe(404);

        const bogusEntry = await api.post('/api/shop-links').send({
            superset: 'snes',
            supersetEntry: 'DEADBEEF',
            title: 'X',
            url: 'https://x.example',
        });
        expect(bogusEntry.status).toBe(404);
        expect(bogusEntry.body.error).toContain('entry');
    });

    it('adds, lists and deletes listings for catalog entries', async () => {
        const priced = await api.post('/api/shop-links').send({
            superset: 'snes',
            supersetEntry: 'AA0E31DE',
            title: 'eStarland',
            url: 'https://www.estarland.com/f-zero',
            price: 44.99,
            currency: 'usd',
        });
        expect(priced.status).toBe(201);
        expect(priced.body.price).toBe(44.99);
        expect(priced.body.currency).toBe('USD');

        const unpriced = await api.post('/api/shop-links').send({
            superset: 'snes',
            supersetEntry: 'AA0E31DE',
            title: 'Local shop',
            url: 'https://retro.example/f-zero',
        });
        expect(unpriced.status).toBe(201);
        expect(unpriced.body.price).toBeNull();
        expect(unpriced.body.currency).toBeNull();

        const list = await api.get('/api/shop-links?superset=snes&supersetEntry=AA0E31DE');
        expect(list.body).toHaveLength(2);
        const all = await api.get('/api/shop-links');
        expect(all.body.length).toBeGreaterThanOrEqual(2);

        // links surface on the catalog entry views
        const entries = await api.get('/api/supersets/snes/entries?q=f-zero');
        expect(entries.status).toBe(200);
        const entry = entries.body.entries.find((e: { id: string }) => e.id === 'AA0E31DE');
        expect(entry.shopLinks).toHaveLength(2);
        expect(entry.shopLinks.map((l: { title: string }) => l.title)).toContain('eStarland');

        const single = await api.get('/api/supersets/snes/entries/AA0E31DE');
        expect(single.status).toBe(200);
        expect(single.body.shopLinks).toHaveLength(2);

        const removed = await api.delete(`/api/shop-links/${priced.body.id}`);
        expect(removed.status).toBe(200);
        expect(
            (await api.get('/api/shop-links?superset=snes&supersetEntry=AA0E31DE')).body,
        ).toHaveLength(1);

        const removeAgain = await api.delete(`/api/shop-links/${priced.body.id}`);
        expect(removeAgain.status).toBe(404);
    });
});

describe('transfer', () => {
    function zipBuffer(files: Record<string, string | Buffer>): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            const archive = archiver('zip');
            const chunks: Buffer[] = [];
            archive.on('data', (chunk: Buffer) => chunks.push(chunk));
            archive.on('error', reject);
            archive.on('end', () => resolve(Buffer.concat(chunks)));
            for (const [name, content] of Object.entries(files)) {
                archive.append(content, { name });
            }
            void archive.finalize();
        });
    }

    const importedCollectionId = '9f1c3a5e-1111-4111-8111-9f1c3a5e0001';
    const importedItemId = '9f1c3a5e-1111-4111-8111-9f1c3a5e0002';
    const importedImageId = '9f1c3a5e-1111-4111-8111-9f1c3a5e0003';
    const importedImageFilename = 'b0000000-0000-4000-8000-00000000000b.png';

    function importArchive(): Promise<Buffer> {
        return zipBuffer({
            'manifest.json': JSON.stringify({
                format: 'antiquary-export',
                version: 1,
                exportedAt: '2026-11-16T00:00:00.000Z',
            }),
            'collections.ndjson': `${JSON.stringify({
                id: importedCollectionId,
                name: 'Imported Shelf',
                emoji: '📦',
                mystery: 'ignored field',
                createdAt: '2026-01-01T00:00:00.000Z',
            })}\n`,
            'items.ndjson': `${JSON.stringify({
                id: importedItemId,
                collectionId: importedCollectionId,
                name: 'Imported Gadget',
                quantity: 3,
                isFavorite: true,
                notes: 'from archive',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-02T00:00:00.000Z',
            })}\n`,
            'images.ndjson': `${JSON.stringify({
                id: importedImageId,
                itemId: importedItemId,
                filename: importedImageFilename,
                mime: 'image/png',
                size: PNG_1x1.length,
                isCover: true,
                position: 0,
                createdAt: '2026-01-01T00:00:00.000Z',
            })}\n`,
            [`images/${importedImageFilename}`]: PNG_1x1,
            'wanted.ndjson': `${JSON.stringify({
                id: '9f1c3a5e-1111-4111-8111-9f1c3a5e0004',
                superset: 'snes',
                supersetEntry: '4D014C20',
                createdAt: '2026-01-01T00:00:00.000Z',
            })}\n`,
            'shopLinks.ndjson': `${JSON.stringify({
                id: '9f1c3a5e-1111-4111-8111-9f1c3a5e0005',
                superset: 'snes',
                supersetEntry: '4D014C20',
                title: 'Play Asia',
                url: 'https://www.play-asia.com/chrono-trigger',
                price: '129.99',
                currency: 'EUR',
                createdAt: '2026-01-01T00:00:00.000Z',
            })}\n`,
            'gizmos.ndjson': '{"id":"nope"}\n',
            'readme.txt': 'stray file',
        });
    }

    it('exports a zip with manifest, datasets and images', async () => {
        const res = await api
            .get('/api/transfer/export')
            .buffer(true)
            .parse((res: IncomingMessage, cb: (err: Error | null, body: unknown) => void) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => cb(null, Buffer.concat(chunks)));
            });
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('application/zip');
        expect(res.headers['content-disposition']).toMatch(/antiquary-export-.*\.zip/);
        expect(res.body.subarray(0, 2).toString()).toBe('PK');

        const dir = await mkdtemp(join(tmpdir(), 'collector-export-'));
        const zipPath = join(dir, 'export.zip');
        await writeFile(zipPath, res.body as Buffer);
        await extract(zipPath, { dir: join(dir, 'unzipped') });

        const manifest = JSON.parse(await readFile(join(dir, 'unzipped', 'manifest.json'), 'utf8'));
        expect(manifest.format).toBe('antiquary-export');
        expect(manifest.counts.collections).toBeGreaterThanOrEqual(1);
        expect(manifest.counts.wanted).toBeGreaterThanOrEqual(1);

        const collections = await readFile(join(dir, 'unzipped', 'collections.ndjson'), 'utf8');
        expect(collections).toContain(collectionId);
        const items = await readFile(join(dir, 'unzipped', 'items.ndjson'), 'utf8');
        expect(items).toContain('"name":"Chrono Trigger"');
        const wanted = await readFile(join(dir, 'unzipped', 'wanted.ndjson'), 'utf8');
        expect(wanted).toContain('2D206BF7');
        const shopLinks = await readFile(join(dir, 'unzipped', 'shopLinks.ndjson'), 'utf8');
        expect(shopLinks).toContain('AA0E31DE');
        const exportedImages = await readdir(join(dir, 'unzipped', 'images'));
        expect(exportedImages.length).toBeGreaterThan(0);
        await rm(dir, { recursive: true, force: true });
    });

    it('imports archives idempotently and ignores unknown content', async () => {
        const before = await api.get('/api/collections');
        const countBefore = before.body.length;

        const first = await api
            .post('/api/transfer/import')
            .attach('file', await importArchive(), 'import.zip');
        expect(first.status).toBe(200);
        expect(first.body).toMatchObject({
            collections: 1,
            items: 1,
            images: 1,
            wanted: 1,
            shopLinks: 1,
        });

        const after = await api.get('/api/collections');
        expect(after.body).toHaveLength(countBefore + 1);

        const detail = await api.get(`/api/items/${importedItemId}`);
        expect(detail.status).toBe(200);
        expect(detail.body.name).toBe('Imported Gadget');
        expect(detail.body.quantity).toBe(3);
        expect(detail.body.isFavorite).toBe(true);

        const image = await api.get(`/uploads/${importedImageFilename}`);
        expect(image.status).toBe(200);

        const second = await api
            .post('/api/transfer/import')
            .attach('file', await importArchive(), 'import.zip');
        expect(second.status).toBe(200);
        expect(second.body).toMatchObject(first.body);

        const unchanged = await api.get('/api/collections');
        expect(unchanged.body).toHaveLength(countBefore + 1);
        const stillOne = await api.get(`/api/items?collectionId=${importedCollectionId}`);
        expect(stillOne.body.total).toBe(1);
        const stillOneWanted = await api.get('/api/wanted');
        expect(
            stillOneWanted.body.filter((w: { superset: string }) => w.superset === 'snes'),
        ).toHaveLength(2);

        // patch semantics: a row mentioning only the name leaves other fields alone
        const renamed = await zipBuffer({
            'manifest.json': JSON.stringify({ format: 'antiquary-export', version: 1 }),
            'items.ndjson': `${JSON.stringify({ id: importedItemId, name: 'Renamed Gadget' })}\n`,
        });
        const third = await api.post('/api/transfer/import').attach('file', renamed, 'import.zip');
        expect(third.status).toBe(200);
        const patched = await api.get(`/api/items/${importedItemId}`);
        expect(patched.body.name).toBe('Renamed Gadget');
        expect(patched.body.quantity).toBe(3);
        expect(patched.body.notes).toBe('from archive');
    });

    it('rejects archives containing symlinks', async () => {
        const evil = await new Promise<Buffer>((resolve, reject) => {
            const archive = archiver('zip');
            const chunks: Buffer[] = [];
            archive.on('data', (chunk: Buffer) => chunks.push(chunk));
            archive.on('error', reject);
            archive.on('end', () => resolve(Buffer.concat(chunks)));
            archive.append(JSON.stringify({ format: 'antiquary-export', version: 1 }), {
                name: 'manifest.json',
            });
            archive.append(
                `${JSON.stringify({ id: importedCollectionId, name: 'Symlink Shelf' })}\n`,
                { name: 'collections.ndjson' },
            );
            archive.symlink('images/evil', '/etc/passwd');
            void archive.finalize();
        });

        const res = await api.post('/api/transfer/import').attach('file', evil, 'import.zip');
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/symlink/i);

        const collections = await api.get('/api/collections');
        expect(
            collections.body.find((c: { name: string }) => c.name === 'Symlink Shelf'),
        ).toBeUndefined();
    });

    it('skips rows with dangling references instead of failing the import', async () => {
        const orphanItemId = '9f1c3a5e-1111-4111-8111-9f1c3a5e00a2';
        const goodCollectionId = '9f1c3a5e-1111-4111-8111-9f1c3a5e00b1';
        const goodItemId = '9f1c3a5e-1111-4111-8111-9f1c3a5e00b2';
        const archive = await zipBuffer({
            'manifest.json': JSON.stringify({ format: 'antiquary-export', version: 1 }),
            'collections.ndjson':
                [
                    JSON.stringify({ id: goodCollectionId, name: 'Good Ref Shelf' }),
                    JSON.stringify({
                        id: '9f1c3a5e-1111-4111-8111-9f1c3a5e00c1',
                        name: 'Orphan Shelf',
                        parentId: '00000000-0000-4000-8000-0000000000ff',
                    }),
                ].join('\n') + '\n',
            'items.ndjson':
                [
                    // dangling collection reference — must be skipped
                    JSON.stringify({
                        id: orphanItemId,
                        collectionId: '00000000-0000-4000-8000-0000000000ee',
                        name: 'Orphan Item',
                    }),
                    JSON.stringify({
                        id: goodItemId,
                        collectionId: goodCollectionId,
                        name: 'Good Ref Item',
                    }),
                ].join('\n') + '\n',
            'images.ndjson': `${JSON.stringify({
                id: '9f1c3a5e-1111-4111-8111-9f1c3a5e00d1',
                itemId: orphanItemId,
                filename: importedImageFilename,
                mime: 'image/png',
                size: PNG_1x1.length,
            })}\n`,
            'itemHistory.ndjson': `${JSON.stringify({
                id: '9f1c3a5e-1111-4111-8111-9f1c3a5e00d2',
                itemId: '00000000-0000-4000-8000-0000000000dd',
                action: 'created',
                snapshot: { name: 'nope' },
            })}\n`,
        });

        const res = await api.post('/api/transfer/import').attach('file', archive, 'import.zip');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ collections: 2, items: 1, images: 0, itemHistory: 0 });

        const good = await api.get(`/api/items/${goodItemId}`);
        expect(good.status).toBe(200);
        const orphan = await api.get(`/api/items/${orphanItemId}`);
        expect(orphan.status).toBe(404);
        // referenced file for the skipped image row must not be copied either
        const collections = await api.get('/api/collections');
        expect(
            collections.body.find((c: { name: string }) => c.name === 'Orphan Shelf'),
        ).toBeDefined(); // row kept, dangling parent reference dropped
    });

    it('rejects archives without a manifest', async () => {
        const bogus = await zipBuffer({ 'hello.txt': 'not an archive' });
        const res = await api.post('/api/transfer/import').attach('file', bogus, 'import.zip');
        expect(res.status).toBe(400);
        expect(res.body.error).toBeDefined();
    });
});
