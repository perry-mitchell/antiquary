/* eslint-disable @typescript-eslint/no-explicit-any -- kysely migration signature uses Kysely<any> */
import type { ColumnDefinitionBuilder, Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema.alterTable('templates').addColumn('superset', 'text').execute();
    await db.schema.alterTable('items').addColumn('superset', 'text').execute();
    await db.schema.alterTable('items').addColumn('superset_entry', 'text').execute();
    await db.schema
        .alterTable('collections')
        .addColumn('template_id', 'uuid', (col: ColumnDefinitionBuilder) =>
            col.references('templates.id').onDelete('set null'),
        )
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.alterTable('collections').dropColumn('template_id').execute();
    await db.schema.alterTable('items').dropColumn('superset_entry').execute();
    await db.schema.alterTable('items').dropColumn('superset').execute();
    await db.schema.alterTable('templates').dropColumn('superset').execute();
}
