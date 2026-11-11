#!/usr/bin/env node
/**
 * Bundler for all bundled superset catalogs.
 *
 * Downloads DAT files from libretro-database (CC-BY-SA-4.0), joins them by
 * ROM CRC and writes one merged JSON catalog per system plus an index.json
 * the API reads at boot. Re-run any time:
 *
 *   npm run catalog:build            # build every catalog in the manifest
 *   npm run catalog:build -- --only snes
 *
 * Catalogs are declared explicitly in CATALOGS below. Systems that are the
 * same console under regional names are combined (e.g. PC Engine +
 * TurboGrafx-16 + SuperGrafx); genuinely separate consoles stay separate
 * (Game Boy vs Game Boy Color vs GBA). Purely digital storefront lists,
 * mobile platforms, UMD music/video, title updates and arcade boards are
 * intentionally skipped.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://raw.githubusercontent.com/libretro/libretro-database/master/metadat';
const METADATA_DIRS = {
    serial: 'serial',
    publisher: 'publisher',
    developer: 'developer',
    genre: 'genre',
    year: 'releaseyear',
};

/** key → catalog definition. `systems` are libretro-database DAT names. */
const CATALOGS = [
    // --- Nintendo (cartridge) ---
    {
        key: 'nes',
        name: 'Nintendo Entertainment System / Famicom',
        source: 'no-intro',
        systems: ['Nintendo - Nintendo Entertainment System'],
    },
    {
        key: 'fds',
        name: 'Nintendo Family Computer Disk System',
        source: 'no-intro',
        systems: ['Nintendo - Family Computer Disk System'],
    },
    {
        key: 'snes',
        name: 'Super Nintendo Entertainment System',
        source: 'no-intro',
        systems: ['Nintendo - Super Nintendo Entertainment System'],
    },
    {
        key: 'satellaview',
        name: 'Nintendo Satellaview',
        source: 'no-intro',
        systems: ['Nintendo - Satellaview'],
    },
    {
        key: 'sufami',
        name: 'Bandai Sufami Turbo',
        source: 'no-intro',
        systems: ['Nintendo - Sufami Turbo'],
    },
    { key: 'n64', name: 'Nintendo 64', source: 'no-intro', systems: ['Nintendo - Nintendo 64'] },
    {
        key: 'n64dd',
        name: 'Nintendo 64DD',
        source: 'no-intro',
        systems: ['Nintendo - Nintendo 64DD'],
    },
    {
        key: 'virtualboy',
        name: 'Nintendo Virtual Boy',
        source: 'no-intro',
        systems: ['Nintendo - Virtual Boy'],
    },
    { key: 'gb', name: 'Nintendo Game Boy', source: 'no-intro', systems: ['Nintendo - Game Boy'] },
    {
        key: 'gbc',
        name: 'Nintendo Game Boy Color',
        source: 'no-intro',
        systems: ['Nintendo - Game Boy Color'],
    },
    {
        key: 'gba',
        name: 'Nintendo Game Boy Advance',
        source: 'no-intro',
        systems: ['Nintendo - Game Boy Advance'],
    },
    {
        key: 'ereader',
        name: 'Nintendo e-Reader',
        source: 'no-intro',
        systems: ['Nintendo - e-Reader'],
    },
    { key: 'nds', name: 'Nintendo DS', source: 'no-intro', systems: ['Nintendo - Nintendo DS'] },
    { key: 'dsi', name: 'Nintendo DSi', source: 'no-intro', systems: ['Nintendo - Nintendo DSi'] },
    {
        key: 'n3ds',
        name: 'Nintendo 3DS / New 3DS',
        source: 'no-intro',
        systems: ['Nintendo - Nintendo 3DS', 'Nintendo - New Nintendo 3DS'],
    },
    {
        key: 'pokemonmini',
        name: 'Nintendo Pokémon Mini',
        source: 'no-intro',
        systems: ['Nintendo - Pokemon Mini'],
    },
    {
        key: 'wiiu',
        name: 'Nintendo Wii U (digital titles)',
        source: 'no-intro',
        systems: ['Nintendo - Wii U (Digital)'],
    },
    // --- Nintendo (disc) ---
    {
        key: 'gamecube',
        name: 'Nintendo GameCube',
        source: 'redump',
        systems: ['Nintendo - GameCube'],
    },
    { key: 'wii', name: 'Nintendo Wii', source: 'redump', systems: ['Nintendo - Wii'] },
    // --- Sega ---
    { key: 'sg1000', name: 'Sega SG-1000', source: 'no-intro', systems: ['Sega - SG-1000'] },
    {
        key: 'sms',
        name: 'Sega Master System / Mark III',
        source: 'no-intro',
        systems: ['Sega - Master System - Mark III'],
    },
    {
        key: 'megadrive',
        name: 'Sega Mega Drive / Genesis',
        source: 'no-intro',
        systems: ['Sega - Mega Drive - Genesis'],
    },
    { key: 'pico', name: 'Sega Pico', source: 'no-intro', systems: ['Sega - PICO'] },
    { key: 'beena', name: 'Sega Beena', source: 'no-intro', systems: ['Sega - Beena'] },
    { key: 'sega32x', name: 'Sega 32X', source: 'no-intro', systems: ['Sega - 32X'] },
    { key: 'gamegear', name: 'Sega Game Gear', source: 'no-intro', systems: ['Sega - Game Gear'] },
    {
        key: 'megacd',
        name: 'Sega Mega-CD / Sega CD',
        source: 'redump',
        systems: ['Sega - Mega-CD - Sega CD'],
    },
    { key: 'saturn', name: 'Sega Saturn', source: 'redump', systems: ['Sega - Saturn'] },
    { key: 'dreamcast', name: 'Sega Dreamcast', source: 'redump', systems: ['Sega - Dreamcast'] },
    // --- Sony ---
    { key: 'ps1', name: 'Sony PlayStation', source: 'redump', systems: ['Sony - PlayStation'] },
    { key: 'ps2', name: 'Sony PlayStation 2', source: 'redump', systems: ['Sony - PlayStation 2'] },
    { key: 'ps3', name: 'Sony PlayStation 3', source: 'redump', systems: ['Sony - PlayStation 3'] },
    {
        key: 'psp',
        name: 'Sony PlayStation Portable',
        source: 'redump',
        systems: ['Sony - PlayStation Portable'],
    },
    {
        key: 'vita',
        name: 'Sony PlayStation Vita',
        source: 'no-intro',
        systems: ['Sony - PlayStation Vita'],
    },
    // --- Microsoft ---
    { key: 'xbox', name: 'Microsoft Xbox', source: 'redump', systems: ['Microsoft - Xbox'] },
    {
        key: 'xbox360',
        name: 'Microsoft Xbox 360',
        source: 'redump',
        systems: ['Microsoft - Xbox 360'],
    },
    // --- NEC ---
    {
        key: 'pce',
        name: 'NEC PC Engine / TurboGrafx-16 / SuperGrafx',
        source: 'no-intro',
        systems: ['NEC - PC Engine - TurboGrafx 16', 'NEC - PC Engine SuperGrafx'],
    },
    {
        key: 'pcecd',
        name: 'NEC PC Engine CD / TurboGrafx-CD',
        source: 'redump',
        systems: ['NEC - PC Engine CD - TurboGrafx-CD'],
    },
    { key: 'pcfx', name: 'NEC PC-FX', source: 'redump', systems: ['NEC - PC-FX'] },
    { key: 'pc98', name: 'NEC PC-98', source: 'redump', systems: ['NEC - PC-98'] },
    // --- Atari ---
    { key: 'atari2600', name: 'Atari 2600', source: 'no-intro', systems: ['Atari - 2600'] },
    { key: 'atari5200', name: 'Atari 5200', source: 'no-intro', systems: ['Atari - 5200'] },
    { key: 'atari7800', name: 'Atari 7800', source: 'no-intro', systems: ['Atari - 7800'] },
    {
        key: 'atari8bit',
        name: 'Atari 8-bit Family',
        source: 'no-intro',
        systems: ['Atari - 8-bit Family'],
    },
    { key: 'lynx', name: 'Atari Lynx', source: 'no-intro', systems: ['Atari - Lynx'] },
    { key: 'jaguar', name: 'Atari Jaguar', source: 'no-intro', systems: ['Atari - Jaguar'] },
    { key: 'jaguarcd', name: 'Atari Jaguar CD', source: 'redump', systems: ['Atari - Jaguar CD'] },
    { key: 'atarist', name: 'Atari ST', source: 'no-intro', systems: ['Atari - ST'] },
    // --- Commodore ---
    { key: 'c64', name: 'Commodore 64', source: 'no-intro', systems: ['Commodore - 64'] },
    { key: 'vic20', name: 'VIC-20', source: 'no-intro', systems: ['Commodore - VIC-20'] },
    { key: 'plus4', name: 'Commodore Plus/4', source: 'no-intro', systems: ['Commodore - Plus-4'] },
    { key: 'amiga', name: 'Commodore Amiga', source: 'no-intro', systems: ['Commodore - Amiga'] },
    { key: 'cd32', name: 'Commodore Amiga CD32', source: 'redump', systems: ['Commodore - CD32'] },
    { key: 'cdtv', name: 'Commodore CDTV', source: 'redump', systems: ['Commodore - CDTV'] },
    // --- Computers ---
    { key: 'msx', name: 'MSX', source: 'no-intro', systems: ['Microsoft - MSX'] },
    { key: 'msx2', name: 'MSX2', source: 'no-intro', systems: ['Microsoft - MSX2'] },
    {
        key: 'zxspectrum3',
        name: 'ZX Spectrum +3',
        source: 'no-intro',
        systems: ['Sinclair - ZX Spectrum +3'],
    },
    { key: 'x1', name: 'Sharp X1', source: 'no-intro', systems: ['Sharp - X1'] },
    { key: 'x68000', name: 'Sharp X68000', source: 'no-intro', systems: ['Sharp - X68000'] },
    { key: 'fmtowns', name: 'Fujitsu FM Towns', source: 'redump', systems: ['Fujitsu - FM Towns'] },
    // --- SNK ---
    {
        key: 'ngp',
        name: 'SNK Neo Geo Pocket',
        source: 'no-intro',
        systems: ['SNK - Neo Geo Pocket'],
    },
    {
        key: 'ngpc',
        name: 'SNK Neo Geo Pocket Color',
        source: 'no-intro',
        systems: ['SNK - Neo Geo Pocket Color'],
    },
    { key: 'neogeocd', name: 'SNK Neo Geo CD', source: 'redump', systems: ['SNK - Neo Geo CD'] },
    // --- Bandai ---
    {
        key: 'wonderswan',
        name: 'Bandai WonderSwan',
        source: 'no-intro',
        systems: ['Bandai - WonderSwan'],
    },
    {
        key: 'wonderswancolor',
        name: 'Bandai WonderSwan Color',
        source: 'no-intro',
        systems: ['Bandai - WonderSwan Color'],
    },
    // --- Classic / dedicated consoles ---
    {
        key: 'colecovision',
        name: 'ColecoVision',
        source: 'no-intro',
        systems: ['Coleco - ColecoVision'],
    },
    {
        key: 'intellivision',
        name: 'Intellivision',
        source: 'no-intro',
        systems: ['Mattel - Intellivision'],
    },
    {
        key: 'odyssey2',
        name: 'Odyssey² / Videopac+',
        source: 'no-intro',
        systems: ['Magnavox - Odyssey2', 'Philips - Videopac+'],
    },
    { key: 'vectrex', name: 'Vectrex', source: 'no-intro', systems: ['GCE - Vectrex'] },
    {
        key: 'channelf',
        name: 'Fairchild Channel F',
        source: 'no-intro',
        systems: ['Fairchild - Channel F'],
    },
    {
        key: 'arcadia',
        name: 'Emerson Arcadia 2001',
        source: 'no-intro',
        systems: ['Emerson - Arcadia 2001'],
    },
    {
        key: 'adventurevision',
        name: 'Entex Adventure Vision',
        source: 'no-intro',
        systems: ['Entex - Adventure Vision'],
    },
    {
        key: 'vc4000',
        name: 'Interton VC 4000',
        source: 'no-intro',
        systems: ['Interton - VC 4000'],
    },
    { key: 'studio2', name: 'RCA Studio II', source: 'no-intro', systems: ['RCA - Studio II'] },
    {
        key: 'supervision',
        name: 'Watara Supervision',
        source: 'no-intro',
        systems: ['Watara - Supervision'],
    },
    { key: 'gamecom', name: 'Tiger Game.com', source: 'no-intro', systems: ['Tiger - Game.com'] },
    { key: 'gp32', name: 'GamePark GP32', source: 'no-intro', systems: ['GamePark - GP32'] },
    { key: 'arduboy', name: 'Arduboy', source: 'no-intro', systems: ['Arduboy Inc - Arduboy'] },
    {
        key: 'creativision',
        name: 'CreatiVision',
        source: 'no-intro',
        systems: ['VTech - CreatiVision'],
    },
    { key: 'vsmile', name: 'V.Smile', source: 'no-intro', systems: ['VTech - V.Smile'] },
    { key: 'loopy', name: 'Casio Loopy', source: 'no-intro', systems: ['Casio - Loopy'] },
    { key: 'pv1000', name: 'Casio PV-1000', source: 'no-intro', systems: ['Casio - PV-1000'] },
    {
        key: 'scv',
        name: 'Epoch Super Cassette Vision',
        source: 'no-intro',
        systems: ['Epoch - Super Cassette Vision'],
    },
    {
        key: 'acan',
        name: 'Funtech Super Acan',
        source: 'no-intro',
        systems: ['Funtech - Super Acan'],
    },
    {
        key: 'gamemaster',
        name: 'Hartung Game Master',
        source: 'no-intro',
        systems: ['Hartung - Game Master'],
    },
    { key: 'picno', name: 'Konami Picno', source: 'no-intro', systems: ['Konami - Picno'] },
    { key: 'leappad', name: 'LeapPad', source: 'no-intro', systems: ['LeapFrog - LeapPad'] },
    {
        key: 'leapster',
        name: 'Leapster Learning Game System',
        source: 'no-intro',
        systems: ['LeapFrog - Leapster Learning Game System'],
    },
    {
        key: 'pocketchallenge',
        name: 'Benesse Pocket Challenge V2',
        source: 'no-intro',
        systems: ['Benesse - Pocket Challenge V2'],
    },
    { key: 'cdi', name: 'Philips CD-i', source: 'redump', systems: ['Philips - CD-i'] },
    { key: '3do', name: 'Panasonic 3DO', source: 'redump', systems: ['The 3DO Company - 3DO'] },
    // --- PC (Wikidata, CC0 — unlike the console catalogs above) ---
    // Source: Wikidata SPARQL, https://www.wikidata.org, public domain (CC0).
    //
    // WHAT IS CUT (the quality filter): a game is kept only if it has BOTH a
    // release date (P577) AND a developer statement (P178).
    //   - Windows (Q1406): 136,482 games total → ~21k kept. The ~115k cut rows
    //     lack a developer: undocumented shovelware, DLC/app-adjacent items and
    //     stub entries. This also naturally biases toward documented, older
    //     titles — the "aged is fine" set.
    //   - DOS (Q170434): 2,421 total → ~1.6k kept on the same filter.
    // Also collapsed per title: earliest release year wins, and of multiple
    // developers/publishers/genres only the alphabetically first is kept.
    // There are no regional variants or serials on Wikidata — one entry per
    // title, region/serial stay null.
    { key: 'pc', name: 'PC (Microsoft Windows)', source: 'wikidata', platforms: ['Q1406'] },
    {
        key: 'dos',
        name: 'DOS',
        source: 'wikidata',
        // Wikidata curators tag DOS games as either DOS (Q170434) or MS-DOS
        // (Q47604) — both are matched.
        platforms: ['Q170434', 'Q47604'],
    },
];

