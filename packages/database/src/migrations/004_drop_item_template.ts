/* eslint-disable @typescript-eslint/no-explicit-any -- kysely migration signature uses Kysely<any> */
import type { Kysely } from 'kysely'

/** Templates live on collections only; items inherit their collection's template. */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('items').dropColumn('template_id').execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('items')
    .addColumn('template_id', 'uuid', (col) => col.references('templates.id').onDelete('set null'))
    .execute()
}
