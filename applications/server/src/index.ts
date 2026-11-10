import { mkdirSync } from 'node:fs';
import { Database } from '@antiquary/database';
import { createApp } from './app.js';
import { config } from './config.js';
import { SupersetRegistry } from './supersets.js';

async function main() {
    mkdirSync(config.uploadDir, { recursive: true });
    const db = new Database(config.databaseUrl);
    const supersets = await SupersetRegistry.load();
    console.log(
        `[antiquary] catalogs: ${supersets
            .list()
            .map((s) => `${s.key} (${s.variantCount} variants)`)
            .join(', ')}`,
    );
    const app = createApp({ db, uploadDir: config.uploadDir, supersets, webDist: config.webDist });
    const server = app.listen(config.port, () => {
        console.log(`[antiquary] listening on http://localhost:${config.port}`);
    });

    const shutdown = () => {
        server.close(async () => {
            await db.close();
            process.exit(0);
        });
        setTimeout(() => process.exit(0), 5000).unref();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
    console.error('[antiquary] fatal:', error);
    process.exit(1);
});
