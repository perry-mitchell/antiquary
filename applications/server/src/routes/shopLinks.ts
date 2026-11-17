import { Router } from 'express';
import type { Database } from '@antiquary/database';
import { HttpError } from '../errors.js';
import { createShopLinkSchema } from '../schemas.js';
import type { SupersetRegistry } from '../supersets.js';

export function shopLinkRoutes(db: Database, registry: SupersetRegistry): Router {
    const router = Router();

    router.get('/', async (req, res) => {
        const superset = typeof req.query.superset === 'string' ? req.query.superset : undefined;
        const supersetEntry =
            typeof req.query.supersetEntry === 'string' ? req.query.supersetEntry : undefined;
        if (superset && !registry.get(superset)) throw new HttpError(404, 'Catalog not found');
        res.json(await db.listShopLinks({ superset, supersetEntry }));
    });

    router.post('/', async (req, res) => {
        const input = createShopLinkSchema.parse(req.body);
        if (!registry.get(input.superset)) throw new HttpError(404, 'Catalog not found');
        if (!(await registry.getEntry(input.superset, input.supersetEntry))) {
            throw new HttpError(404, 'Catalog entry not found');
        }
        res.status(201).json(await db.createShopLink(input));
    });

    router.delete('/:id', async (req, res) => {
        const removed = await db.deleteShopLink(req.params.id);
        if (!removed) throw new HttpError(404, 'Shop link not found');
        res.json({ ok: true });
    });

    return router;
}
