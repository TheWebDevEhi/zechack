import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import { dbService } from '../src/db/database.js';
import { encryptCredential, decryptCredential } from '../src/security/encryption.js';
import { config } from '../src/config.js';

describe('Production Credential Persistence & Decryption Continuity Tests', () => {
  const testDbPath = path.resolve(process.cwd(), 'data', 'test-persistence.db');
  const persistentKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'; // 32-byte hex

  before(async () => {
    config.encryptionKey = persistentKey;
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch {}
    }
    (dbService as any).dbPath = testDbPath;
    await dbService.init();
  });

  after(async () => {
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch {}
    }
  });

  test('Credentials encrypted in Session 1 remain decryptable after simulated restart with persistent key', async () => {
    const rawViewingKey = 'uview1test_merchant_unified_viewing_key_0000000000000000000000000000000000000000000000000000000000';
    const rawWebhookSecret = 'whsec_9999999999999999999999999999999999999999999999999999999999999999';

    // Session 1: Encrypt and store records
    const keyRecord = await dbService.addViewingKey(rawViewingKey, 'UFVK', 'Persistence Store Key', 4500000);
    const webhookRecord = await dbService.addWebhook('https://example.com/webhook', rawWebhookSecret, 'Persistence Webhook');

    // Verify that at-rest database storage is encrypted with enc:v2
    const rawKeyRow = (await (dbService as any).client.execute({
      sql: 'SELECT key_string FROM viewing_keys WHERE id = ?',
      args: [keyRecord.id]
    })).rows[0];
    const rawWebhookRow = (await (dbService as any).client.execute({
      sql: 'SELECT secret FROM webhooks WHERE id = ?',
      args: [webhookRecord.id]
    })).rows[0];

    assert.ok((rawKeyRow.key_string as string).startsWith('enc:'));
    assert.ok((rawWebhookRow.secret as string).startsWith('enc:'));

    // Verify raw viewing key and webhook secret decrypt with persistent key
    const decryptedVk1 = decryptCredential(rawKeyRow.key_string as string, persistentKey);
    const decryptedWh1 = decryptCredential(rawWebhookRow.secret as string, persistentKey);
    assert.strictEqual(decryptedVk1, rawViewingKey);
    assert.strictEqual(decryptedWh1, rawWebhookSecret);

    // Simulate Container Redeploy / Process Restart:
    // Close and re-initialize database client with the persistent key from environment
    await dbService.init();

    // Session 2: Read records back from database
    const fetchedKey = await dbService.getViewingKeyById(keyRecord.id);
    const fetchedWebhook = await dbService.getWebhookById(webhookRecord.id);

    assert.ok(fetchedKey);
    assert.ok(fetchedWebhook);
    assert.strictEqual(fetchedKey.key_string, rawViewingKey, 'Viewing key remains 100% decryptable after restart');
    assert.strictEqual(fetchedWebhook.secret, rawWebhookSecret, 'Webhook secret remains 100% decryptable after restart');
  });

  test('Decryption with an incorrect or rotated ephemeral key fails securely', () => {
    const rawData = 'uview1sensitive_data_to_encrypt';
    const encrypted = encryptCredential(rawData, persistentKey);

    const wrongKey = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

    assert.throws(
      () => {
        decryptCredential(encrypted, wrongKey);
      },
      (err: any) => {
        return true; // Must fail decryption and not expose plaintext
      }
    );
  });
});