const REGIONS = [
    'USA',
    'Japan',
    'Europe',
    'France',
    'Germany',
    'Italy',
    'Spain',
    'Sweden',
    'Australia',
    'Brazil',
    'Canada',
    'Netherlands',
    'Korea',
    'Hong Kong',
    'Taiwan',
    'China',
    'World',
    'Asia',
    'Russia',
];

const MARKER_TOKEN =
    /^(?:Rev(?:ision)?\s*\w*|v?\d[\w.]*|Beta.*|Proto.*|Sample.*|Unl|Pirate|Hack|Translation.*|Aftermarket.*|Homebrew.*|.*Demo.*|BIOS.*|BS.*|NP.*|SNS.*|SHVC.*|PC10.*|[12]-?Player.*|Mk\.?.*)$/i;
const LANGUAGE_TOKEN = /^[a-z]{2}( ?- ?[a-z]{2})?(, ?[a-z]{2}( ?- ?[a-z]{2})?)*$/i;

function parseVariant(name) {
    let parent = name.trim();
    let region = null;
    for (;;) {
        const match = parent.match(/\s*\(([^()]*)\)\s*$/);
        if (!match) break;
        const inner = match[1];
        const regionHit = REGIONS.find((r) => inner.includes(r));
        const isMarker =
            regionHit !== undefined ||
            MARKER_TOKEN.test(inner) ||
            LANGUAGE_TOKEN.test(inner) ||
            /^[A-Z]{2,3}(-[A-Z]{2})*$/.test(inner);
        if (!isMarker) break;
        if (regionHit && !region) region = regionHit;
        parent = parent.slice(0, match.index).trim();
    }
    parent = parent
        .replace(/\s*\[[^\]]*\]\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim();
    return { parentTitle: parent || name.trim(), region };
}

