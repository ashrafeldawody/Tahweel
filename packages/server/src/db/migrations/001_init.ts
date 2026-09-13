import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('devices')
    .addColumn('device_id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('app_version', 'text')
    .addColumn('last_seen_at', 'text', (c) => c.notNull())
    .addColumn('battery', 'integer')
    .addColumn('network', 'text')
    .addColumn('pending_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('last_sms_at', 'text')
    .addColumn('offline_alerted_at', 'text')
    .addColumn('created_at', 'text', (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('sms_messages')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('fingerprint', 'text', (c) => c.notNull().unique())
    .addColumn('device_id', 'text', (c) => c.notNull())
    .addColumn('address', 'text', (c) => c.notNull())
    .addColumn('body', 'text', (c) => c.notNull())
    .addColumn('received_at', 'text', (c) => c.notNull())
    .addColumn('ingested_at', 'text', (c) => c.notNull())
    .addColumn('provider', 'text')
    .addColumn('parsed', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('amount_cents', 'integer')
    .addColumn('sender_phone', 'text')
    .addColumn('sender_name', 'text')
    .addColumn('balance_cents', 'integer')
    .addColumn('reference', 'text')
    .addColumn('status', 'text', (c) => c.notNull())
    .addColumn('intent_id', 'text')
    .addColumn('matched_at', 'text')
    .addColumn('matched_by', 'text')
    .addColumn('note', 'text')
    .execute();
  await db.schema.createIndex('sms_messages_status_idx').on('sms_messages').column('status').execute();
  await db.schema.createIndex('sms_messages_sender_idx').on('sms_messages').column('sender_phone').execute();
  await db.schema.createIndex('sms_messages_received_idx').on('sms_messages').column('received_at').execute();

  await db.schema
    .createTable('payment_intents')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('reference', 'text', (c) => c.notNull().unique())
    .addColumn('amount_cents', 'integer', (c) => c.notNull())
    .addColumn('currency', 'text', (c) => c.notNull())
    .addColumn('sender_phone', 'text')
    .addColumn('allow_amount_only', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('status', 'text', (c) => c.notNull())
    .addColumn('metadata', 'text')
    .addColumn('webhook_url', 'text')
    .addColumn('created_at', 'text', (c) => c.notNull())
    .addColumn('expires_at', 'text', (c) => c.notNull())
    .addColumn('matched_at', 'text')
    .addColumn('matched_message_id', 'text')
    .addColumn('cancelled_at', 'text')
    .execute();
  await db.schema.createIndex('payment_intents_status_idx').on('payment_intents').column('status').execute();
  await db.schema.createIndex('payment_intents_sender_idx').on('payment_intents').column('sender_phone').execute();

  await db.schema
    .createTable('webhook_deliveries')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('event', 'text', (c) => c.notNull())
    .addColumn('url', 'text', (c) => c.notNull())
    .addColumn('payload', 'text', (c) => c.notNull())
    .addColumn('status', 'text', (c) => c.notNull())
    .addColumn('attempts', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('next_attempt_at', 'text')
    .addColumn('last_status_code', 'integer')
    .addColumn('last_error', 'text')
    .addColumn('created_at', 'text', (c) => c.notNull())
    .addColumn('delivered_at', 'text')
    .addColumn('intent_id', 'text')
    .addColumn('message_id', 'text')
    .execute();
  await db.schema
    .createIndex('webhook_deliveries_due_idx')
    .on('webhook_deliveries')
    .columns(['status', 'next_attempt_at'])
    .execute();

  await db.schema
    .createTable('settings')
    .addColumn('key', 'text', (c) => c.primaryKey())
    .addColumn('value', 'text', (c) => c.notNull())
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('settings').execute();
  await db.schema.dropTable('webhook_deliveries').execute();
  await db.schema.dropTable('payment_intents').execute();
  await db.schema.dropTable('sms_messages').execute();
  await db.schema.dropTable('devices').execute();
}
