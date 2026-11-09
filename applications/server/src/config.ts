import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'

// When run through npm workspaces the cwd is this package; also try the repo
// root so a single root .env covers dev, tests and e2e.
for (const candidate of ['.env', '../../.env']) {
  loadEnv({ path: resolve(process.cwd(), candidate), quiet: true })
}

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

// Default to the sibling web workspace, resolved relative to this module so it
// works from the repo, from tests and inside the Docker image. config lives one
// level below applications/server (in src/ or dist/), so ../../web/dist is
// correct in every layout.
const here = fileURLToPath(new URL('.', import.meta.url))
const defaultWebDist = resolve(here, '../../web/dist')

export const config = {
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgres://antiquary:antiquary@localhost:5432/antiquary',
  port: int(process.env.PORT, 3000),
  uploadDir: resolve(process.cwd(), process.env.UPLOAD_DIR ?? 'uploads'),
  webDist: process.env.WEB_DIST ? resolve(process.env.WEB_DIST) : defaultWebDist,
}
