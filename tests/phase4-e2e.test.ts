import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createApp } from '../src/api/server.js';
import { dbService } from '../src/db/database.js';
import { config } from '../src/config.js';
import { WebhookDispatcher } from '../src/webhooks/dispatcher.js';

describe('Phase 4 End-to-End Integration Tests', () => {
  let appServer: http.Server;
  let webhookServer: http.Server;
  let appUrl: string;
  let webhookUrl: string;
  const testDbPath = path.resolve(process.cwd(), 'data', 'test-phase4.db');
  const deliveredEvents: any[] = [];
  const testWebhookSecret = 'whsec_e2e_integration_secret_key_123456';

  before(async () => {
    config.adminApiKey = 'admin_e2e_secret_key_999';
    config.readApiKey = 'read_e2e_secret_key_111';
    config.allowHttpWebhooks = true;
    config.allowLocalhostWebhooks = true;
    config.nodeEnv = 'test';

    // 1. Webhook receiver server
    await new Promise<void>((resolve) => {
      webhookServer = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          let json: any = null;
          try {
            json = JSON.parse(body);
          } catch {}
          deliveredEvents.push({
            headers: req.headers,
            body: json,
            rawBody: body
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
        });
      });
      webhookServer.listen(0, '127.0.0.1', () => {
        const addr: any = webhookServer.address();
        webhookUrl = `http://127.0.0.1:${addr.port}/e2e-webhook`;
        resolve();
      });
    });

    // 2. Initialize fresh DB
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    (dbService as any).dbPath = testDbPath;
    await dbService.init();

    // 3. Start Gateway Server
    const app = createApp();
    await new Promise<void>((resolve) => {
      appServer = app.listen(0, () => {
        const addr: any = appServer.address();
        appUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => appServer.close(() => resolve()));
    await new Promise<void>((resolve) => webhookServer.close(() => resolve()));
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch {}
    }
  });

  test('Full Life Cycle Flow: Key Registration -> Note Indexing -> Webhook Dispatch -> Verification Status', async () => {
    // Step 1: Register Webhook via authenticated API
    const webhookRes = await fetch(`${appUrl}/api/v1/webhooks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.adminApiKey
      },
      body: JSON.stringify({
        target_url: webhookUrl,
        secret: testWebhookSecret,
        description: 'E2E Merchant Integration Hook'
      })
    });
    assert.strictEqual(webhookRes.status, 201);
    const webhookData = await webhookRes.json();
    assert.ok(webhookData.webhook.id);
    assert.strictEqual(webhookData.webhook.target_url, webhookUrl);

    // Step 2: Register Viewing Key via authenticated API
    const rawFvk = 'uviewtest1e2eflow000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
    const keyRes = await fetch(`${appUrl}/api/v1/keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.adminApiKey
      },
      body: JSON.stringify({
        key: rawFvk,
        label: 'E2E Merchant Wallet',
        birth_height: 3800000
      })
    });
    assert.strictEqual(keyRes.status, 201);
    const keyData = await keyRes.json();
    assert.ok(keyData.key.id);
    const keyId = keyData.key.id;

    // Verify key preview is masked and raw key is never exposed
    assert.strictEqual(keyData.key.key_string, undefined);
    assert.ok(keyData.key.key_preview.startsWith('uviewtest1...'));

    // Step 3: Simulate payment detection (verified on-chain simulated payment)
    const simRes = await fetch(`${appUrl}/api/v1/simulator/simulate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.adminApiKey
      },
      body: JSON.stringify({
        key_id: keyId,
        amount_zec: 2.5,
        pool: 'Orchard',
        memo: 'Order #E2E-7729'
      })
    });
    assert.strictEqual(simRes.status, 201);
    const simData = await simRes.json();
    assert.strictEqual(simData.transaction.amount_zec, 2.5);
    assert.strictEqual(simData.transaction.is_simulated, 1);
    assert.strictEqual(simData.transaction.verification_status, 'simulated');

    // Step 4: Verify Webhook was dispatched and received
    assert.strictEqual(deliveredEvents.length, 1);
    const webhookEvent = deliveredEvents[0];

    // Verify Payload structure
    assert.strictEqual(webhookEvent.body.event, 'shielded_note.simulated');
    assert.strictEqual(webhookEvent.body.data.amount_zec, 2.5);
    assert.strictEqual(webhookEvent.body.data.pool, 'Orchard');
    assert.strictEqual(webhookEvent.body.data.memo, 'Order #E2E-7729');
    assert.strictEqual(webhookEvent.body.data.is_simulated, true);
    assert.strictEqual(webhookEvent.body.data.verification_status, 'simulated');

    // Verify Headers & Cryptographic Signature
    assert.strictEqual(webhookEvent.headers['x-zecshield-event'], 'shielded_note.simulated');
    assert.strictEqual(webhookEvent.headers['x-zecshield-simulated'], 'true');
    assert.ok(webhookEvent.headers['x-zecshield-event-id'].startsWith('evt_note_'));

    const expectedSig = crypto
      .createHmac('sha256', testWebhookSecret)
      .update(webhookEvent.rawBody)
      .digest('hex');
    assert.strictEqual(webhookEvent.headers['x-zecshield-signature'], expectedSig);

    // Step 5: Query transactions API to verify indexing status & verification_status
    const txRes = await fetch(`${appUrl}/api/v1/transactions`, {
      headers: { 'X-API-Key': config.readApiKey! }
    });
    assert.strictEqual(txRes.status, 200);
    const txData = await txRes.json();
    assert.ok(txData.transactions.length >= 1);
    const indexedTx = txData.transactions.find((t: any) => t.id === simData.transaction.id);
    assert.ok(indexedTx);
    assert.strictEqual(indexedTx.verification_status, 'simulated');
    assert.strictEqual(indexedTx.is_simulated, 1);

    // Step 6: Verify Delivery history in DB
    const deliveriesRes = await fetch(`${appUrl}/api/v1/webhooks/deliveries`, {
      headers: { 'X-API-Key': config.readApiKey! }
    });
    assert.strictEqual(deliveriesRes.status, 200);
    const deliveriesData = await deliveriesRes.json();
    assert.ok(deliveriesData.deliveries.length >= 1);
    assert.strictEqual(deliveriesData.deliveries[0].status_code, 200);
  });
});
