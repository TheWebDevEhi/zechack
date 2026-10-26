import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { dbService, ShieldedNoteRecord } from '../src/db/database.js';
import { ChainSyncer } from '../src/engine/syncer.js';
import { config } from '../src/config.js';

describe('Automatic Chain Reorganization Detection & Rollback Tests', () => {
  const testDbPath = path.resolve(process.cwd(), 'data', 'test-reorg-auto.db');
  let webhookReceiver: http.Server;
  let receivedEvents: any[] = [];
  let webhookUrl: string;

  before(async () => {
    config.allowHttpWebhooks = true;
    config.allowLocalhostWebhooks = true;
    config.nodeEnv = 'test';

    // Start local webhook listener to verify reorg events
    webhookReceiver = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          receivedEvents.push(JSON.parse(body));
        } catch {}
        res.writeHead(200);
        res.end('ok');
      });
    });

    await new Promise<void>((resolve) => {
      webhookReceiver.listen(0, '127.0.0.1', () => {
        const port = (webhookReceiver.address() as any).port;
        webhookUrl = `http://127.0.0.1:${port}/reorg-webhook`;
        resolve();
      });
    });

    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch {}
    }
    (dbService as any).dbPath = testDbPath;
    await dbService.init();

    // Register active webhook
    await dbService.addWebhook(webhookUrl, 'Reorg Alert Listener', 'secret_reorg_123');
  });

  after(async () => {
    await new Promise<void>((resolve) => webhookReceiver.close(() => resolve()));
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch {}
    }
  });

  test('Automatic detection of block-hash divergence triggers rollback to common ancestor', async () => {
    const key = await dbService.addViewingKey('uviewtest_reorg_auto_key', 'UFVK', 'Reorg Account', 5000000);

    // 1. Seed chain history: Blocks 5000000, 5000001, 5000002
    await dbService.addIndexedBlock(5000000, 'hash_canonical_5000000');
    await dbService.addIndexedBlock(5000001, 'hash_forked_old_5000001');
    await dbService.addIndexedBlock(5000002, 'hash_forked_old_5000002');

    // Seed notes on the blocks that will be orphaned
    const note1 = await dbService.addShieldedNote({
      key_id: key.id,
      txid: '1111111111111111111111111111111111111111111111111111111111111111',
      output_index: 0,
      block_height: 5000001,
      block_hash: 'hash_forked_old_5000001',
      block_time: 1700000001,
      pool: 'Orchard',
      amount_zat: 100000000,
      amount_zec: 1.0,
      transfer_type: 'incoming',
      memo_text: 'Orphaned note 1',
      is_simulated: 0,
      verification_status: 'confirmed'
    });

    const note2 = await dbService.addShieldedNote({
      key_id: key.id,
      txid: '2222222222222222222222222222222222222222222222222222222222222222',
      output_index: 0,
      block_height: 5000002,
      block_hash: 'hash_forked_old_5000002',
      block_time: 1700000002,
      pool: 'Sapling',
      amount_zat: 200000000,
      amount_zec: 2.0,
      transfer_type: 'incoming',
      memo_text: 'Orphaned note 2',
      is_simulated: 0,
      verification_status: 'confirmed'
    });

    await dbService.updateLastScannedHeight(key.id, 5000002);
    assert.ok(note1 && note2);

    // 2. Instantiate syncer with injected chain block fetcher reporting a fork
    const syncer = new ChainSyncer();
    // Simulate chain reporting:
    // Block 5000002 has new hash "hash_forked_new_5000002" (divergence)
    // Block 5000001 has new hash "hash_forked_new_5000001" (divergence)
    // Block 5000000 has canonical hash "hash_canonical_5000000" (common ancestor!)
    syncer.chainBlockHashFetcher = async (height: number) => {
      if (height === 5000002) return 'hash_forked_new_5000002';
      if (height === 5000001) return 'hash_forked_new_5000001';
      if (height === 5000000) return 'hash_canonical_5000000';
      return null;
    };

    // 3. Trigger continuity check (normal automatic synchronization flow)
    const continuityResult = await syncer.checkChainContinuity();
    assert.strictEqual(continuityResult, false, 'Continuity check must return false when reorg is detected and handled');

    // 4. Verify notes were reverted from confirmed -> reorganized
    const refreshedNote1 = await dbService.getNoteByTxid('1111111111111111111111111111111111111111111111111111111111111111');
    const refreshedNote2 = await dbService.getNoteByTxid('2222222222222222222222222222222222222222222222222222222222222222');

    assert.strictEqual(refreshedNote1?.verification_status, 'reorganized', 'Reverted note 1 cannot remain confirmed');
    assert.strictEqual(refreshedNote2?.verification_status, 'reorganized', 'Reverted note 2 cannot remain confirmed');

    // 5. Verify checkpoint was rewound to the common ancestor height
    const refreshedKey = await dbService.getViewingKeyById(key.id);
    assert.strictEqual(refreshedKey?.last_scanned_height, 5000000, 'Checkpoint rewinds to fork ancestor height');

    // 6. Verify retraction webhooks were dispatched
    // Wait briefly for async delivery
    await new Promise((r) => setTimeout(r, 200));

    const reorgEvents = receivedEvents.filter((e) => e.event === 'shielded_note.reorganized');
    assert.ok(reorgEvents.length >= 2, `Expected at least 2 reorg events, received ${reorgEvents.length}`);

    const eventTxids = reorgEvents.map((e) => e.data.txid);
    assert.ok(eventTxids.includes('1111111111111111111111111111111111111111111111111111111111111111'));
    assert.ok(eventTxids.includes('2222222222222222222222222222222222222222222222222222222222222222'));
    assert.strictEqual(reorgEvents[0].data.status, 'reorganized');
    assert.strictEqual(reorgEvents[0].data.fork_height, 5000000);
  });
});
