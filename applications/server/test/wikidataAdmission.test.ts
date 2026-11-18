import { describe, expect, it } from 'vitest';
import type { HarvestedRelease, WikidataEntry } from '../../../scripts/lib/wikidataAdmission.mjs';
import {
    buildWikidataEntries,
    creditingEntities,
    isAttributed,
    NO_VALUE_QID,
} from '../../../scripts/lib/wikidataAdmission.mjs';

const ENTITY = 'https://www.wikidata.org/entity/';

/** The complete ledger a shipped entry always carries. */
type Field = keyof WikidataEntry;

const SHIPPED_KEYS: readonly Field[] = [
    'id',
    'name',
    'parentTitle',
    'region',
    'serial',
    'developer',
    'publisher',
    'genre',
    'year',
];

type HarvestInput = Partial<Omit<HarvestedRelease, 'id'>> & { id: string };

const harvested = (input: HarvestInput): HarvestedRelease => ({
    id: input.id,
    name: input.name ?? input.id,
    years: new Set(input.years ?? []),
    developers: new Set(input.developers ?? []),
    publishers: new Set(input.publishers ?? []),
    genres: new Set(input.genres ?? []),
    credits: input.credits ?? [],
});

/** Credits a party (so the release ships) without implying any display names. */
const credited = (input: HarvestInput): HarvestedRelease =>
    harvested({ credits: ['Q173941'], ...input });

const entriesFrom = (...games: HarvestedRelease[]) =>
    buildWikidataEntries(new Map(games.map((game) => [game.id, game])));

describe('creditingEntities', () => {
    it('takes a party from either the developer or the publisher binding', () => {
        expect(creditingEntities([`${ENTITY}Q156603`])).toEqual(['Q156603']);
        expect(creditingEntities([`${ENTITY}Q156603`, `${ENTITY}Q23901`])).toEqual([
            'Q156603',
            'Q23901',
        ]);
    });

    it('ignores absent OPTIONAL bindings and values that are not entities', () => {
        expect(creditingEntities([undefined, null, ''])).toEqual([]);
        expect(creditingEntities([`${ENTITY}Q1`, 'not-an-iri', `${ENTITY}nonsense`])).toEqual([
            'Q1',
        ]);
        expect(creditingEntities(['not-an-iri', `${ENTITY}nonsense`])).toEqual([]);
    });

    it(`ignores the ${NO_VALUE_QID} "no value" marker but keeps real parties`, () => {
        expect(creditingEntities([`${ENTITY}${NO_VALUE_QID}`])).toEqual([]);
        expect(creditingEntities([`${ENTITY}Q173941`, `${ENTITY}${NO_VALUE_QID}`])).toEqual([
            'Q173941',
        ]);
    });
});

describe('isAttributed', () => {
    it('demands a named party behind the release', () => {
        expect(isAttributed(harvested({ id: 'Q1' }))).toBe(false);
        expect(isAttributed(harvested({ id: 'Q1', credits: ['Q173941'] }))).toBe(true);
    });
});

describe('buildWikidataEntries', () => {
    it('maps an empty harvest to no entries', () => {
        expect(buildWikidataEntries(new Map())).toEqual([]);
    });

    it('ships a publisher-only release with the developer left empty', () => {
        expect(
            entriesFrom(
                harvested({
                    id: 'Q901',
                    name: 'Space Chase: City Under Siege',
                    publishers: new Set(['Safari Software']),
                    credits: ['Q7627105'],
                }),
            ),
        ).toEqual([
            {
                id: 'Q901',
                name: 'Space Chase: City Under Siege',
                parentTitle: 'Space Chase: City Under Siege',
                region: null,
                serial: null,
                developer: null,
                publisher: 'Safari Software',
                genre: null,
                year: null,
            },
        ]);
    });

    it('ships a developer-only release recorded without a year', () => {
        expect(
            entriesFrom(
                credited({
                    id: 'Q902',
                    name: 'Untitled Shareware',
                    developers: new Set(['Private Dev']),
                }),
            ),
        ).toEqual([
            {
                id: 'Q902',
                name: 'Untitled Shareware',
                parentTitle: 'Untitled Shareware',
                region: null,
                serial: null,
                developer: 'Private Dev',
                publisher: null,
                genre: null,
                year: null,
            },
        ]);
    });

    it('drops a release nobody is named behind, whatever else it records', () => {
        const ghost = harvested({
            id: 'Q903',
            name: 'Ghost',
            years: new Set([1993]),
            genres: new Set(['Platformer']),
        });
        expect(isAttributed(ghost)).toBe(false);
        expect(entriesFrom(ghost)).toEqual([]);
    });

    it('gives every survivor the full property ledger, no absent or blank slot', () => {
        const entries = entriesFrom(
            credited({ id: 'Q904', name: 'Sparse Title' }),
            credited({ id: 'Q905', name: 'Another Sparse Title' }),
        );
        expect(entries.map((entry) => Object.keys(entry).sort())).toEqual([
            [...SHIPPED_KEYS].sort(),
            [...SHIPPED_KEYS].sort(),
        ]);
        for (const entry of entries) {
            for (const key of SHIPPED_KEYS) {
                const value = entry[key] as unknown;
                expect(key in entry, key).toBe(true);
                expect(value, key).not.toBeUndefined();
                expect(value, key).not.toBe('');
            }
        }
    });

    it('keeps the earliest year and the alphabetically first name', () => {
        const [entry] = entriesFrom(
            credited({
                id: 'Q906',
                name: 'Multi Year',
                years: new Set([1994, 1990, 1992]),
                developers: new Set(['Zeppelin Software', 'Apogee']),
                publishers: new Set(['Zoom', 'Apogee']),
            }),
        );
        expect(entry).toBeDefined();
        expect(entry?.year).toBe(1990);
        expect(entry?.developer).toBe('Apogee');
        expect(entry?.publisher).toBe('Apogee');
    });

    it('orders by parent title then name so repeat builds stay diffable', () => {
        expect(
            entriesFrom(
                credited({ id: 'Q908', name: 'beta' }),
                credited({ id: 'Q907', name: 'alpha' }),
                credited({ id: 'Q909', name: 'Alpha' }),
            ).map((entry) => entry.name),
        ).toEqual(['alpha', 'Alpha', 'beta']);
    });
});
