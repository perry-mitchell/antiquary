/**
 * Admission rule and entry shaping for the Wikidata-sourced catalogs (PC, DOS).
 *
 * Wikidata is thin on the personal-computer platforms: many real releases
 * credit only a publisher, or carry no release date at all — shareware and
 * BBS distributions especially. Those are genuine parts of the platform's
 * library, so they belong in the catalog with the unknown fields left empty
 * rather than filtered out. What decides membership is therefore "somebody is
 * named behind the release", not "the date and developer are known".
 */

/** Wikidata's stand-in for "deliberately unset" — not a crediting party. */
export const NO_VALUE_QID = 'Q5499104';

/** Trailing `/entity/Q123` of a Wikidata entity IRI. */
const ENTITY_TAIL = /\/entity\/(Q\d+)$/i;

/**
 * QIDs of the parties actually named behind a release, out of the raw entity
 * bindings for P178 (developer) and P123 (publisher). Based on the entity
 * itself rather than its label: Wikidata's label service answers in two
 * languages only, so a credit recorded in any other language still exists and
 * still counts, it just stays out of the shipped entry.
 */
export function creditingEntities(bindings) {
    const qids = [];
    for (const binding of bindings) {
        const match = typeof binding === 'string' ? ENTITY_TAIL.exec(binding) : null;
        const qid = match?.[1];
        if (qid && qid.toUpperCase() !== NO_VALUE_QID) qids.push(qid);
    }
    return qids;
}

/** True when the game credits at least one real party. */
export function isAttributed(game) {
    return (game.credits ?? []).length > 0;
}

/** Alphabetically first recorded name, or null where Wikidata has none. */
const firstOrNull = (names) => [...names].sort((a, b) => a.localeCompare(b))[0] ?? null;

/**
 * Shapes the harvested games into the shipped entry list: unattributed stubs
 * are excluded, and every other field is always present — empty, not absent,
 * when Wikidata records nothing for it.
 */
export function buildWikidataEntries(games) {
    const entries = [];
    for (const game of games.values()) {
        if (!isAttributed(game)) continue;
        entries.push({
            id: game.id,
            name: game.name,
            parentTitle: game.name,
            region: null,
            serial: null,
            developer: firstOrNull(game.developers),
            publisher: firstOrNull(game.publishers),
            genre: firstOrNull(game.genres),
            year: game.years.size > 0 ? Math.min(...game.years) : null,
        });
    }
    entries.sort(
        (a, b) => a.parentTitle.localeCompare(b.parentTitle) || a.name.localeCompare(b.name),
    );
    return entries;
}
