/** Minimal surface of archiver used by the transfer routes. */
declare module 'archiver' {
    import type { Transform } from 'node:stream';

    export interface Archiver extends Transform {
        append(source: string | Buffer, data: { name: string }): this;
        symlink(filepath: string, target: string): this;
        directory(dir: string, destpath?: string | false): this;
        finalize(): Promise<void>;
        abort(): void;
        on(event: 'error', listener: (error: Error) => void): this;
        on(event: 'warning', listener: (error: Error & { code?: string }) => void): this;
    }

    function archiver(format: 'zip', options?: { zlib?: { level?: number } }): Archiver;

    export = archiver;
}
