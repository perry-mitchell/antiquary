import { sql, type Kysely } from 'kysely';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- kysely migration signature
export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('collections')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('name', 'text', (col) => col.notNull())
        .addColumn('description', 'text')
        .addColumn('emoji', 'text')
        .addColumn('color', 'text')
        .addColumn('parent_id', 'uuid')
        .addForeignKeyConstraint(
            'collections_parent_fk',
            ['parent_id'],
            'collections',
            ['id'],
            (fk) => fk.onDelete('set null'),
        )
        .addColumn('deleted_at', 'timestamptz')
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute();

    await db.schema
        .createTable('templates')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('name', 'text', (col) => col.notNull())
        .addColumn('description', 'text')
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute();

    await db.schema
        .createTable('template_fields')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('template_id', 'uuid', (col) =>
            col.notNull().references('templates.id').onDelete('cascade'),
        )
        .addColumn('name', 'text', (col) => col.notNull())
        .addColumn('type', 'text', (col) => col.notNull())
        .addColumn('options', 'jsonb')
        .addColumn('required', 'boolean', (col) => col.notNull().defaultTo(false))
        .addColumn('position', 'integer', (col) => col.notNull().defaultTo(0))
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute();

    await db.schema
        .createTable('items')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('collection_id', 'uuid', (col) =>
            col.notNull().references('collections.id').onDelete('cascade'),
        )
        .addColumn('template_id', 'uuid', (col) =>
            col.references('templates.id').onDelete('set null'),
        )
        .addColumn('name', 'text', (col) => col.notNull())
        .addColumn('notes', 'text')
        .addColumn('quantity', 'integer', (col) => col.notNull().defaultTo(1))
        .addColumn('is_favorite', 'boolean', (col) => col.notNull().defaultTo(false))
        .addColumn('deleted_at', 'timestamptz')
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute();

    await db.schema
        .createTable('item_field_values')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('item_id', 'uuid', (col) =>
            col.notNull().references('items.id').onDelete('cascade'),
        )
        .addColumn('field_id', 'uuid', (col) =>
            col.notNull().references('template_fields.id').onDelete('cascade'),
        )
        .addColumn('value', 'jsonb', (col) => col.notNull())
        .execute();

    await db.schema
        .createTable('images')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('item_id', 'uuid', (col) =>
            col.notNull().references('items.id').onDelete('cascade'),
        )
        .addColumn('filename', 'text', (col) => col.notNull())
        .addColumn('mime', 'text', (col) => col.notNull())
        .addColumn('size', 'integer', (col) => col.notNull())
        .addColumn('caption', 'text')
        .addColumn('is_cover', 'boolean', (col) => col.notNull().defaultTo(false))
        .addColumn('position', 'integer', (col) => col.notNull().defaultTo(0))
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute();

    await db.schema
        .createTable('tags')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('name', 'text', (col) => col.notNull().unique())
        .addColumn('color', 'text')
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute();

    await db.schema
        .createTable('item_tags')
        .addColumn('item_id', 'uuid', (col) =>
            col.notNull().references('items.id').onDelete('cascade'),
        )
        .addColumn('tag_id', 'uuid', (col) =>
            col.notNull().references('tags.id').onDelete('cascade'),
        )
        .addPrimaryKeyConstraint('item_tags_pk', ['item_id', 'tag_id'])
        .execute();

    await db.schema
        .createTable('item_history')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('item_id', 'uuid', (col) =>
            col.notNull().references('items.id').onDelete('cascade'),
        )
        .addColumn('action', 'text', (col) => col.notNull())
        .addColumn('changes', 'jsonb')
        .addColumn('snapshot', 'jsonb', (col) => col.notNull())
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute();

    await sql`create index items_active_collection_idx on items (collection_id) where deleted_at is null`.execute(
        db,
    );
    await sql`create index items_template_idx on items (template_id)`.execute(db);
    await sql`create index item_field_values_item_idx on item_field_values (item_id)`.execute(db);
    await sql`create index item_field_values_field_idx on item_field_values (field_id)`.execute(db);
    await sql`create index images_item_idx on images (item_id)`.execute(db);
    await sql`create index item_tags_tag_idx on item_tags (tag_id)`.execute(db);
    await sql`create index item_history_item_created_idx on item_history (item_id, created_at desc)`.execute(
        db,
    );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- kysely migration signature
export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('item_history').ifExists().execute();
    await db.schema.dropTable('item_tags').ifExists().execute();
    await db.schema.dropTable('tags').ifExists().execute();
    await db.schema.dropTable('images').ifExists().execute();
    await db.schema.dropTable('item_field_values').ifExists().execute();
    await db.schema.dropTable('items').ifExists().execute();
    await db.schema.dropTable('template_fields').ifExists().execute();
    await db.schema.dropTable('templates').ifExists().execute();
    await db.schema.dropTable('collections').ifExists().execute();
}
