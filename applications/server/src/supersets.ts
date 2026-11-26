import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** One physical release variant in a bundled catalog. */
export interface SupersetEntry {
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
    rarity?: SupersetRarity;
}

/** Rarity reference values for a catalog entry (1–10 integer scale). */
export interface SupersetRarity {
    rarity: number;
    rarityLabel: string | null;
    rarityPercent: number | null;
}

interface RarityFile {
    key: string;
    entries: Record<
        string,
        { rarity?: number; rarityLabel?: string | null; rarityPercent?: number | null }
    >;
}

interface CatalogFile {
    key: string;
    name: string;
    entries: SupersetEntry[];
}

/** Pre-folded search text per entry, index-aligned with catalog.entries. */
interface FoldedEntry {
    title: string;
    name: string;
    serial: string | null;
}

interface IndexEntry {
    key: string;
    name: string;
    source: string;
    sourceUrl: string;
    license: string;
    attribution: string;
    datVersion: string | null;
    /** False for curated (not exhaustive) catalogs like PC/DOS — items may sit outside them. */
    complete?: boolean;
    generatedAt: string;
    variantCount: number;
    titleCount: number;
    file: string;
}

export type SupersetInfo = Omit<IndexEntry, 'file'>;

export interface SupersetSearchResult {
    title: string;
    variants: SupersetEntry[];
}

/**
 * Search fold: case-insensitive, accents and full-width forms unwrapped, every
 * run of punctuation or symbols turned into a single space. "Half-Life: Blue
 * Shift" and "half life blue shift" fold to the same text. Latin combining
 * marks are dropped; kana voicing marks are kept so Japanese stays exact.
 */
export function foldText(value: string): string {
    return value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .normalize('NFC');
}

/**
 * Fuzzy match on folded text: the folded query as a substring, or — for
 * multi-word queries — every word present somewhere, order ignored
 * ("trigger chrono" finds "Chrono Trigger").
 */
export function fuzzyIncludes(foldedText: string, foldedQuery: string): boolean {
    if (foldedQuery.length === 0) return false;
    if (foldedText.includes(foldedQuery)) return true;
    const words = foldedQuery.split(' ');
    return words.length > 1 && words.every((word) => foldedText.includes(word));
}

export type SupersetOwnership = 'all' | 'owned' | 'missing';

export type SupersetEntrySort = 'title' | 'rarity-asc' | 'rarity-desc';

export interface SupersetEntryListOptions {
    query?: string;
    page?: number;
    limit?: number;
    /** Filter by ownership; requires `isOwned` when not "all". */
    ownership?: SupersetOwnership;
    isOwned?: (entryId: string) => boolean;
    /** Unrated entries count as rarity 0 and keep title order among equals. */
    sort?: SupersetEntrySort;
}

export interface SupersetEntryListResult {
    entries: SupersetEntry[];
    total: number;
    page: number;
    limit: number;
}

export interface SupersetCompletion {
    owned: number;
    total: number;
    percent: number;
}

/** How many catalog files may stay parsed in memory at once. */
const MAX_CACHED_CATALOGS = 4;

/**
 * Serves bundled superset catalogs. Only the lightweight index.json is read
 * at boot; individual catalog files (~1–3 MB each) are parsed lazily on
 * first use and kept in a small LRU, so memory stays low no matter how many
 * catalogs are bundled.
 */
export class SupersetRegistry {
    private readonly dir: string;
    private readonly index = new Map<string, IndexEntry>();
    private readonly cache = new Map<string, CatalogFile>();
    private readonly foldedCache = new WeakMap<CatalogFile, FoldedEntry[]>();
    private readonly rarityCache = new Map<string, Map<string, SupersetRarity>>();

    private constructor(dir: string, index: IndexEntry[]) {
        this.dir = dir;
        for (const entry of index) this.index.set(entry.key, entry);
    }

    static async load(dir: string = defaultCatalogDir()): Promise<SupersetRegistry> {
        let index: IndexEntry[];
        try {
            index = JSON.parse(await readFile(join(dir, 'index.json'), 'utf-8')) as IndexEntry[];
        } catch {
            throw new Error(`No catalogs index found in ${dir} — run "npm run catalog:build"`);
        }
        if (index.length === 0) {
            throw new Error(`Catalogs index in ${dir} is empty — run "npm run catalog:build"`);
        }
        return new SupersetRegistry(dir, index);
    }

    list(): SupersetInfo[] {
        return [...this.index.values()].map((entry) => this.toInfo(entry));
    }

    get(key: string): SupersetInfo | null {
        const entry = this.index.get(key);
        return entry ? this.toInfo(entry) : null;
    }