async function fetchWithRetries(url, validate) {
    // DAT cache: re-runs skip the ~73 MB of downloads.
    const { createHash } = await import('node:crypto');
    const cacheDir = resolve(fileURLToPath(new URL('..', import.meta.url)), '.catalog-cache');
    const cacheFile = join(cacheDir, createHash('sha256').update(url).digest('hex').slice(0, 32));
    try {
        const cached = await readFile(cacheFile, 'utf-8');
        if (!validate || validate(cached)) return cached;
        // corrupted cache entry — drop it and refetch
        await import('node:fs/promises').then((fs) => fs.unlink(cacheFile).catch(() => {}));
    } catch {
        /* not cached */
    }

    let lastError;
    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            const res = await fetch(url, {
                redirect: 'follow',
                // Wikidata's SPARRL endpoint requires a descriptive User-Agent.
                headers: {
                    'User-Agent':
                        'antiquary-catalog-builder/0.1 (+https://github.com/libretro-database; game catalog bundler)',
                },
            });
            if (!res.ok) {
                if (res.status === 404) return null;
                throw new Error(`HTTP ${res.status}`);
            }
            const text = await res.text();
            if (validate && !validate(text))
                throw new Error('invalid payload (truncated or malformed)');
            await mkdir(cacheDir, { recursive: true });
            await writeFile(cacheFile, text);
            return text;
        } catch (error) {
            lastError = error;
            if (attempt < 5) {
                console.warn(`    retry ${attempt} (${String(error)})`);
                await new Promise((r) => setTimeout(r, 1000 * attempt));
            }
        }
    }
    throw new Error(`Failed to fetch ${url}: ${String(lastError)}`);
}

