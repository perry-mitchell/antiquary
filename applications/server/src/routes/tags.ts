import { Router } from 'express';
import type { Database } from '@antiquary/database';
import { HttpError } from '../errors.js';
import { createTagSchema, updateTagSchema } from '../schemas.js';

export function tagRoutes(db: Database): Router {
    const router = Router();

    router.get('/', async (_req, res) => {
        res.json(await db.listTags());
    });

    router.post('/', async (req, res) => {
        const input = createTagSchema.parse(req.body);
        res.status(201).json(await db.createTag(input));
    });

    router.patch('/:id', async (req, res) => {
        const patch = updateTagSchema.parse(req.body);
        const updated = await db.updateTag(req.params.id, patch);
        if (!updated) throw new HttpError(404, 'Tag not found');
        res.json(updated);
    });

    router.delete('/:id', async (req, res) => {
        await db.deleteTag(req.params.id);
        res.json({ ok: true });
    });

    return router;
}

export function trashRoutes(db: Database): Router {
    const router = Router();
    router.get('/', async (_req, res) => {
        res.json(await db.getTrash());
    });
    return router;
}

export function statsRoutes(db: Database): Router {
    const router = Router();
    router.get('/', async (_req, res) => {
        res.json(await db.getStats());
    });
    return router;
}