    /** A catalog without an explicit flag defaults to complete (exhaustive). */
    private toInfo(entry: IndexEntry): SupersetInfo {
        const { file: _file, complete, ...info } = entry;
        return { ...info, complete: complete ?? true };
    }

    async getEntry(key: string, id: string): Promise<SupersetEntry | null> {
        const catalog = await this.withCatalog(key);
        if (!catalog) return null;
        const entry = catalog.entries.find((e) => e.id === id);
        if (!entry) return null;
        const rarity = await this.getRarity(key, id);
        return rarity ? { ...entry, rarity } : entry;
    }

    /** Compiled rarity for an entry, if the superset ships a rarity file with one. */
    async getRarity(key: string, id: string): Promise<SupersetRarity | null> {
        if (!this.index.has(key)) return null;
        return (await this.rarityMapFor(key)).get(id) ?? null;
    }

    /**
     * Paginated catalog browser: every entry (variants included), searched
     * fuzzily (case, accents, punctuation and word order ignored) across
     * titles, variant names and serials, alphabetically ordered and
     * optionally filtered to owned or missing entries.
     */
    async listEntries(
        key: string,
        opts: SupersetEntryListOptions = {},
    ): Promise<SupersetEntryListResult | null> {
        const catalog = await this.withCatalog(key);
        if (!catalog) return null;

        const page = Math.max(1, opts.page ?? 1);
        const limit = Math.min(500, Math.max(1, opts.limit ?? 24));
        const needle = foldText(opts.query ?? '');
        const ownership = opts.ownership ?? 'all';
        const rarityMap = await this.rarityMapFor(key);

        let entries = catalog.entries;
        if (needle.length > 0) {
            const folded = this.foldedFor(catalog);
            entries = catalog.entries.filter(
                (_, index) =>
                    fuzzyIncludes(folded[index]!.title, needle) ||
                    fuzzyIncludes(folded[index]!.name, needle) ||
                    (folded[index]!.serial !== null &&
                        fuzzyIncludes(folded[index]!.serial, needle)),
            );
        }
        if (ownership !== 'all') {
            const isOwned = opts.isOwned ?? (() => false);
            entries = entries.filter((entry) =>
                ownership === 'owned' ? isOwned(entry.id) : !isOwned(entry.id),
            );
        }

        const byTitle = (a: SupersetEntry, b: SupersetEntry) =>
            a.parentTitle.localeCompare(b.parentTitle) || a.name.localeCompare(b.name);
        const sort = opts.sort ?? 'title';
        if (sort === 'title') {
            entries = [...entries].sort(byTitle);
        } else {
            const rarityOf = (entry: SupersetEntry) => rarityMap.get(entry.id)?.rarity ?? 0;
            const direction = sort === 'rarity-desc' ? -1 : 1;
            entries = [...entries].sort(
                (a, b) => direction * (rarityOf(a) - rarityOf(b)) || byTitle(a, b),
            );
        }

        const slice = entries.slice((page - 1) * limit, (page - 1) * limit + limit).map((entry) => {
            const rarity = rarityMap.get(entry.id);
            return rarity ? { ...entry, rarity } : entry;
        });
        return { entries: slice, total: entries.length, page, limit };
    }

    private async rarityMapFor(key: string): Promise<Map<string, SupersetRarity>> {
        let rarityMap = this.rarityCache.get(key);
        if (!rarityMap) {
            rarityMap = new Map();
            try {
                const file = JSON.parse(
                    await readFile(join(dirname(this.dir), 'rarity', `${key}.json`), 'utf-8'),
                ) as RarityFile;
                for (const [entryId, values] of Object.entries(file.entries ?? {})) {
                    if (typeof values.rarity !== 'number') continue;
                    rarityMap.set(entryId, {
                        rarity: values.rarity,
                        rarityLabel: values.rarityLabel ?? null,
                        rarityPercent: values.rarityPercent ?? null,
                    });
                }
            } catch {
                // no rarity data for this superset
            }
            this.rarityCache.set(key, rarityMap);
        }
        return rarityMap;
    }