function parseBlocks(dat, field) {
    const out = new Map();
    for (const match of dat.matchAll(/game \(.*?\n\)/gs)) {
        const block = match[0];
        const crc = block.match(/crc ([0-9A-Fa-f]{8})/);
        const value = block.match(new RegExp(`${field} "([^"]*)"`));
        if (crc && value) out.set(crc[1].toUpperCase(), value[1]);
    }
    return out;
}

async function buildCatalog(catalog) {
    const meta = {
        serial: new Map(),
        publisher: new Map(),
        developer: new Map(),
        genre: new Map(),
        year: new Map(),
    };
    const entries = [];
    let datVersion = null;

    for (const system of catalog.systems) {
        console.log(`  [${catalog.key}] ${system} — variants`);
        const variantsDat = await fetchWithRetries(
            `${BASE}/${catalog.source}/${encodeURI(system)}.dat`,
        );
        if (!variantsDat) throw new Error(`Variants DAT not found for ${system}`);
        datVersion = variantsDat.match(/version "([^"]*)"/)?.[1] ?? datVersion;

        for (const [field, dir] of Object.entries(METADATA_DIRS)) {
            const dat = await fetchWithRetries(`${BASE}/${dir}/${encodeURI(system)}.dat`);
            if (dat) {
                console.log(`    ${field}`);
                for (const [crc, value] of parseBlocks(dat, field)) meta[field].set(crc, value);
            }
        }

        for (const match of variantsDat.matchAll(/game \(.*?\n\)/gs)) {
            const block = match[0];
            const name = block.match(/name "([^"]*)"/);
            const crc = block.match(/crc ([0-9A-Fa-f]{8})/);
            if (!name || !crc) continue;
            const id = crc[1].toUpperCase();
            if (entries.some((e) => e.id === id)) continue;
            const { parentTitle, region } = parseVariant(name[1]);
            const yearValue = Number.parseInt(meta.year.get(id) ?? '', 10);
            entries.push({
                id,
                name: name[1],
                parentTitle,
                region,
                serial: meta.serial.get(id) ?? null,
                developer: meta.developer.get(id) ?? null,
                publisher: meta.publisher.get(id) ?? null,
                genre: meta.genre.get(id) ?? null,
                year: Number.isFinite(yearValue) ? yearValue : null,
            });
        }
    }

    entries.sort(
        (a, b) => a.parentTitle.localeCompare(b.parentTitle) || a.name.localeCompare(b.name),
    );
    return {
        key: catalog.key,
        name: catalog.name,
        source: 'libretro-database',
        sourceUrl: 'https://github.com/libretro/libretro-database',
        license: 'CC-BY-SA-4.0',
        attribution:
            'Catalog data derived from libretro-database (metadat/no-intro, redump, serial, publisher, developer, genre, releaseyear), © libretro-database contributors, licensed CC-BY-SA-4.0. See LICENSES/libretro-database-LICENSE.txt.',
        datVersion,
        // DAT-based console catalogs aim to cover every physical release.
        complete: true,
        generatedAt: new Date().toISOString(),
        entries,
    };
}

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';

