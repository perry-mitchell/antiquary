import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** One physical release variant in a bundled catalog. */
export interface SupersetEntry {
  id: string
  name: string
  parentTitle: string
  region: string | null
  serial: string | null
  developer: string | null
  publisher: string | null
  genre: string | null
  year: number | null
}

interface CatalogFile {
  key: string
  name: string
  entries: SupersetEntry[]
}

interface IndexEntry {
  key: string
  name: string
  source: string
  sourceUrl: string
  license: string
  attribution: string
  datVersion: string | null
  generatedAt: string
  variantCount: number
  titleCount: number
  file: string
}

export type SupersetInfo = Omit<IndexEntry, 'file'>

export interface SupersetSearchResult {
  title: string
  variants: SupersetEntry[]
}

export interface SupersetCompletion {
  owned: number
  total: number
  percent: number
}

/** How many catalog files may stay parsed in memory at once. */
const MAX_CACHED_CATALOGS = 4

/**
 * Serves bundled superset catalogs. Only the lightweight index.json is read
 * at boot; individual catalog files (~1–3 MB each) are parsed lazily on
 * first use and kept in a small LRU, so memory stays low no matter how many
 * catalogs are bundled.
 */
export class SupersetRegistry {
  private readonly dir: string
  private readonly index = new Map<string, IndexEntry>()
  private readonly cache = new Map<string, CatalogFile>()

  private constructor(dir: string, index: IndexEntry[]) {
    this.dir = dir
    for (const entry of index) this.index.set(entry.key, entry)
  }

  static async load(dir: string = defaultCatalogDir()): Promise<SupersetRegistry> {
    let index: IndexEntry[]
    try {
      index = JSON.parse(await readFile(join(dir, 'index.json'), 'utf-8')) as IndexEntry[]
    } catch {
      throw new Error(`No catalogs index found in ${dir} — run "npm run catalog:build"`)
    }
    if (index.length === 0) {
      throw new Error(`Catalogs index in ${dir} is empty — run "npm run catalog:build"`)
    }
    return new SupersetRegistry(dir, index)
  }

  list(): SupersetInfo[] {
    return [...this.index.values()].map(({ file: _file, ...info }) => info)
  }

  get(key: string): SupersetInfo | null {
    const entry = this.index.get(key)
    return entry ? (({ file: _file, ...info }) => info)(entry) : null
  }

  async getEntry(key: string, id: string): Promise<SupersetEntry | null> {
    const catalog = await this.withCatalog(key)
    return catalog?.entries.find((entry) => entry.id === id) ?? null
  }

  /** Free-text search across titles, variant names and serials, grouped by title. */
  async search(key: string, query: string, maxTitles = 8): Promise<SupersetSearchResult[]> {
    const catalog = await this.withCatalog(key)
    if (!catalog) return []
    const needle = query.trim().toLowerCase()
    if (needle.length === 0) return []

    const groups = new Map<string, SupersetEntry[]>()
    for (const entry of catalog.entries) {
      const titleMatch = entry.parentTitle.toLowerCase().includes(needle)
      const serialMatch = entry.serial?.toLowerCase().includes(needle) ?? false
      const nameMatch = entry.name.toLowerCase().includes(needle)
      if (!titleMatch && !serialMatch && !nameMatch) continue
      const list = groups.get(entry.parentTitle) ?? []
      list.push(entry)
      groups.set(entry.parentTitle, list)
    }

    return [...groups.entries()]
      .sort((a, b) => {
        const aPrefix = a[0].toLowerCase().startsWith(needle) ? 0 : 1
        const bPrefix = b[0].toLowerCase().startsWith(needle) ? 0 : 1
        return aPrefix - bPrefix || a[0].localeCompare(b[0])
      })
      .slice(0, maxTitles)
      .map(([title, variants]) => ({
        title,
        variants: [...variants].sort((a, b) => a.name.localeCompare(b.name)),
      }))
  }

  private async withCatalog(key: string): Promise<CatalogFile | null> {
    const info = this.index.get(key)
    if (!info) return null

    const cached = this.cache.get(key)
    if (cached) {
      // refresh LRU position
      this.cache.delete(key)
      this.cache.set(key, cached)
      return cached
    }

    const catalog = JSON.parse(await readFile(join(this.dir, info.file), 'utf-8')) as CatalogFile
    this.cache.set(key, catalog)
    while (this.cache.size > MAX_CACHED_CATALOGS) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) break
      this.cache.delete(oldest)
    }
    return catalog
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
  const info = registry.get(supersetKey)
  if (!info) return null
  const titles = new Set<string>()
  for (const match of matches) {
    if (match.superset !== supersetKey) continue
    const entry = await registry.getEntry(supersetKey, match.supersetEntry)
    if (entry) titles.add(entry.parentTitle)
  }
  return {
    owned: titles.size,
    total: info.titleCount,
    percent: info.titleCount > 0 ? Math.round((titles.size / info.titleCount) * 1000) / 10 : 0,
  }
}

export function defaultCatalogDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../catalogs')
}