    /** Free-text search across titles, variant names and serials, grouped by title. */
    async search(key: string, query: string, maxTitles = 8): Promise<SupersetSearchResult[]> {
        const catalog = await this.withCatalog(key);
        if (!catalog) return [];
        const needle = foldText(query);
        if (needle.length === 0) return [];

        const folded = this.foldedFor(catalog);
        const foldedTitleByGroup = new Map<string, string>();
        const groups = new Map<string, SupersetEntry[]>();
        const rarityByEntry = new Map<string, SupersetRarity>();
        for (const [index, entry] of catalog.entries.entries()) {
            const { title, name, serial } = folded[index]!;
            const titleMatch = fuzzyIncludes(title, needle);
            const serialMatch = serial !== null && fuzzyIncludes(serial, needle);
            const nameMatch = fuzzyIncludes(name, needle);
            if (!titleMatch && !serialMatch && !nameMatch) continue;
            foldedTitleByGroup.set(entry.parentTitle, title);
            const rarity = await this.getRarity(key, entry.id);
            if (rarity) rarityByEntry.set(entry.id, rarity);
            const list = groups.get(entry.parentTitle) ?? [];
            list.push(entry);
            groups.set(entry.parentTitle, list);
        }

        return [...groups.entries()]
            .sort((a, b) => {
                const aPrefix = (foldedTitleByGroup.get(a[0]) ?? '').startsWith(needle) ? 0 : 1;
                const bPrefix = (foldedTitleByGroup.get(b[0]) ?? '').startsWith(needle) ? 0 : 1;
                return aPrefix - bPrefix || a[0].localeCompare(b[0]);
            })
            .slice(0, maxTitles)
            .map(([title, variants]) => ({
                title,
                variants: variants
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((variant) => {
                        const rarity = rarityByEntry.get(variant.id);
                        return rarity ? { ...variant, rarity } : variant;
                    }),
            }));
    }

    /** Folded search text for a catalog, built once and reused across searches. */
    private foldedFor(catalog: CatalogFile): FoldedEntry[] {
        let folded = this.foldedCache.get(catalog);
        if (!folded) {
            folded = catalog.entries.map((entry) => ({
                title: foldText(entry.parentTitle),
                name: foldText(entry.name),
                serial: entry.serial === null ? null : foldText(entry.serial),
            }));
            this.foldedCache.set(catalog, folded);
        }
        return folded;
    }

    private async withCatalog(key: string): Promise<CatalogFile | null> {
        const info = this.index.get(key);
        if (!info) return null;

        const cached = this.cache.get(key);
        if (cached) {
            // refresh LRU position
            this.cache.delete(key);
            this.cache.set(key, cached);
            return cached;
        }

        const catalog = JSON.parse(
            await readFile(join(this.dir, info.file), 'utf-8'),
        ) as CatalogFile;
        this.cache.set(key, catalog);
        while (this.cache.size > MAX_CACHED_CATALOGS) {
            const oldest = this.cache.keys().next().value;
            if (oldest === undefined) break;
            this.cache.delete(oldest);
        }
        return catalog;
    }
}

/**
 * Computes how much of a catalog a collection covers: distinct matched
 * titles (variants collapse into their parent) over the catalog total.
 */
export async function computeCompletion(
    matches: { superset: string; supersetEntry: string }[],
    registry: SupersetRegistry,
    supersetKey: string,
): Promise<SupersetCompletion | null> {
    const info = registry.get(supersetKey);
    if (!info) return null;
    const titles = new Set<string>();
    for (const match of matches) {
        if (match.superset !== supersetKey) continue;
        const entry = await registry.getEntry(supersetKey, match.supersetEntry);
        if (entry) titles.add(entry.parentTitle);
    }
    return {
        owned: titles.size,
        total: info.titleCount,
        percent: info.titleCount > 0 ? Math.round((titles.size / info.titleCount) * 1000) / 10 : 0,
    };
}

/**
 * Field values a catalog match can prefill on a template — the same set the
 * web form fills in when picking a variant. Values the caller already
 * provided always win; select options that do not contain the value are
 * skipped.
 */
export function prefillCatalogFields(
    fields: { id: string; name: string; type: string; options: string[] | null }[],
    entry: SupersetEntry,
    provided: { fieldId: string; value: unknown }[] = [],
): { fieldId: string; value: unknown }[] {
    const byName = new Map(fields.map((f) => [f.name.trim().toLowerCase(), f]));
    const providedIds = new Set(provided.map((v) => v.fieldId));
    const picks: [string, unknown][] = [
        ['Region', entry.region],
        ['Serial', entry.serial],
        ['Developer', entry.developer],
        ['Publisher', entry.publisher],
        ['Genre', entry.genre],
        ['Year', entry.year],
    ];
    const prefilled: { fieldId: string; value: unknown }[] = [];
    for (const [name, value] of picks) {
        if (value === null || value === undefined || value === '') continue;
        const field = byName.get(name.toLowerCase());
        if (!field || providedIds.has(field.id)) continue;
        if (field.type === 'select' && !(field.options ?? []).includes(String(value))) continue;
        prefilled.push({ fieldId: field.id, value });
    }
    return [...provided, ...prefilled];
}

export function defaultCatalogDir(): string {
    return join(dirname(fileURLToPath(import.meta.url)), '../catalogs');
}
