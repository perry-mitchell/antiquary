process.env.DATABASE_URL ??= 'postgres://antiquary:antiquary@localhost:5432/antiquary_e2e'
process.env.PORT = '3100'

import { mkdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const uploadDir = `${root}uploads-e2e`
const webDist = `${root}applications/web/dist`

await rm(uploadDir, { recursive: true, force: true })
await mkdir(uploadDir, { recursive: true })

process.env.UPLOAD_DIR = uploadDir

const { ensureDatabase, resetDatabase, Database } = await import(
  `${root}packages/database/dist/index.js`
)

await ensureDatabase(process.env.DATABASE_URL)
await resetDatabase(process.env.DATABASE_URL)

const { SupersetRegistry } = await import(`${root}applications/server/dist/supersets.js`)
const supersets = await SupersetRegistry.load()

const { createApp } = await import(`${root}applications/server/dist/app.js`)
const db = new Database(process.env.DATABASE_URL)
const app = createApp({ db, uploadDir, webDist, supersets })

const server = app.listen(3100, () => {
  console.log('[e2e-server] listening on http://localhost:3100')
})

const shutdown = () => {
  server.close(async () => {
    await db.close()
    process.exit(0)
  })
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
