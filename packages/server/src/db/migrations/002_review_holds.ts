import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('sms_messages').addColumn('reviewed_at', 'text').execute();
  await db.schema.alterTable('sms_messages').addColumn('verification', 'text').execute();
  await db.schema.alterTable('sms_messages').addColumn('expected_balance_cents', 'integer').execute();
  await db.schema
    .createIndex('sms_messages_balance_chain_idx')
    .on('sms_messages')
    .columns(['device_id', 'provider', 'received_at'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('sms_messages_balance_chain_idx').execute();
  await db.schema.alterTable('sms_messages').dropColumn('expected_balance_cents').execute();
  await db.schema.alterTable('sms_messages').dropColumn('verification').execute();
  await db.schema.alterTable('sms_messages').dropColumn('reviewed_at').execute();
}
