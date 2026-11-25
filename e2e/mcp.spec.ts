import { expect, test } from '@playwright/test';

const PNG_1x1 = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0f01f0005050201edb5ca9f0000000049454e44ae426082',
    'hex',
);

test.describe('mcp', () => {
    test('prepare_image_upload → signed PUT → attach via create_item', async ({ request }) => {
        const keyRes = await request.post('/api/settings/api-keys', {
            data: { name: 'e2e mcp', readonly: false },
        });
        expect(keyRes.status()).toBe(201);
        const { key } = (await keyRes.json()) as { key: string };

        // The streamable HTTP transport answers with an SSE frame when the
        // client accepts it — unwrap the single `data:` message into JSON.
        const rpc = async (id: number, method: string, params: Record<string, unknown>) => {
            const res = await request.post('/mcp', {
                headers: {
                    Authorization: `Bearer ${key}`,
                    Accept: 'application/json, text/event-stream',
                },
                data: { jsonrpc: '2.0', id, method, params },
            });
            expect(res.status()).toBe(200);
            const text = await res.text();
            const dataLine = text.split('\n').find((line) => line.startsWith('data: '));
            const payload = dataLine
                ? (JSON.parse(dataLine.slice(6)) as Record<string, unknown>)
                : (JSON.parse(text) as Record<string, unknown>);
            return payload.result as {
                isError?: boolean;
                content: { type: string; text?: string }[];
            };
        };

        const prepared = await rpc(1, 'tools/call', {
            name: 'prepare_image_upload',
            arguments: { mime: 'image/png' },
        });
        expect(prepared.isError).toBeFalsy();
        const guide = JSON.parse(prepared.content[0]!.text!) as {
            filename: string;
            upload: { method: string; url: string; headers: Record<string, string> };
        };
        expect(guide.upload.method).toBe('PUT');
        expect(guide.filename).toMatch(/\.png$/);
        expect(guide.upload.headers['Content-Type']).toBe('image/png');

        const put = await request.put(guide.upload.url, {
            headers: { 'Content-Type': 'image/png' },
            data: PNG_1x1,
        });
        expect(put.status()).toBe(201);
        const uploaded = (await put.json()) as { filename: string; url: string; size: number };
        expect(uploaded.filename).toBe(guide.filename);
        expect(uploaded.size).toBe(PNG_1x1.length);

        // a tampered signature is rejected
        const tampered = await request.put(
            guide.upload.url.replace(/signature=[0-9a-f]+/, `signature=${'0'.repeat(64)}`),
            { headers: { 'Content-Type': 'image/png' }, data: PNG_1x1 },
        );
        expect(tampered.status()).toBe(403);

        // an unsigned PUT is rejected
        const bare = await request.put(`/api/images/upload/${guide.filename}`, {
            headers: { 'Content-Type': 'image/png' },
            data: PNG_1x1,
        });
        expect(bare.status()).toBe(403);

        const collection = await request.post('/api/collections', { data: { name: 'E2E MCP' } });
        const { id: collectionId } = (await collection.json()) as { id: string };

        const created = await rpc(2, 'tools/call', {
            name: 'create_item',
            arguments: {
                collectionId,
                name: 'Signed upload item',
                images: [{ filename: guide.filename, caption: 'cover' }],
            },
        });
        expect(created.isError).toBeFalsy();
        const item = JSON.parse(created.content[0]!.text!) as {
            images: { filename: string; caption: string | null; url: string }[];
        };
        expect(item.images).toHaveLength(1);
        expect(item.images[0]!.filename).toBe(guide.filename);
        expect(item.images[0]!.caption).toBe('cover');

        // the promoted file is served like any other upload
        const served = await request.get(`/uploads/${guide.filename}`);
        expect(served.status()).toBe(200);
        expect((await served.headers())['content-type']).toBe('image/png');
    });

    test('read-only keys cannot prepare uploads', async ({ request }) => {
        const keyRes = await request.post('/api/settings/api-keys', {
            data: { name: 'e2e mcp readonly', readonly: true },
        });
        const { key } = (await keyRes.json()) as { key: string };

        const res = await request.post('/mcp', {
            headers: {
                Authorization: `Bearer ${key}`,
                Accept: 'application/json, text/event-stream',
            },
            data: { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} },
        });
        expect(res.status()).toBe(200);
        const text = await res.text();
        const dataLine = text.split('\n').find((line) => line.startsWith('data: '));
        const payload = dataLine
            ? (JSON.parse(dataLine.slice(6)) as Record<string, unknown>)
            : (JSON.parse(text) as Record<string, unknown>);
        const tools = (payload.result as { tools: { name: string }[] }).tools.map((t) => t.name);
        expect(tools).toContain('search_items');
        expect(tools).not.toContain('prepare_image_upload');
        expect(tools).not.toContain('upload_image');
    });
});
