/* eslint-disable @typescript-eslint/no-explicit-any -- kysely migration signature uses Kysely<any> */
import { type Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('secrets')
        .addColumn('name', 'text', (col) => col.primaryKey())
        .addColumn('value', 'text', (col) => col.notNull())
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('secrets').ifExists().execute();
}
