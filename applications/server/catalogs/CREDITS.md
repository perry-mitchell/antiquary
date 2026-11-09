# Bundled catalogs

This directory contains superset catalogs bundled with Collector — reference
datasets a template can be bound to, so items can be matched against known
titles and variants.

All catalogs are regenerated together:

```bash
npm run catalog:build              # everything (DAT downloads are cached in .catalog-cache/)
npm run catalog:build -- --only snes
```

The builder writes one `<key>.json` per system plus `index.json`, a small
summary the API reads at boot. Individual catalog files are loaded lazily on
first use, so memory stays low no matter how many catalogs are bundled.

## Catalogs (93)

Nintendo — nes, fds, snes, satellaview, sufami, n64, n64dd, virtualboy, gb,
gbc, gba, ereader, nds, dsi, n3ds (3DS + New 3DS), pokemonmini, wiiu, gamecube, wii

Sega — sg1000, sms (Master System / Mark III), megadrive (Mega Drive / Genesis),
pico, beena, sega32x, gamegear, megacd (Mega-CD / Sega CD), saturn, dreamcast

Sony — ps1, ps2, ps3, psp, vita · Microsoft — xbox, xbox360

NEC — pce (PC Engine / TurboGrafx-16 / SuperGrafx), pcecd, pcfx, pc98

Atari — atari2600, atari5200, atari7800, atari8bit, lynx, jaguar, jaguarcd, atarist

Commodore — c64, vic20, plus4, amiga, cd32, cdtv · Computers — msx, msx2,
zxspectrum3, x1, x68000, fmtowns

SNK — ngp, ngpc, neogeocd · Bandai — wonderswan, wonderswancolor

Classic & dedicated — colecovision, intellivision, odyssey2 (Odyssey² /
Videopac+), vectrex, channelf, arcadia, adventurevision, vc4000, studio2,
supervision, gamecom, gp32, arduboy, creativision, vsmile, loopy, pv1000, scv,
acan, gamemaster, picno, leappad, leapster, pocketchallenge, cdi, 3do

PC (Wikidata, CC0) — pc (Microsoft Windows, ~21k titles filtered to games
with a release date and a developer), dos (~1.6k on the same filter). One
entry per title; no regional variants or serials. See the note in
`scripts/generate-catalogs.mjs` for exactly what is filtered out.

Regional twins of the same console are combined (e.g. Mega Drive + Genesis;
PC Engine + TurboGrafx-16 + SuperGrafx; Odyssey² + Videopac+); separate
consoles stay separate (Game Boy vs Game Boy Color vs GBA). Intentionally
skipped: mobile phone platforms (J2ME/Palm/Symbian/Zeebo), pure digital
storefront lists (except Wii U, which is digital-only), UMD music/video,
title updates, download play and arcade boards (Naomi).

## Credits and licensing

Console/computer catalogs are derived from
[libretro-database](https://github.com/libretro/libretro-database), © its
contributors, licensed
[CC-BY-SA-4.0](https://creativecommons.org/licenses/by-sa/4.0/) (full text in
`LICENSES/libretro-database-LICENSE.txt`). Sources per system are declared
explicitly in `scripts/generate-catalogs.mjs`; the underlying files live
under `metadat/` (no-intro, redump, serial, publisher, developer, genre,
releaseyear).

The `pc` and `dos` catalogs are derived from
[Wikidata](https://www.wikidata.org) via its SPARQL query service, © Wikidata
contributors, [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

The merged catalogs and the scripts that produce them are kept openly
available in this repository, which satisfies the share-alike requirement of
CC-BY-SA.

## Output format

One JSON file per system:

```json
{
  "key": "snes",
  "name": "Super Nintendo Entertainment System",
  "source": "libretro-database",
  "license": "CC-BY-SA-4.0",
  "attribution": "…",
  "datVersion": "2026.10.07",
  "generatedAt": "…",
  "entries": [
    {
      "id": "2D206BF7",
      "name": "Chrono Trigger (USA)",
      "parentTitle": "Chrono Trigger",
      "region": "USA",
      "serial": "SNS-ACTE-USA",
      "developer": "Square",
      "publisher": "Square",
      "genre": "Role-playing (RPG)",
      "year": 1995
    }
  ]
}
```

`id` is the ROM CRC-32 (stable variant identity); `parentTitle` collapses
regional variants under one title. `index.json` mirrors the metadata fields
plus `variantCount`, `titleCount` and `file` for each catalog.
