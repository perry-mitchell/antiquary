import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import multer from 'multer';

const ALLOWED_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/avif',
]);

const MIME_EXTENSIONS: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/avif': '.avif',
};

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** How long an unattached staged upload survives before it is swept. */
export const STAGING_TTL_MS = 24 * 60 * 60 * 1000;

export function isAllowedImageMime(mime: string): boolean {
    return ALLOWED_MIME_TYPES.has(mime);
}

export function mimeFromFilename(filename: string): string {
    const ext = extname(filename).toLowerCase();
    const found = Object.entries(MIME_EXTENSIONS).find(([, value]) => value === ext);
    return found?.[0] ?? 'application/octet-stream';
}

export function stagingDir(uploadDir: string): string {
    return join(uploadDir, 'staging');
}

/** Staged/uploaded filenames are server-generated uuids — never trust caller paths. */
const UPLOAD_FILENAME =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$/;

export function isUploadFilename(filename: string): boolean {
    return UPLOAD_FILENAME.test(filename);
}

/** Writes an image buffer to the staging area and returns its filename. */
export async function saveStagedImage(
    uploadDir: string,
    data: Buffer,
    mime: string,
): Promise<string> {
    const ext = MIME_EXTENSIONS[mime];
    if (!ext) throw new Error(`Unsupported image type ${mime}`);
    const dir = stagingDir(uploadDir);
    await mkdir(dir, { recursive: true });
    const filename = `${randomUUID()}${ext}`;
    await writeFile(join(dir, filename), data);
    return filename;
}

/** Moves a staged file into the main upload dir. Returns false when missing/invalid. */
export async function promoteStagedImage(uploadDir: string, filename: string): Promise<boolean> {
    if (!isUploadFilename(filename)) return false;
    try {
        await rename(join(stagingDir(uploadDir), filename), join(uploadDir, filename));
        return true;
    } catch {
        return false;
    }
}

/** Best-effort removal of staged uploads older than the TTL. */
export async function sweepStaging(uploadDir: string, ttlMs = STAGING_TTL_MS): Promise<void> {
    const dir = stagingDir(uploadDir);
    let entries: string[];
    try {
        entries = await readdir(dir);
    } catch {
        return;
    }
    const now = Date.now();
    for (const name of entries) {
        try {
            const info = await stat(join(dir, name));
            if (now - info.mtimeMs > ttlMs) {
                await rm(join(dir, name), { force: true });
            }
        } catch {
            /* raced away — ignore */
        }
    }
}

/**
 * Deletes server-generated upload files (uuid names) that no image row
 * references and that are older than the TTL — abandoned uploads from
 * REST/MCP flows that never completed. Staged files use the shorter staging
 * TTL, the main upload dir the longer one.
 */
export async function sweepOrphanedUploads(
    uploadDir: string,
    referencedFilenames: string[],
    opts: { mainTtlMs?: number } = {},
): Promise<number> {
    const mainTtl = opts.mainTtlMs ?? 7 * 24 * 60 * 60 * 1000;
    const referenced = new Set(referencedFilenames);
    const now = Date.now();
    let removed = 0;
    for (const [dir, ttl] of [
        [uploadDir, mainTtl],
        [stagingDir(uploadDir), STAGING_TTL_MS],
    ] as const) {
        let entries: string[];
        try {
            entries = await readdir(dir);
        } catch {
            continue;
        }
        for (const name of entries) {
            if (!isUploadFilename(name) || referenced.has(name)) continue;
            try {
                const info = await stat(join(dir, name));
                if (now - info.mtimeMs > ttl) {
                    await rm(join(dir, name), { force: true });
                    removed++;
                }
            } catch {
                /* raced away — ignore */
            }
        }
    }
    return removed;
}

function sanitizeExtension(originalName: string): string {
    const ext = extname(originalName).toLowerCase();
    return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '';
}

export function createUploadMiddleware(uploadDir: string) {
    const storage = multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, uploadDir),
        filename: (_req, file, cb) =>
            cb(null, `${randomUUID()}${sanitizeExtension(file.originalname)}`),
    });
    return multer({
        storage,
        limits: { fileSize: MAX_IMAGE_BYTES, files: 10 },
        fileFilter: (_req, file, cb) => {
            if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
                cb(null, true);
            } else {
                cb(new Error(`Unsupported file type ${file.mimetype}`));
            }
        },
    });
}
