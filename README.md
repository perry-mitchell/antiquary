# Antiquary

Antiquary — a self-hosted collection manager for anything you own — books, records, games, coins, cameras.
Inspired by [Koillection](https://github.com/koillection/koillection), rebuilt on a modern stack
with a friendlier UI, reusable templates, soft deletes with a trash bin, and a full change
history on every item.

## Features

- **Collections** with emoji icon, color and description
- **Templates** — reusable sets of custom fields (text, long text, number, date, URL, choice,
  1–5 rating, yes/no, image, price). Prices carry amount **and currency, chosen when the item
  is filled in**; image fields accept an upload or a pasted URL. Templates can be edited
  without losing the data items already carry
- **Settings with MCP access** — create named API keys for AI clients (Claude, Cursor, …)
  that talk to your collection over the Model Context Protocol at `POST /mcp`
  (streamable HTTP). Keys are shown once and stored hashed; **read-only keys are
  non-destructive** — every write and deletion action is dropped from the MCP API
  for them. Revocable at any time
- **Superset catalogs** — bind a template to one of **93 bundled catalogs** (NES, SNES, N64,
  Game Boy/Color/Advance, DS/DSi/3DS, Mega Drive, Saturn, Dreamcast, PS1–PS3, PSP, Vita,
  PC Engine, Xbox(+360), Atari, Commodore, MSX, **PC (Windows) and DOS** and dozens more —
  137k variants in total). Items must match a known title + variant before saving; the match
  prefills Region, Serial, Developer, Publisher, Genre and Year (all still editable), and the
  item remembers which variant it is. Collections bound to a catalog template show a completion
  percentage. Catalogs load lazily (index at boot, per-catalog on first use, small LRU) to keep
  memory low. Console data from
  [libretro-database](https://github.com/libretro/libretro-database) (CC-BY-SA-4.0); PC/DOS
  data from [Wikidata](https://www.wikidata.org) (CC0) — see
  `applications/server/catalogs/CREDITS.md`
- **Items** with photos (upload, cover, gallery), tags, quantity, favorites and notes
- **Soft deletes everywhere** — deleting an item _or_ a collection moves it (and its items) to
  the trash, where everything is restorable. "Delete forever" is a separate, explicit action
- **Item history** — every change is recorded as an event with a field-by-field diff and a full
  snapshot of the item at that point in time
- **Search** across item names, notes _and_ custom field values
- Dashboard with stats and recently added items, per-collection search, sort, tag and
  favorites filters, light/dark mode

## Stack

| Layer    | Tech                                                                                                      |
| -------- | --------------------------------------------------------------------------------------------------------- |
| API      | Node.js, TypeScript, Express 5, Zod, Multer                                                               |
| Database | PostgreSQL, [Kysely](https://kysely.dev) (all access through the `Database` class in `packages/database`) |
| Web      | React 19, Vite, [Radix UI Themes](https://www.radix-ui.com/), React Router                                |
| Tests    | Vitest (unit + API), Playwright with headless Firefox (e2e)                                               |
| Tooling  | npm workspaces, ESLint 10 (flat config), Prettier                                                         |

## Repository layout

```
applications/
  collector/   Express API server ("main service") — serves the API, uploads and the built web app
  web/         React + Radix Themes frontend (Vite)
packages/
  database/    Kysely schema, migrations, migrate CLI, and the Database class
  eslint/      Shared ESLint flat config
  tsconfig/    Shared TypeScript configs
e2e/           Playwright specs (Firefox headless)
scripts/       e2e server bootstrap
```

## Quick start (Docker)

```bash
docker compose up --build
```

Starts PostgreSQL and the app on <http://localhost:3000>. The app container runs migrations
automatically on boot. Uploaded photos land in `./uploads` (bind-mounted into the container,
pre-created in the repo and contents git-ignored) and the database lives in a named volume.

## Development

Requirements: Node 20+, Docker (for PostgreSQL), and a copy of `.env`:

```bash
cp .env.example .env       # defaults point at the compose db
docker compose up -d db    # postgres only
npm install
npm run migrate            # create tables
npm run dev                # API on :3000 + web dev server on :5173
```

Open <http://localhost:5173> (the dev server proxies `/api` and `/uploads` to the API).

### Common commands

| Command                 | What it does                                                        |
| ----------------------- | ------------------------------------------------------------------- |
| `npm run dev`           | API (`tsx watch`) + Vite dev server concurrently                    |
| `npm run build`         | Build all workspaces (db, server, web)                              |
| `npm test`              | Unit + API tests (Vitest, against a real Postgres)                  |
| `npm run test:e2e`      | Build everything, then run Playwright e2e (Firefox, headless)       |
| `npm run lint`          | ESLint across the repo                                              |
| `npm run format`        | Prettier                                                            |
| `npm run typecheck`     | `tsc --noEmit` in every workspace                                   |
| `npm run migrate`       | Apply pending migrations (`migrate:down`, `migrate:status` too)     |
| `npm run catalog:build` | Regenerate the bundled superset catalogs (`-- --only snes` for one) |

Tests use throwaway databases (`collector_test`, `collector_e2e`) that are created and reset
automatically.

## API overview

All endpoints are JSON under `/api`. A quick tour:

```
GET    /api/stats                          dashboard numbers + recent items
GET    /api/collections                    list with item counts
POST   /api/collections                    create
PATCH  /api/collections/:id                update
DELETE /api/collections/:id                soft delete (items follow it to the trash)
POST   /api/collections/:id/restore        restore collection + its trashed items
DELETE /api/collections/:id?permanent=true hard delete (trash only)

GET    /api/templates                      list with field + usage counts
POST   /api/templates                      create with fields
PATCH  /api/templates/:id                  update (fields carry their `id` so values survive)
DELETE /api/templates/:id                  blocked with 409 while items use it

GET    /api/items?search=&sort=&order=&favorite=&tagId=&page=&limit=
POST   /api/items                          create (validates field values against the template)
GET    /api/items/:id                      detail: fields + values, images, tags
PATCH  /api/items/:id                      update (records a diff event when something changed)
DELETE /api/items/:id                      soft delete → trash
POST   /api/items/:id/restore              restore from trash
DELETE /api/items/:id?permanent=true       hard delete (trash only)
GET    /api/items/:id/history              full event log with diffs + snapshots

POST   /api/items/:id/images               multipart upload (field `images`, max 10 × 10 MB)
POST   /api/images                         standalone upload (field `image`) — used by image fields
PATCH  /api/images/:imageId                caption / set cover
DELETE /api/images/:imageId

GET    /api/tags   POST /api/tags   PATCH /api/tags/:id   DELETE /api/tags/:id
GET    /api/trash                          trashed items + collections
GET    /api/supersets                      bundled catalogs (with counts + attribution)
GET    /api/supersets/:key/search?q=       title search, grouped by variant
GET    /api/supersets/:key/entries/:id     a single catalog variant
GET    /api/health
```

## Superset workflow

1. **New template** → add your own fields → set _superset_ to the SNES catalog → create.
   Region, Serial, Developer, Publisher, Genre and Year fields are added automatically.
2. **New collection** → pick that template as the collection's default.
3. **Add item** → search the catalog ("chrono tr…"), pick the title, pick the variant
   (region/serial) — this match is required before saving — then adjust anything and save.

## MCP (Model Context Protocol)

Settings → MCP access lets you create API keys for MCP clients. Configure a client with:

- **URL**: `http://localhost:3000/mcp`
- **Authorization**: `Bearer mcp_…` (the key shown once at creation)

Tools cover browsing (`search_items`, `get_item`, `search_catalog`, `list_*`, `get_stats`)
plus, for full keys, writes (`create_item`, `update_item`, `create_collection`, `create_tag`)
and deletion actions (`trash_*`, `restore_*`, `purge_*` — always soft-delete first).
**Read-only keys are non-destructive**: those tools are not exposed at all, so an AI
client physically cannot delete or modify anything.

## Design notes

- **Every write to an item goes through `Database`** (`packages/database/src/db.ts`), which owns
  the Kysely instance, all queries, validation of field values, and the history/snapshot logic.
  Route handlers stay thin and HTTP-shaped.
- **Soft deletes**: `deleted_at` columns on items and collections. Trashing a collection stamps
  its items with the _same_ timestamp; restoring matches on it, so independently trashed items
  stay in the trash. History is recorded for delete/restore too.
- **History**: `item_history` stores an action, an array of `{field, from, to}` changes, and a
  complete JSON snapshot of the item after the event.
- **Templates vs values**: values reference template fields; editing a template keeps values for
  fields that survive (matched by field id) and drops the rest. A template used by any item
  (even a trashed one) cannot be deleted.

## License

MIT
