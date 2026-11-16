import yauzl from 'yauzl';
import { HttpError } from './errors.js';

/** Archives are data, not code: no symlinks, no special files, no bombs. */
const MAX_ENTRIES = 200_000;
const MAX_UNCOMPRESSED_BYTES = 10 * 1024 * 1024 * 1024;

const REGULAR = 0o100000;
const DIRECTORY = 0o040000;

/**
 * Scans a zip's central directory before extraction and rejects archives that
 * contain symlink or other special-file entries (a materialised symlink lets
 * later duplicate-named entries write outside the extraction directory),
 * encrypted entries, or more decompressed data than we are willing to store.
 * Regular files and directories always pass.
 */
export function validateArchive(zipPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (error, zipfile) => {
            if (error || !zipfile) {
                reject(new HttpError(400, 'Could not read the uploaded archive'));
                return;
            }
            let entries = 0;
            let totalBytes = 0;
            let settled = false;
            const fail = (message: string) => {
                if (settled) return;
                settled = true;
                zipfile.close();
                reject(new HttpError(400, message));
            };
            zipfile.on('error', () => fail('Could not read the uploaded archive'));
            zipfile.on('end', () => {
                if (!settled) {
                    settled = true;
                    resolve();
                }
            });
            zipfile.on('entry', (entry: yauzl.Entry) => {
                entries++;
                if (entries > MAX_ENTRIES) {
                    fail('Archive has too many entries');
                    return;
                }
                if (entry.isEncrypted()) {
                    fail('Archive contains encrypted entries');
                    return;
                }
                const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
                const type = mode & 0xf000;
                if (mode !== 0 && type !== REGULAR && type !== DIRECTORY) {
                    fail('Archive contains symlink or special file entries');
                    return;
                }
                totalBytes += entry.uncompressedSize;
                if (totalBytes > MAX_UNCOMPRESSED_BYTES) {
                    fail('Archive is too large when decompressed');
                    return;
                }
                zipfile.readEntry();
            });
            zipfile.readEntry();
        });
    });
}
