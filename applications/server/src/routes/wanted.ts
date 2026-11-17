import { Router } from 'express';
import type { Database, WantedDto } from '@antiquary/database';
import { HttpError } from '../errors.js';
import { addWantedSchema } from '../schemas.js';
import type { SupersetEntry, SupersetRegistry } from '../supersets.js';

export interface WantedListItemDto extends WantedDto {
    /** Catalog display name; null when the catalog is no longer bundled. */
    supersetName: string | null;
    /** Catalog entry details; null when the entry no longer exists. */
    entry: SupersetEntry | null;
    owned: boolean;
    ownedItemId: string | null;
}

/** Fills wanted rows with catalog details and cross-collection ownership. */
export async function enrichWanted(
    db: Database,
    supersets: SupersetRegistry,
    rows: WantedDto[],
): Promise<WantedListItemDto[]> {
    const itemByEntry = new Map<string, string>();
    for (const match of await db.listSupersetMatches()) {
        const key = `${match.superset}\u0000${match.supersetEntry}`;
        if (!itemByEntry.has(key)) itemByEntry.set(key, match.itemId);
    }

    const enriched: WantedListItemDto[] = [];
    for (const row of rows) {
        const info = supersets.get(row.superset);
        const entry = await supersets.getEntry(row.superset, row.supersetEntry);
        const ownedItemId = itemByEntry.get(`${row.superset}\u0000${row.supersetEntry}`) ?? null;
        enriched.push({
            ...row,
            supersetName: info?.name ?? null,
            entry,
            owned: ownedItemId !== null,
            ownedItemId,
        });
    }
    return enriched;
}

export function wantedRoutes(db: Database, registry: SupersetRegistry): Router {
    const router = Router();

    router.get('/', async (_req, res) => {
        res.json(await enrichWanted(db, registry, await db.listWanted()));
    });

    router.post('/', async (req, res) => {
        const input = addWantedSchema.parse(req.body);
        if (!registry.get(input.superset)) throw new HttpError(404, 'Catalog not found');
        if (!(await registry.getEntry(input.superset, input.supersetEntry))) {
            throw new HttpError(404, 'Catalog entry not found');
        }
        const created = await db.addWanted(input);
        const [enriched] = await enrichWanted(db, registry, [created]);
        res.status(201).json(enriched);
    });

    router.delete('/:superset/entries/:entryId', async (req, res) => {
        const removed = await db.removeWanted(req.params.superset, req.params.entryId);
        if (!removed) throw new HttpError(404, 'Wanted entry not found');
        res.json({ ok: true });
    });

    return router;
}
