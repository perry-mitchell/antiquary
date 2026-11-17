import { Router } from 'express';
import type { Database } from '@antiquary/database';
import { HttpError } from '../errors.js';
import { listSupersetEntriesQuerySchema } from '../schemas.js';
import type { SupersetRegistry } from '../supersets.js';

export function supersetRoutes(db: Database, registry: SupersetRegistry): Router {
    const router = Router();

    router.get('/', (_req, res) => {
        res.json(registry.list());
    });

    router.get('/:key', (req, res) => {
        const info = registry.get(req.params.key);
        if (!info) throw new HttpError(404, 'Catalog not found');
        res.json(info);
    });

    router.get('/:key/entries/:entryId', async (req, res) => {
        const entry = await registry.getEntry(req.params.key, req.params.entryId);
        if (!entry) throw new HttpError(404, 'Catalog entry not found');
        const shopLinks = await db.listShopLinks({
            superset: req.params.key,
            supersetEntry: req.params.entryId,
        });
        res.json({ ...entry, shopLinks });
    });

    router.get('/:key/entries', async (req, res) => {
        const query = listSupersetEntriesQuerySchema.parse(req.query);
        const info = registry.get(req.params.key);
        if (!info) throw new HttpError(404, 'Catalog not found');

        // Ownership spans every collection: any active item matched to the entry counts.
        const itemIdByEntry = new Map<string, string>();
        for (const match of await db.listSupersetMatches()) {
            if (match.superset !== req.params.key) continue;
            if (!itemIdByEntry.has(match.supersetEntry)) {
                itemIdByEntry.set(match.supersetEntry, match.itemId);
            }
        }
        const wantedEntries = new Set(
            (await db.listWanted())
                .filter((w) => w.superset === req.params.key)
                .map((w) => w.supersetEntry),
        );
        const shopLinksByEntry = new Map<string, Awaited<ReturnType<typeof db.listShopLinks>>>();
        for (const link of await db.listShopLinks({ superset: req.params.key })) {
            const list = shopLinksByEntry.get(link.supersetEntry) ?? [];
            list.push(link);
            shopLinksByEntry.set(link.supersetEntry, list);
        }

        const result = await registry.listEntries(req.params.key, {
            query: query.q,
            page: query.page,
            limit: query.limit,
            ownership: query.ownership,
            sort: query.sort,
            isOwned: (entryId) => itemIdByEntry.has(entryId),
        });
        if (!result) throw new HttpError(404, 'Catalog not found');

        res.json({
            ...result,
            ownedCount: itemIdByEntry.size,
            entries: result.entries.map((entry) => {
                const itemId = itemIdByEntry.get(entry.id) ?? null;
                return {
                    ...entry,
                    owned: itemId !== null,
                    itemId,
                    wanted: wantedEntries.has(entry.id),
                    shopLinks: shopLinksByEntry.get(entry.id) ?? [],
                };
            }),
        });
    });

    router.get('/:key/search', async (req, res) => {
        const query = typeof req.query.q === 'string' ? req.query.q : '';
        if (query.trim().length === 0) throw new HttpError(400, 'Missing search query (?q=)');
        const info = registry.get(req.params.key);
        if (!info) throw new HttpError(404, 'Catalog not found');
        res.json({ results: await registry.search(req.params.key, query) });
    });

    return router;
}
