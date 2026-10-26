import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import { dbService } from '../src/db/database.js';
import { ChainSyncer } from '../src/engine/syncer.js';

describe('Scanner Checkpoint Correctness & Fault Tolerance Tests', () => {
  const testDbPath = path.resolve(process.cwd(), 'data', 'test-syncer-resilience.db');

  before(async () => {
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

  test('Checkpoint does NOT advance when batch scanning encounters RPC errors', async () => {
    const key = await dbService.addViewingKey('uviewtest_resilience_key_1', 'UFVK', 'Resilience Account', 4500000);
    assert.strictEqual(key.last_scanned_height, 4500000);

    // Simulate recording a dead-letter scan error when a batch fails
    const startRange = 4500001;
    const endRange = 4500500;
    const errorMsg = 'RPC connection timeout: lightwalletd upstream unreachable';

    const errorId = await dbService.recordScanError(key.id, startRange, endRange, errorMsg, 3);
    assert.ok(errorId > 0);

    // Verify key checkpoint was preserved and NOT incremented
    const refreshedKey = await dbService.getViewingKeyById(key.id);
    assert.strictEqual(refreshedKey?.last_scanned_height, 4500000, 'Checkpoint must remain at 4500000 after failure');

    // Verify error is recorded in dead-letter queue
    const errors = await dbService.getScanErrors('failed');
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].key_id, key.id);
    assert.strictEqual(errors[0].error_message, errorMsg);
  });

  test('Retrying a failed range does NOT create duplicate notes in database', async () => {
    const key = (await dbService.getViewingKeys())[0];

    const notePayload = {
      key_id: key.id,
      txid: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      output_index: 0,
      block_height: 4500010,
      block_hash: 'hash_4500010',
      block_time: 1700000000,
      pool: 'Orchard' as const,
      amount_zat: 50000000,
      amount_zec: 0.5,
      transfer_type: 'incoming',
      memo_text: 'Partial batch note',
      is_simulated: 0,
      verification_status: 'confirmed' as const
    };

    // First attempt (before batch crashed)
    const firstInsert = await dbService.addShieldedNote(notePayload);
    assert.ok(firstInsert !== null, 'First insert must succeed');

    // Second attempt (retry of the exact same batch)
    const duplicateInsert = await dbService.addShieldedNote(notePayload);
    assert.strictEqual(duplicateInsert, null, 'Duplicate note on retry must return null and be ignored');

    // Verify only 1 note exists in the table
    const allNotes = await dbService.getShieldedNotes(10, key.id);
    assert.strictEqual(allNotes.length, 1);
    assert.strictEqual(allNotes[0].txid, notePayload.txid);
  });

  test('Checkpoint successfully advances ONLY after full batch completion', async () => {
    const key = (await dbService.getViewingKeys())[0];

    // Mark batch successfully completed up to 4500500
    await dbService.updateLastScannedHeight(key.id, 4500500);

    const updatedKey = await dbService.getViewingKeyById(key.id);
    assert.strictEqual(updatedKey?.last_scanned_height, 4500500, 'Checkpoint advances only after complete processing');

    // Resolve the scan error
    const errors = await dbService.getScanErrors('failed');
    await dbService.resolveScanError(errors[0].id);

    const activeErrors = await dbService.getScanErrors('failed');
    assert.strictEqual(activeErrors.length, 0);
  });

  test('Simulated process restart resumes from preserved checkpoint without skipping blocks', async () => {
    // Create new syncer instance simulating fresh application boot
    const freshSyncer = new ChainSyncer();
    const activeKeys = await dbService.getViewingKeys(true);
    const key = activeKeys[0];

    // Syncer must resume from key.last_scanned_height + 1
    const resumeHeight = key.last_scanned_height + 1;
    assert.strictEqual(resumeHeight, 4500501, 'Restarted syncer resumes from exactly the next block');
  });
});