/**
 * Items with no English Wikidata label would otherwise end up named "Q123456"
 * — unfindable in search. Resolve them in bulk (chunked, so responses stay
 * small and fast): English Wikipedia article title first, then any-language
 * label. Anything still unnamed fails the build unless --drop-unnamed is
 * passed (drops the stubs instead of shipping QID-named, unfindable entries).
 */
const NAME_LANGS = ['en', 'mul', 'fr', 'de', 'es', 'it', 'pt', 'ru', 'ja', 'zh', 'ko'];

async function resolveUnnamedTitles(catalogKey, games, dropUnnamed) {
    const unnamed = [...games.entries()].filter(([, game]) => /^Q\d+$/.test(game.name));
    if (unnamed.length === 0) return;
    console.log(`  [${catalogKey}] resolving titles for ${unnamed.length} unlabeled item(s)…`);

    const resolved = new Map();
    for (let i = 0; i < unnamed.length; i += 200) {
        const chunk = unnamed.slice(i, i + 200);
        const values = chunk.map(([qid]) => `wd:${qid}`).join(' ');
        const query = `SELECT ?g ?title ?label WHERE {
  VALUES ?g { ${values} }
  OPTIONAL { ?article schema:about ?g ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?title }
  OPTIONAL { ?g rdfs:label ?label . FILTER(LANG(?label) IN ("${NAME_LANGS.join('","')}")) }
}`;
        const url = `${WIKIDATA_SPARQL}?format=json&query=${encodeURIComponent(query)}`;
        const raw = await fetchWithRetries(url, (text) => {
            try {
                JSON.parse(text);
                return true;
            } catch {
                return false;
            }
        });
        if (!raw)
            throw new Error(`Title resolution query failed for ${catalogKey} chunk ${i / 200}`);
        for (const row of JSON.parse(raw).results?.bindings ?? []) {
            const qid = row.g.value.split('/').pop();
            const article = row.title?.value ?? null;
            const langLabel = row.label
                ? { lang: row.label['xml:lang'], value: row.label.value }
                : null;
            if (!article && !langLabel) continue;
            const best = resolved.get(qid) ?? { article: null, labels: new Map() };
            if (article) best.article ??= article;
            if (langLabel) best.labels.set(langLabel.lang, langLabel.value);
            resolved.set(qid, best);
        }
        await new Promise((r) => setTimeout(r, 400));
    }

    const stillUnnamed = [];
    for (const [qid, game] of unnamed) {
        const best = resolved.get(qid);
        const title =
            best?.article ??
            NAME_LANGS.map((lang) => best?.labels.get(lang)).find((v) => v) ??
            null;
        if (title) {
            game.name = title;
        } else {
            stillUnnamed.push(qid);
        }
    }

    if (stillUnnamed.length > 0) {
        const sample = stillUnnamed.slice(0, 10).join(', ');
        const message = `[${catalogKey}] ${stillUnnamed.length} item(s) have no label in any language and no English Wikipedia article (e.g. ${sample}).`;
        if (dropUnnamed) {
            console.warn(`WARN: ${message} Dropping them — pass nothing to fail instead.`);
            for (const qid of stillUnnamed) games.delete(qid);
        } else {
            throw new Error(
                `${message} Refusing to name them by QID — fix the items on Wikidata or pass --drop-unnamed.`,
            );
        }
    }
}

