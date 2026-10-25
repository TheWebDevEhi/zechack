import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { dbService, ShieldedNoteRecord } from '../src/db/database.js';
import { WebhookDispatcher } from '../src/webhooks/dispatcher.js';
import { config } from '../src/config.js';

describe('Phase 3 Webhook Delivery & Multi-Note Deduplication Tests', () => {
  let webhookReceiverServer: http.Server;
  let receiverUrl: string;
  const receivedRequests: Array<{
    headers: http.IncomingHttpHeaders;
    body: any;
    rawBody: string;
  }> = [];

  const testDbPath = path.resolve(process.cwd(), 'data', 'test-phase3.db');
  const webhookSecret = 'whsec_test_secret_key_multi_note_987654321';

  before(async () => {
    config.allowHttpWebhooks = true;
    config.allowLocalhostWebhooks = true;
    config.nodeEnv = 'test';

    // Start local webhook receiver server
    await new Promise<void>((resolve) => {
      webhookReceiverServer = http.createServer(async (req, res) => {
        let bodyStr = '';
        req.on('data', (chunk) => {
          bodyStr += chunk;
        });
        req.on('end', () => {
          let parsed: any = null;
          try {
            parsed = JSON.parse(bodyStr);
          } catch {}
          receivedRequests.push({
            headers: req.headers,
            body: parsed,
            rawBody: bodyStr
          });

          // Check if caller requested simulated failure
          if (req.url === '/fail') {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal receiver error' }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'delivered' }));
          }
        });
      });

      webhookReceiverServer.listen(0, '127.0.0.1', () => {
        const addr: any = webhookReceiverServer.address();
        receiverUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    (dbService as any).dbPath = testDbPath;
    await dbService.init();
  });

  after(async () => {
    await new Promise<void>((resolve) => webhookReceiverServer.close(() => resolve()));
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch {}
    }
  });

  // --- 1. Multi-Note Transaction Delivery (Issue 7) ---
  describe('1. Multi-Note Webhook Delivery & Deduplication', () => {
    test('A transaction containing multiple output notes delivers webhooks for all notes independently', async () => {
      receivedRequests.length = 0;

      // 1. Register test webhook
      const webhook = await dbService.addWebhook(
        `${receiverUrl}/webhook-endpoint`,
        webhookSecret,
        'Multi-Note Test Webhook'
      );

      // 2. Setup viewing key
      const key = await dbService.addViewingKey(
        'uviewtest1multinote0000000000000000000000000000000000000000000000000000000000000000000000000000000000',
        'UFVK',
        'Multi-Note Key',
        4000000
      );

      const sharedTxid = 'e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2';

      // 3. Insert Note 1 (0.8 ZEC) in sharedTxid
      const note1 = await dbService.addShieldedNote({
        key_id: key.id,
        txid: sharedTxid,
        block_height: 4000010,
        block_hash: 'block_4000010_hash',
        block_time: Math.floor(Date.now() / 1000),
        pool: 'Orchard',
        amount_zat: 80_000_000,
        amount_zec: 0.8,
        transfer_type: 'incoming',
        memo_text: 'Invoice 101 Payment Note 1',
        is_simulated: 0,
        verification_status: 'confirmed'
      });
      assert.ok(note1);

      // 4. Insert Note 2 (1.2 ZEC) in same sharedTxid
      const note2 = await dbService.addShieldedNote({
        key_id: key.id,
        txid: sharedTxid,
        block_height: 4000010,
        block_hash: 'block_4000010_hash',
        block_time: Math.floor(Date.now() / 1000),
        pool: 'Orchard',
        amount_zat: 120_000_000,
        amount_zec: 1.2,
        transfer_type: 'incoming',
        memo_text: 'Invoice 101 Payment Note 2',
        is_simulated: 0,
        verification_status: 'confirmed'
      });
      assert.ok(note2);

      // 5. Dispatch both notes
      await WebhookDispatcher.dispatchNote(note1);
      await WebhookDispatcher.dispatchNote(note2);

      // Verify both webhooks were dispatched despite having the exact same txid!
      assert.strictEqual(receivedRequests.length, 2, 'Both notes must trigger independent webhooks');

      // Verify Note 1 payload and headers
      const delivery1 = receivedRequests[0];
      assert.strictEqual(delivery1.body.data.note_id, note1.id);
      assert.strictEqual(delivery1.body.data.txid, sharedTxid);
      assert.strictEqual(delivery1.body.data.amount_zec, 0.8);
      assert.strictEqual(delivery1.body.event, 'shielded_note.confirmed');
      assert.strictEqual(delivery1.headers['x-zecshield-event'], 'shielded_note.confirmed');
      assert.strictEqual(delivery1.headers['x-zecshield-event-id'], `evt_note_${note1.id}_${sharedTxid.slice(0, 10)}`);

      // Verify Note 2 payload and headers
      const delivery2 = receivedRequests[1];
      assert.strictEqual(delivery2.body.data.note_id, note2.id);
      assert.strictEqual(delivery2.body.data.txid, sharedTxid);
      assert.strictEqual(delivery2.body.data.amount_zec, 1.2);
      assert.strictEqual(delivery2.body.event, 'shielded_note.confirmed');
      assert.strictEqual(delivery2.headers['x-zecshield-event'], 'shielded_note.confirmed');
      assert.strictEqual(delivery2.headers['x-zecshield-event-id'], `evt_note_${note2.id}_${sharedTxid.slice(0, 10)}`);

      // Verify distinct event IDs
      assert.notStrictEqual(delivery1.body.event_id, delivery2.body.event_id);
    });

    test('Exact duplicate note re-dispatch is deduplicated', async () => {
      const initialCount = receivedRequests.length;

      // Fetch Note 1 from previous test
      const notes = await dbService.getShieldedNotes(10);
      assert.ok(notes.length >= 2);
      const note1 = notes[0];

      // Attempt to dispatch note1 again
      await WebhookDispatcher.dispatchNote(note1);

      // Verify no new webhook was sent
      assert.strictEqual(
        receivedRequests.length,
        initialCount,
        'Duplicate delivery must be suppressed by (webhook_id, note_id) check'
      );
    });

    test('HMAC-SHA256 signature matches payload and secret', async () => {
      assert.ok(receivedRequests.length > 0);
      const req = receivedRequests[0];
      const sentSignature = req.headers['x-zecshield-signature'];
      assert.ok(sentSignature);

      // Compute expected HMAC
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(req.rawBody)
        .digest('hex');

      assert.strictEqual(sentSignature, expectedSignature);
    });

    test('Internal change notes do not trigger webhooks', async () => {
      const initialCount = receivedRequests.length;
      const key = (await dbService.getViewingKeys())[0];

      const changeNote = await dbService.addShieldedNote({
        key_id: key.id,
        txid: '9999999999999999999999999999999999999999999999999999999999999999',
        block_height: 4000020,
        block_time: Math.floor(Date.now() / 1000),
        pool: 'Orchard',
        amount_zat: 15_000_000,
        amount_zec: 0.15,
        transfer_type: 'internal', // wallet change note
        memo_text: '',
        is_simulated: 0,
        verification_status: 'confirmed'
      });
      assert.ok(changeNote);

      await WebhookDispatcher.dispatchNote(changeNote);

      // Verify nothing dispatched
      assert.strictEqual(receivedRequests.length, initialCount, 'Internal change notes must be ignored');
    });
  });

  // --- 2. Retry Logic & Delivery Auditing ---
  describe('2. Delivery Logging & Retry on Failure', () => {
    test('Failing destination logs attempts to webhook_deliveries table', async () => {
      // Register a failing webhook
      const failingWebhook = await dbService.addWebhook(
        `${receiverUrl}/fail`,
        'whsec_fail_test_123',
        'Failing Webhook'
      );

      const key = (await dbService.getViewingKeys())[0];
      const testNote = await dbService.addShieldedNote({
        key_id: key.id,
        txid: '8888888888888888888888888888888888888888888888888888888888888888',
        block_height: 4000030,
        block_time: Math.floor(Date.now() / 1000),
        pool: 'Sapling',
        amount_zat: 25_000_000,
        amount_zec: 0.25,
        transfer_type: 'incoming',
        memo_text: 'Failing destination test',
        is_simulated: 0,
        verification_status: 'confirmed'
      });
      assert.ok(testNote);

      await WebhookDispatcher.dispatchNote(testNote);

      // Check deliveries in DB
      const deliveries = await dbService.getWebhookDeliveries(50);
      const failDeliveries = deliveries.filter((d) => d.webhook_id === failingWebhook.id);

      assert.ok(failDeliveries.length > 0, 'Failures must be recorded in webhook_deliveries');
      assert.strictEqual(failDeliveries[0].status_code, 500);

      // Clean up failing webhook
      await dbService.deleteWebhook(failingWebhook.id);
    });

    test('Chain reorganization retraction webhook dispatches shielded_note.reorganized', async () => {
      receivedRequests.length = 0;
      const notes = await dbService.getShieldedNotes(1);
      assert.ok(notes.length > 0);

      const noteToReorganize = notes[0];

      await WebhookDispatcher.dispatchReorg([noteToReorganize], 3999999);

      assert.ok(receivedRequests.length >= 1);
      const reorgDelivery = receivedRequests[receivedRequests.length - 1];

      assert.strictEqual(reorgDelivery.body.event, 'shielded_note.reorganized');
      assert.strictEqual(reorgDelivery.body.data.note_id, noteToReorganize.id);
      assert.strictEqual(reorgDelivery.body.data.fork_height, 3999999);
      assert.strictEqual(reorgDelivery.body.data.status, 'reorganized');
      assert.strictEqual(reorgDelivery.headers['x-zecshield-event'], 'shielded_note.reorganized');
      assert.ok(reorgDelivery.headers['x-zecshield-event-id'].startsWith('evt_reorg_'));
    });
  });
});
