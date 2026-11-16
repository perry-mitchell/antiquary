import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Router } from 'express';
import archiver from 'archiver';
import extract from 'extract-zip';
import multer from 'multer';
import type { Database, ExportBundle, ExportRow } from '@antiquary/database';
import { HttpError } from '../errors.js';

const EXPORT_FORMAT = 'antiquary-export';
const EXPORT_VERSION = 1;
const MAX_IMPORT_BYTES = 2 * 1024 * 1024 * 1024;

/** Server-generated upload names — blocks path traversal from archive entries. */
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const NDJSON_DATASETS = [
    'collections',
    'templates',
    'templateFields',
    'tags',
    'items',
    'itemFieldValues',
    'itemTags',
    'images',
    'itemHistory',
] as const;

const importUpload = multer({
    storage: multer.diskStorage({
        destination(req, _file, cb) {
            mkdtemp(join(tmpdir(), 'antiquary-import-'))
                .then((dir) => {
                    (req as { importUploadDir?: string }).importUploadDir = dir;
                    cb(null, dir);
                })
                .catch((error) => cb(error, ''));
        },
        filename: (_req, _file, cb) => cb(null, 'archive.zip'),
    }),
    limits: { fileSize: MAX_IMPORT_BYTES, files: 1 },
});

export function transferRoutes(db: Database, uploadDir: string): Router {
    const router = Router();

    /* Export: snapshot every table to NDJSON plus uploaded images in a temp
     * directory, then stream it as a zip. The database is only read. */
    router.get('/export', async (_req, res) => {
        const tmp = await mkdtemp(join(tmpdir(), 'antiquary-export-'));
        let cleanup: Promise<unknown> | undefined;
        const cleanupOnce = () => (cleanup ??= rm(tmp, { recursive: true, force: true }));
        try {
            const bundle = await db.exportAll();
            for (const dataset of NDJSON_DATASETS) {
                const rows = bundle[dataset] as ExportRow[];
                const contents = rows.map((row) => JSON.stringify(row)).join('\n');
                if (contents.length > 0) {
                    await writeFile(join(tmp, `${dataset}.ndjson`), `${contents}\n`);
                }
            }
            await writeFile(
                join(tmp, 'manifest.json'),
                `${JSON.stringify(
                    {
                        format: EXPORT_FORMAT,
                        version: EXPORT_VERSION,
                        exportedAt: new Date().toISOString(),
                        counts: Object.fromEntries(
                            NDJSON_DATASETS.map((dataset) => [
                                dataset,
                                (bundle[dataset] as ExportRow[]).length,
                            ]),
                        ),
                    },
                    null,
                    4,
                )}\n`,
            );

            await mkdir(join(tmp, 'images'), { recursive: true });
            for (const entry of await readdir(uploadDir, { withFileTypes: true })) {
                if (!entry.isFile() || !SAFE_FILENAME.test(entry.name)) continue;
                await copyFile(join(uploadDir, entry.name), join(tmp, 'images', entry.name));
            }

            const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader(
                'Content-Disposition',
                `attachment; filename="antiquary-export-${stamp}.zip"`,
            );
            const archive = archiver('zip', { zlib: { level: 6 } });
            archive.on('warning', (err: Error & { code?: string }) => {
                if (err.code !== 'ENOENT') console.error(err);
            });
            archive.on('error', () => cleanupOnce());
            res.on('close', () => {
                try {
                    archive.abort();
                } catch {
                    /* already finished */
                }
                void cleanupOnce();
            });
            archive.pipe(res);
            archive.directory(tmp, false);
            await archive.finalize();
        } catch (error) {
            void cleanupOnce();
            if (!res.headersSent) throw error;
            res.end();
        }
    });

    /* Import: extract the uploaded archive to a temp directory, ingest the
     * datasets idempotently, copy referenced image files, always clean up. */
    router.post('/import', importUpload.single('file'), async (req, res) => {
        const uploadTmp = (req as { importUploadDir?: string }).importUploadDir;
        const file = req.file;
        const extractDir = await mkdtemp(join(tmpdir(), 'antiquary-extract-'));
        try {
            if (!file) throw new HttpError(400, 'No archive uploaded');

            await extract(file.path, { dir: extractDir });

            let manifest: unknown;
            try {
                manifest = JSON.parse(await readFile(join(extractDir, 'manifest.json'), 'utf8'));
            } catch {
                manifest = null;
            }
            const format = (manifest as { format?: string } | null)?.format;
            if (format !== EXPORT_FORMAT) {
                throw new HttpError(400, 'Not an Antiquary export archive');
            }

            const bundle: ExportBundle = {
                collections: await readNdjson(join(extractDir, 'collections.ndjson')),
                templates: await readNdjson(join(extractDir, 'templates.ndjson')),
                templateFields: await readNdjson(join(extractDir, 'templateFields.ndjson')),
                tags: await readNdjson(join(extractDir, 'tags.ndjson')),
                items: await readNdjson(join(extractDir, 'items.ndjson')),
                itemFieldValues: await readNdjson(join(extractDir, 'itemFieldValues.ndjson')),
                itemTags: await readNdjson(join(extractDir, 'itemTags.ndjson')),
                images: await readNdjson(join(extractDir, 'images.ndjson')),
                itemHistory: await readNdjson(join(extractDir, 'itemHistory.ndjson')),
            };

            const { summary, imageFilenames } = await db.ingestExport(bundle);

            await mkdir(uploadDir, { recursive: true });
            for (const filename of imageFilenames) {
                if (!SAFE_FILENAME.test(filename)) continue;
                const source = join(extractDir, 'images', filename);
                if (await isFile(source)) {
                    await copyFile(source, join(uploadDir, basename(filename)));
                }
            }

            res.json(summary);
        } finally {
            await Promise.allSettled([
                uploadTmp ? rm(uploadTmp, { recursive: true, force: true }) : null,
                rm(extractDir, { recursive: true, force: true }),
            ]);
        }
    });

    return router;
}

async function readNdjson(path: string): Promise<ExportRow[]> {
    let text: string;
    try {
        text = await readFile(path, 'utf8');
    } catch {
        return [];
    }
    const rows: ExportRow[] = [];
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            rows.push(JSON.parse(trimmed) as ExportRow);
        } catch {
            /* skip malformed lines */
        }
    }
    return rows;
}

async function isFile(path: string): Promise<boolean> {
    try {
        return (await stat(path)).isFile();
    } catch {
        return false;
    }
}
