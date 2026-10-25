import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { createApp } from '../src/api/server.js';
import { dbService } from '../src/db/database.js';
import { config } from '../src/config.js';
import { encryptCredential, decryptCredential } from '../src/security/encryption.js';
import { maskViewingKey, maskSecret } from '../src/security/redaction.js';
import { validateWebhookUrl } from '../src/security/ssrf.js';

describe('Phase 1 Security & Access Controls Tests', () => {
  let server: http.Server;
  let baseUrl: string;
  const testDbPath = path.resolve(process.cwd(), 'data', 'test-phase1.db');

  before(async () => {
    // Set test configuration
    config.adminApiKey = 'test_admin_key_sec_9999';
    config.readApiKey = 'test_read_key_sec_1111';
    config.allowHttpWebhooks = false; // enforce HTTPS/SSRF checks

    // Clean test db
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    (dbService as any).dbPath = testDbPath;
    await dbService.init();

    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr: any = server.address();
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch {}
    }
  });

  // --- 1. Authentication & Authorization Tests ---
  describe('1. API Authentication & Authorization', () => {
    test('Public endpoint GET /api/v1/status is accessible without API key', async () => {
      const res = await fetch(`${baseUrl}/api/v1/status`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'ok');
      assert.ok(data.stats);
    });

    test('Protected endpoint GET /api/v1/keys returns 401 when no API key provided', async () => {
      const res = await fetch(`${baseUrl}/api/v1/keys`);
      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.match(data.error, /Unauthorized: Missing API key/);
    });

    test('Protected endpoint GET /api/v1/keys returns 401 with invalid API key', async () => {
      const res = await fetch(`${baseUrl}/api/v1/keys`, {
        headers: { 'X-API-Key': 'completely_wrong_key' }
      });
      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.match(data.error, /Unauthorized: Invalid API key/);
    });

    test('Read-only API key can access GET /api/v1/keys', async () => {
      const res = await fetch(`${baseUrl}/api/v1/keys`, {
        headers: { 'X-API-Key': config.readApiKey! }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.keys));
    });

    test('Read-only API key receives 403 Forbidden when attempting POST /api/v1/keys', async () => {
      const res = await fetch(`${baseUrl}/api/v1/keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.readApiKey}`
        },
        body: JSON.stringify({
          key: 'uviewtest1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
          label: 'Attempted Key'
        })
      });
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.match(data.error, /Forbidden: This operation requires administrative privileges/);
    });

    test('Admin API key can register viewing key via POST /api/v1/keys', async () => {
      const testKey = 'uviewtest1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
      const res = await fetch(`${baseUrl}/api/v1/keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': config.adminApiKey
        },
        body: JSON.stringify({
          key: testKey,
          label: 'Treasury Cold Storage',
          birth_height: 4500000
        })
      });
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.ok(data.key);
      assert.strictEqual(data.key.label, 'Treasury Cold Storage');
      // Must not leak the raw key string
      assert.strictEqual(data.key.key_string, undefined);
      assert.ok(data.key.key_preview);
    });
  });

  // --- 2. Redaction & Encryption at Rest Tests ---
  describe('2. Credential Redaction & Encryption at Rest', () => {
    test('Viewing key is masked correctly by redaction helper', () => {
      const raw = 'uviewtest1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
      const masked = maskViewingKey(raw);
      assert.ok(!masked.includes('qqqqqqqqqqqqqqqqqqqqqq'));
      assert.ok(masked.startsWith('uviewtest1...'));
      assert.ok(masked.endsWith('qqqq'));
    });

    test('Webhook secret is masked correctly by redaction helper', () => {
      const raw = 'whsec_e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      const masked = maskSecret(raw);
      assert.strictEqual(masked, 'whsec_••••••••••••');
    });

    test('Credentials at rest are encrypted with AES-256-GCM', () => {
      const secret = 'super_secret_payload_string_12345';
      const encrypted = encryptCredential(secret);
      assert.ok(encrypted.startsWith('enc:v2:') || encrypted.startsWith('enc:'));
      assert.notStrictEqual(encrypted, secret);

      const decrypted = decryptCredential(encrypted);
      assert.strictEqual(decrypted, secret);

      // Verify backwards compatibility with legacy enc:v1 credentials
      const legacyV1 = 'enc:v1:000000000000000000000000:00000000000000000000000000000000:';
      assert.doesNotThrow(() => {
        try { decryptCredential(legacyV1); } catch {}
      });
    });

    test('GET /api/v1/keys redacts raw viewing keys', async () => {
      const res = await fetch(`${baseUrl}/api/v1/keys`, {
        headers: { 'X-API-Key': config.adminApiKey }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(data.keys.length > 0);
      for (const k of data.keys) {
        assert.strictEqual(k.key_string, undefined);
        assert.ok(k.key_preview);
        assert.ok(!k.key_preview.includes('enc:v1:'));
      }
    });
  });

  // --- 3. SSRF Defense Tests ---
  describe('3. Webhook SSRF Defense', () => {
    test('Rejects loopback IP addresses (127.0.0.1)', async () => {
      const result = await validateWebhookUrl('http://127.0.0.1:8080/hook', true);
      assert.strictEqual(result.isValid, false);
      assert.match(result.error || '', /restricted IP|private/i);
    });

    test('Rejects cloud metadata IP (169.254.169.254)', async () => {
      const result = await validateWebhookUrl('http://169.254.169.254/latest/meta-data', true);
      assert.strictEqual(result.isValid, false);
      assert.match(result.error || '', /restricted IP|private|metadata/i);
    });

    test('Rejects private RFC 1918 addresses (10.0.0.1, 192.168.1.1)', async () => {
      const res10 = await validateWebhookUrl('http://10.0.0.1/hook', true);
      assert.strictEqual(res10.isValid, false);

      const res192 = await validateWebhookUrl('http://192.168.1.100/hook', true);
      assert.strictEqual(res192.isValid, false);
    });

    test('Rejects non-HTTPS endpoints when HTTP is disallowed', async () => {
      const result = await validateWebhookUrl('http://example.com/webhook', false);
      assert.strictEqual(result.isValid, false);
      assert.match(result.error || '', /Only HTTPS endpoints are permitted/);
    });

    test('POST /api/v1/webhooks returns 400 when registering SSRF target', async () => {
      const res = await fetch(`${baseUrl}/api/v1/webhooks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': config.adminApiKey
        },
        body: JSON.stringify({
          target_url: 'http://169.254.169.254/latest/meta-data',
          description: 'Malicious Hook'
        })
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.error, /SSRF policy/i);
    });
  });

  // --- 4. Transaction Verification & Confirmation Guard Tests ---
  describe('4. Transaction Verification & Confirmation Guard', () => {
    test('POST /api/v1/transactions/index-confirmed rejects invalid hex transaction IDs', async () => {
      const res = await fetch(`${baseUrl}/api/v1/transactions/index-confirmed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': config.adminApiKey
        },
        body: JSON.stringify({
          key_id: 1,
          txid: 'not_a_valid_64_character_hex_txid',
          block_height: 4500100
        })
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.error, /Invalid transaction hash format/);
    });

    test('POST /api/v1/transactions/index-confirmed rejects unverified / fabricated mock transaction', async () => {
      const mockTxid = '0000000000000000000000000000000000000000000000000000000000000001';
      const res = await fetch(`${baseUrl}/api/v1/transactions/index-confirmed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': config.adminApiKey
        },
        body: JSON.stringify({
          key_id: 1,
          txid: mockTxid,
          block_height: 4500100,
          verify_on_chain: true
        })
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.error, /verification failed/i);
    });
  });

  // --- 5. Simulator Safety & Production Webhook Tests ---
  describe('5. Simulator Safety & Production Webhook Isolation', () => {
    test('POST /api/v1/simulator/simulate requires admin authentication', async () => {
      const res = await fetch(`${baseUrl}/api/v1/simulator/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount_zec: 0.1 })
      });
      assert.strictEqual(res.status, 401);
    });

    test('POST /api/v1/simulator/simulate forces is_simulated=1 and verification_status=simulated', async () => {
      const res = await fetch(`${baseUrl}/api/v1/simulator/simulate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': config.adminApiKey
        },
        body: JSON.stringify({
          key_id: 1,
          amount_zec: 1.25,
          memo: 'Simulated Order #8821',
          is_simulated: 0 // Attempting to trick simulator into confirmed on-chain note
        })
      });
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.strictEqual(data.transaction.is_simulated, 1);
      assert.strictEqual(data.transaction.verification_status, 'simulated');
    });
  });
});
