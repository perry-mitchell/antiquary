/* eslint-disable @typescript-eslint/no-explicit-any -- kysely migration signature uses Kysely<any> */
import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('wanted')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('superset', 'text', (col) => col.notNull())
        .addColumn('superset_entry', 'text', (col) => col.notNull())
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addUniqueConstraint('wanted_superset_entry_unique', ['superset', 'superset_entry'])
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('wanted').ifExists().execute();
}