/**
 * Fetches a Wikidata catalog one year at a time (large multi-year responses
 * get truncated by Node's fetch; single years stay well under that) and
 * collapses rows to one entry per game: earliest year, alphabetically first
 * developer/publisher/genre.
 */
async function buildWikidataCatalog(catalog, { dropUnnamed = false } = {}) {
    const games = new Map();
    const platformValues = catalog.platforms.map((p) => `wd:${p}`).join(' ');
    const validateJson = (text) => {
        try {
            JSON.parse(text);
            return true;
        } catch {
            return false;
        }
    };

    /** Rows for a [start, end) date range, bisecting when the response is too
     * large to arrive intact (single years can still explode via publisher ×
     * genre cross products). */
    const rowsForRange = async (start, end, depth) => {
        const query = `SELECT ?g ?gLabel ?year ?devLabel ?pubLabel ?genreLabel WHERE {
  ?g wdt:P31 wd:Q7889 ; wdt:P400 ?plat ; wdt:P577 ?d ; wdt:P178 ?dev .
  VALUES ?plat { ${platformValues} }
  BIND(YEAR(?d) AS ?year)
  FILTER(?d >= "${start}"^^xsd:dateTime && ?d < "${end}"^^xsd:dateTime)
  OPTIONAL { ?g wdt:P123 ?pub }
  OPTIONAL { ?g wdt:P136 ?genre }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
}`;
        const url = `${WIKIDATA_SPARQL}?format=json&query=${encodeURIComponent(query)}`;
        let raw;
        try {
            raw = await fetchWithRetries(url, validateJson);
        } catch (error) {
            if (depth >= 4) throw error;
            const mid = new Date(
                Date.parse(`${start}T00:00:00Z`) +
                    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 2,
            )
                .toISOString()
                .slice(0, 10);
            console.warn(`    splitting ${start}..${end} at ${mid}`);
            const [left, right] = await Promise.all([
                rowsForRange(start, mid, depth + 1),
                rowsForRange(mid, end, depth + 1),
            ]);
            return [...left, ...right];
        }
        if (!raw) throw new Error(`Wikidata query failed for ${catalog.key} ${start}..${end}`);
        return JSON.parse(raw).results?.bindings ?? [];
    };

    for (let year = 1960; year <= 2031; year++) {
        const start = `${year}-01-01`;
        const end = `${year + 1}-01-01`;
        const bindings = await rowsForRange(start, end, 0);
        if (bindings.length > 0) console.log(`  [${catalog.key}] ${year}: ${bindings.length} rows`);

        for (const row of bindings) {
            const qid = row.g.value.split('/').pop();
            const label = (s) => {
                const value = row[s]?.value ?? '';
                return value && !/^Q\d+$/.test(value) ? value : null;
            };
            const title = label('gLabel') ?? qid;
            const year = Number.parseInt(row.year?.value ?? '', 10);
            const existing = games.get(qid) ?? {
                name: title,
                years: new Set(),
                developers: new Set(),
                publishers: new Set(),
                genres: new Set(),
            };
            if (Number.isFinite(year)) existing.years.add(year);
            const dev = label('devLabel');
            if (dev) existing.developers.add(dev);
            const pub = label('pubLabel');
            if (pub) existing.publishers.add(pub);
            const genre = label('genreLabel');
            if (genre) existing.genres.add(genre);
            games.set(qid, existing);
        }
        await new Promise((r) => setTimeout(r, 400));
    }

    await resolveUnnamedTitles(catalog.key, games, dropUnnamed);

    const first = (set) => [...set].sort((a, b) => a.localeCompare(b))[0] ?? null;
    const entries = [...games.entries()].map(([qid, game]) => ({
        id: qid,
        name: game.name,
        parentTitle: game.name,
        region: null,
        serial: null,
        developer: first(game.developers),
        publisher: first(game.publishers),
        genre: first(game.genres),
        year: game.years.size > 0 ? Math.min(...game.years) : null,
    }));
    entries.sort(
        (a, b) => a.parentTitle.localeCompare(b.parentTitle) || a.name.localeCompare(b.name),
    );

    return {
        key: catalog.key,
        name: catalog.name,
        source: 'Wikidata',
        sourceUrl: 'https://www.wikidata.org',
        license: 'CC0-1.0',
        attribution:
            'Catalog data from Wikidata (SPARQL query service), contributed by the Wikidata community, public domain (CC0). Filtered: only games with a release date and a developer statement are included.',
        datVersion: null,
        // Wikidata is a curated subset, not an exhaustive list of every release.
        complete: false,
        generatedAt: new Date().toISOString(),
        entries,
    };
}

