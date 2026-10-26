import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { createApp } from '../src/api/server.js';
import { dbService } from '../src/db/database.js';
import { config } from '../src/config.js';
import { verifyTransactionOnChain } from '../src/engine/verifier.js';

describe('On-Chain Transaction Verification Tests', () => {
  let server: http.Server;
  let baseUrl: string;
  const testDbPath = path.resolve(process.cwd(), 'data', 'test-tx-verif.db');

  before(async () => {
    config.adminApiKey = 'test_admin_key_verif_1234';
    config.readApiKey = 'test_read_key_verif_5678';
    config.nodeEnv = 'test';

    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch {}
    }
    (dbService as any).dbPath = testDbPath;
    await dbService.init();

    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr: any = server.address();
        baseUrl = `http://127.0.0.1:${addr.port}/api/v1`;
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

  test('verifyTransactionOnChain rejects invalid or non-existent block heights', async () => {
    const res = await verifyTransactionOnChain({
      txid: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      blockHeight: 999999999, // Far future block
      viewingKeyString: 'uviewtest1xyz',
      targetGrpcUrl: config.lightwalletdUrl,
      network: 'testnet'
    });

    assert.strictEqual(res.verified, false);
    assert.ok(res.error);
    assert.ok(res.error.includes('failed') || res.error.includes('not found'));
  });

  test('POST /transactions/index-confirmed with verify_on_chain rejects non-existent on-chain tx', async () => {
    const key = await dbService.addViewingKey('uviewtest_verif_endpoint_key', 'UFVK', 'Verif Key', 4500000);

    const res = await fetch(`${baseUrl}/transactions/index-confirmed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.adminApiKey
      },
      body: JSON.stringify({
        key_id: key.id,
        txid: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        block_height: 4520000,
        verify_on_chain: true
      })
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error);
    assert.ok(data.error.includes('On-chain verification failed') || data.error.includes('not confirmed') || data.error.includes('trial-decryption'));
  });

  test('POST /transactions/index-confirmed without verify_on_chain allows administrative indexing with strict parameter validation', async () => {
    const key = (await dbService.getViewingKeys())[0];

    const validTxid = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    const res = await fetch(`${baseUrl}/transactions/index-confirmed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.adminApiKey
      },
      body: JSON.stringify({
        key_id: key.id,
        txid: validTxid,
        block_height: 4520000,
        pool: 'Orchard',
        amount_zec: 1.5,
        memo: 'Order #TEST-CONFIRMED',
        verify_on_chain: false
      })
    });

    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.transaction.txid, validTxid);
    assert.strictEqual(data.transaction.amount_zec, 1.5);
    assert.strictEqual(data.transaction.verification_status, 'confirmed');
  });
});
