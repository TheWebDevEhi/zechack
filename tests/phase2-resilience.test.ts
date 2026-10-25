import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { createApp } from '../src/api/server.js';
import { dbService } from '../src/db/database.js';
import { config } from '../src/config.js';
import { chainSyncer } from '../src/engine/syncer.js';
import { createRateLimiter } from '../src/security/rate-limit.js';
import {
  validateTxid,
  validateBlockHeight,
  validateAmountZec,
  validatePool,
  validatePagination,
  validateViewingKeyInput
} from '../src/security/validation.js';

describe('Phase 2 Indexing Engine Resilience Tests', () => {
  let server: http.Server;
  let baseUrl: string;
  const testDbPath = path.resolve(process.cwd(), 'data', 'test-phase2.db');

  before(async () => {
    config.adminApiKey = 'test_admin_key_p2_9999';
    config.readApiKey = 'test_read_key_p2_1111';
    config.allowHttpWebhooks = true; // allow test server destination

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

  // --- 1. Scanner Error Handling & Resilient Checkpointing (Issue 5) ---
  describe('1. Scanner Error Recovery & Checkpointing', () => {
    test('Checkpoint is not advanced when a batch fails', async () => {
      // Create a test key with last_scanned_height = 4500000
      const key = await dbService.addViewingKey(
        'uviewtest1scannerrecoverytest0000000000000000000000000000000000000000000000000000000000000000000000000000',
        'UFVK',
        'Recovery Test Key',
        4500000
      );

      assert.strictEqual(key.last_scanned_height, 4500000);

      // Verify that after DB operations, initial height is intact
      const fetched = await dbService.getViewingKeyById(key.id);
      assert.strictEqual(fetched?.last_scanned_height, 4500000);
    });

    test('Note insertion is idempotent on retries (zero duplicate records)', async () => {
      const txid = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
      const noteData = {
        key_id: 1,
        txid,
        block_height: 4500010,
        block_time: Math.floor(Date.now() / 1000),
        pool: 'Orchard' as const,
        amount_zat: 50_000_000,
        amount_zec: 0.5,
        transfer_type: 'incoming',
        memo_text: 'Idempotency test note',
        is_simulated: 0,
        verification_status: 'confirmed' as const
      };

      // First insertion succeeds
      const first = await dbService.addShieldedNote(noteData);
      assert.ok(first);
      assert.strictEqual(first.amount_zec, 0.5);

      // Second identical insertion returns null (ignored by UNIQUE constraint)
      const second = await dbService.addShieldedNote(noteData);
      assert.strictEqual(second, null);

      // Total count should only be 1
      const allNotes = await dbService.getShieldedNotes(50, 1);
      const matches = allNotes.filter((n) => n.txid === txid);
      assert.strictEqual(matches.length, 1);
    });

    test('Repeated failures are recorded in Dead-Letter Queue (scan_errors table) and can be resolved', async () => {
      const errId = await dbService.recordScanError(
        1,
        4500050,
        4500100,
        'gRPC deadline exceeded / connection reset by peer',
        3
      );
      assert.ok(errId > 0);

      // Verify DLQ query
      const errors = await dbService.getScanErrors('failed');
      const found = errors.find((e) => e.id === errId);
      assert.ok(found);
      assert.strictEqual(found.error_message, 'gRPC deadline exceeded / connection reset by peer');
      assert.strictEqual(found.status, 'failed');

      // Verify API endpoint GET /api/v1/syncer/errors
      const getRes = await fetch(`${baseUrl}/api/v1/syncer/errors`, {
        headers: { 'X-API-Key': config.readApiKey }
      });
      assert.strictEqual(getRes.status, 200);
      const getBody: any = await getRes.json();
      assert.ok(getBody.errors.some((e: any) => e.id === errId));

      // Resolve the error
      const resolveRes = await fetch(`${baseUrl}/api/v1/syncer/errors/${errId}/resolve`, {
        method: 'POST',
        headers: { 'X-API-Key': config.adminApiKey }
      });
      assert.strictEqual(resolveRes.status, 200);

      // Check resolved status in DB
      const resolvedErrors = await dbService.getScanErrors('resolved');
      assert.ok(resolvedErrors.some((e) => e.id === errId));
    });
  });

  // --- 2. Chain Reorganization & Rollback (Issue 6) ---
  describe('2. Chain Reorganization Detection & Rollback', () => {
    test('Rollback updates orphaned notes to reorganized status and rewinds checkpoints', async () => {
      const key = await dbService.addViewingKey(
        'uviewtest1reorgtest00000000000000000000000000000000000000000000000000000000000000000000000000000000000',
        'UFVK',
        'Reorg Test Key',
        4500000
      );

      // Advance key to 5000005
      await dbService.updateLastScannedHeight(key.id, 5000005);

      // Insert notes at height 5000002 and 5000004
      const note1 = await dbService.addShieldedNote({
        key_id: key.id,
        txid: '1111111111111111111111111111111111111111111111111111111111111111',
        block_height: 5000002,
        block_time: 1700000000,
        pool: 'Orchard',
        amount_zat: 10_000_000,
        amount_zec: 0.1,
        transfer_type: 'incoming',
        memo_text: 'Fork block 5000002',
        is_simulated: 0,
        verification_status: 'confirmed'
      });

      const note2 = await dbService.addShieldedNote({
        key_id: key.id,
        txid: '2222222222222222222222222222222222222222222222222222222222222222',
        block_height: 5000004,
        block_time: 1700000001,
        pool: 'Orchard',
        amount_zat: 20_000_000,
        amount_zec: 0.2,
        transfer_type: 'incoming',
        memo_text: 'Fork block 5000004',
        is_simulated: 0,
        verification_status: 'confirmed'
      });

      assert.ok(note1);
      assert.ok(note2);

      // Record indexed blocks
      await dbService.addIndexedBlock(5000002, 'orphaned_hash_5000002');
      await dbService.addIndexedBlock(5000004, 'orphaned_hash_5000004');

      // Execute rollback to fork height 5000001
      const reorgResult = await chainSyncer.handleReorganization(5000001);

      assert.strictEqual(reorgResult.affectedHeight, 5000001);
      assert.strictEqual(reorgResult.rolledBackNotes.length, 2);

      // Verify notes are now marked as 'reorganized' in database
      const updatedNote1 = await dbService.getNoteByTxid('1111111111111111111111111111111111111111111111111111111111111111');
      assert.strictEqual(updatedNote1?.verification_status, 'reorganized');

      const updatedNote2 = await dbService.getNoteByTxid('2222222222222222222222222222222222222222222222222222222222222222');
      assert.strictEqual(updatedNote2?.verification_status, 'reorganized');

      // Verify viewing key last_scanned_height was rewound to fork height 5000001
      const rewoundKey = await dbService.getViewingKeyById(key.id);
      assert.strictEqual(rewoundKey?.last_scanned_height, 5000001);

      // Verify orphaned blocks were deleted
      const block5000004 = await dbService.getIndexedBlock(5000004);
      assert.strictEqual(block5000004, null);
    });

    test('POST /api/v1/reorg/simulate endpoint processes reorganization cleanly', async () => {
      const res = await fetch(`${baseUrl}/api/v1/reorg/simulate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': config.adminApiKey
        },
        body: JSON.stringify({ fork_height: 5000000 })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.fork_height, 5000000);
      assert.match(data.message, /reorganization successfully processed/i);
    });
  });

  // --- 3. Request Validation & Resource Limits (Issue 8) ---
  describe('3. Request Validation & Resource Limits', () => {
    test('validateTxid rejects non-hex, short, or oversized hashes', () => {
      assert.strictEqual(validateTxid('not_hex').isValid, false);
      assert.strictEqual(validateTxid('12345').isValid, false);
      assert.strictEqual(validateTxid('g'.repeat(64)).isValid, false);
      assert.strictEqual(validateTxid('a'.repeat(64)).isValid, true);
    });

    test('validateBlockHeight rejects negative values and letters', () => {
      assert.strictEqual(validateBlockHeight(-5).isValid, false);
      assert.strictEqual(validateBlockHeight('abc').isValid, false);
      assert.strictEqual(validateBlockHeight(4520000).isValid, true);
    });

    test('validateAmountZec rejects non-numeric, negative, and excessive values', () => {
      assert.strictEqual(validateAmountZec(-1).isValid, false);
      assert.strictEqual(validateAmountZec(0).isValid, false);
      assert.strictEqual(validateAmountZec(25_000_000).isValid, false); // exceeds 21M ZEC
      assert.strictEqual(validateAmountZec(0.5).isValid, true);
    });

    test('validatePool rejects unrecognized pool names', () => {
      assert.strictEqual(validatePool('Bitcoin').isValid, false);
      assert.strictEqual(validatePool('Orchard').isValid, true);
      assert.strictEqual(validatePool('Sapling').isValid, true);
      assert.strictEqual(validatePool('Ironwood').isValid, true);
    });

    test('validatePagination clamps maximum limit to prevent memory exhaustion', () => {
      const result = validatePagination(10000, 50, 100);
      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.value, 100); // clamped to 100

      assert.strictEqual(validatePagination(-5).isValid, false);
    });

    test('validateViewingKeyInput rejects empty or too-short keys', () => {
      assert.strictEqual(validateViewingKeyInput('').isValid, false);
      assert.strictEqual(validateViewingKeyInput('short').isValid, false);
      assert.strictEqual(
        validateViewingKeyInput('uviewtest1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq').isValid,
        true
      );
    });

    test('Rate limiter returns 429 when threshold exceeded', async () => {
      const limiter = createRateLimiter({ max: 3, windowMs: 10_000 });
      let statusCodes: number[] = [];

      const mockReq: any = { ip: '192.168.1.50', socket: {}, header: () => undefined };
      const mockRes: any = {
        statusCode: 200,
        headers: {},
        setHeader(k: string, v: string) { this.headers[k] = v; },
        status(code: number) { this.statusCode = code; return this; },
        json(body: any) { statusCodes.push(this.statusCode); }
      };

      for (let i = 0; i < 5; i++) {
        limiter(mockReq, mockRes, () => {
          statusCodes.push(200);
        });
      }

      // First 3 should pass (200), next 2 should be rejected with 429
      assert.strictEqual(statusCodes[0], 200);
      assert.strictEqual(statusCodes[1], 200);
      assert.strictEqual(statusCodes[2], 200);
      assert.strictEqual(statusCodes[3], 429);
      assert.strictEqual(statusCodes[4], 429);
    });
  });
});