async function writeIndex(outdir) {
    const { readdir } = await import('node:fs/promises');
    const files = (await readdir(outdir)).filter((f) => f.endsWith('.json') && f !== 'index.json');
    const index = [];
    for (const file of files.sort()) {
        const catalog = JSON.parse(await readFile(resolve(outdir, file), 'utf-8'));
        const titles = new Set(catalog.entries.map((e) => e.parentTitle));
        index.push({
            key: catalog.key,
            name: catalog.name,
            source: catalog.source,
            sourceUrl: catalog.sourceUrl,
            license: catalog.license,
            attribution: catalog.attribution,
            datVersion: catalog.datVersion,
            complete: catalog.complete ?? true,
            generatedAt: catalog.generatedAt,
            variantCount: catalog.entries.length,
            titleCount: titles.size,
            file,
        });
    }
    await writeFile(resolve(outdir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
    return index;
}

async function main() {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const args = process.argv.slice(2);
    const onlyIndex = args.indexOf('--only');
    const only = onlyIndex >= 0 ? args[onlyIndex + 1] : undefined;
    const dropUnnamed = args.includes('--drop-unnamed');
    const outdir = resolve(root, 'applications/server/catalogs');

    if (only && !CATALOGS.some((c) => c.key === only)) {
        console.error(`Unknown catalog "${only}". Known: ${CATALOGS.map((c) => c.key).join(', ')}`);
        process.exit(1);
    }

    await mkdir(outdir, { recursive: true });
    for (const catalog of CATALOGS) {
        if (only && catalog.key !== only) continue;
        const built =
            catalog.source === 'wikidata'
                ? await buildWikidataCatalog(catalog, { dropUnnamed })
                : await buildCatalog(catalog);
        const out = resolve(outdir, `${catalog.key}.json`);
        await writeFile(out, `${JSON.stringify(built, null, 2)}\n`);
        const titles = new Set(built.entries.map((e) => e.parentTitle));
        console.log(
            `  -> ${catalog.key}.json: ${built.entries.length} variants / ${titles.size} titles`,
        );
    }

    const index = await writeIndex(outdir);
    console.log(`\nindex.json: ${index.length} catalogs`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
