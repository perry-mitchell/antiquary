/**
 * Types for the hand-written ES module beside this file. Kept by hand: the
 * generator runs under bare `node`, so the implementation has to stay `.mjs`.
 */

/** One Wikidata item as harvested from the SPARQL rows. */
export interface HarvestedRelease {
    id: string;
    name: string;
    /** Years seen on P577; empty for a release Wikidata leaves undated. */
    years: Set<number>;
    developers: Set<string>;
    publishers: Set<string>;
    genres: Set<string>;
    /** QIDs of the parties named on P178/P123 — what admits the release. */
    credits: string[];
}

/** A shipped catalog entry: every property is always present. */
export interface WikidataEntry {
    id: string;
    name: string;
    parentTitle: string;
    region: string | null;
    serial: string | null;
    developer: string | null;
    publisher: string | null;
    genre: string | null;
    year: number | null;
}

export declare const NO_VALUE_QID: string;

export declare function creditingEntities(bindings: readonly unknown[]): string[];

export declare function isAttributed(game: Pick<HarvestedRelease, 'credits'>): boolean;

export declare function buildWikidataEntries(
    games: ReadonlyMap<string, HarvestedRelease>,
): WikidataEntry[];
