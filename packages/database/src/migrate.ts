#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileMigrationProvider, Migrator } from 'kysely/migration';
import pg from 'pg';
import { config as loadEnv } from 'dotenv';
import { createKysely } from './db.js';

for (const candidate of ['.env', '../../.env']) {
    loadEnv({ path: path.resolve(process.cwd(), candidate), quiet: true });
}

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(here, 'migrations');

function connectionString(): string {
    const url = process.env.DATABASE_URL;
    if (!url) {
        console.error('DATABASE_URL is not set');
        process.exit(1);
    }
    return url;
}

async function withMigrator<T>(url: string, run: (migrator: Migrator) => Promise<T>): Promise<T> {
    const db = createKysely(url);
    const migrator = new Migrator({
        db,
        provider: new FileMigrationProvider({ fs, path, migrationFolder: migrationsFolder }),
    });
    try {
        return await run(migrator);
    } finally {
        await db.destroy();
    }
}

function report(results: readonly { migrationName: string; status: string }[] | undefined) {
    for (const result of results ?? []) {
        if (result.status === 'Success') {
            console.log(`migration "${result.migrationName}" executed`);
        } else if (result.status === 'Error') {
            console.error(`migration "${result.migrationName}" failed`);
        } else {
            console.log(`migration "${result.migrationName}" ${result.status.toLowerCase()}`);
        }
    }
}

export async function migrateToLatest(url = connectionString()): Promise<void> {
    await withMigrator(url, async (migrator) => {
        const { error, results } = await migrator.migrateToLatest();
        report(results);
        if (error) throw error;
    });
}

export async function migrateDown(url = connectionString()): Promise<void> {
    await withMigrator(url, async (migrator) => {
        const { error, results } = await migrator.migrateDown();
        report(results);
        if (error) throw error;
    });
}

export async function migrationStatus(
    url = connectionString(),
): Promise<{ name: string; executedAt: string | null }[]> {
    return withMigrator(url, async (migrator) => {
        const rows = await migrator.getMigrations();
        return rows.map((r) => ({
            name: r.name,
            executedAt: r.executedAt ? r.executedAt.toISOString() : null,
        }));
    });
}

/** Drops and recreates the public schema, then migrates from scratch. */
export async function resetDatabase(url = connectionString()): Promise<void> {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
        await client.query('drop schema if exists public cascade');
        await client.query('create schema public');
    } finally {
        await client.end();
    }
    await migrateToLatest(url);
}

/** Creates the database if it does not exist yet (used by tests and e2e). */
export async function ensureDatabase(url = connectionString()): Promise<void> {
    const parsed = new URL(url);
    const dbName = parsed.pathname.replace(/^\//, '');
    if (!dbName) throw new Error('DATABASE_URL must include a database name');
    const serverUrl = new URL(url);
    serverUrl.pathname = '/postgres';
    const client = new pg.Client({ connectionString: serverUrl.toString() });
    await client.connect();
    try {
        const exists = await client.query('select 1 from pg_database where datname = $1', [dbName]);
        if (exists.rowCount === 0) {
            await client.query(`create database "${dbName}"`);
            console.log(`created database ${dbName}`);
        }
    } finally {
        await client.end();
    }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
    const command = process.argv[2] ?? 'latest';
    const url = connectionString();
    const commands: Record<string, () => Promise<void>> = {
        latest: () => migrateToLatest(url),
        down: () => migrateDown(url),
        status: async () => {
            const rows = await migrationStatus(url);
            for (const row of rows) {
                console.log(`${row.executedAt ? '[x]' : '[ ]'} ${row.name}`);
            }
        },
    };
    const run = commands[command];
    if (!run) {
        console.error(`Unknown command "${command}". Use: latest | down | status`);
        process.exit(1);
    }
    run().catch((error: unknown) => {
        console.error(error);
        process.exit(1);
    });
}

function pathToFileURL(p: string): URL {
    return new URL(`file://${path.resolve(p)}`);
}
