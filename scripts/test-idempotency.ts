import { dbService } from '../src/db/database';

async function main() {
  await dbService.init();

  const key = await dbService.addViewingKey('test-key-idempotency', 'UFVK', 'Idempotency Test Key', 4528000);

  const sampleNote = {
    key_id: key.id,
    txid: 'abc1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    block_height: 4528571,
    block_time: Math.floor(Date.now() / 1000),
    pool: 'Sapling' as const,
    amount_zat: 1000000,
    amount_zec: 0.01,
    transfer_type: 'incoming',
    memo_text: 'Test duplicate note',
    is_simulated: 0
  };

  // First insertion
  const first = await dbService.addShieldedNote(sampleNote);
  console.log('First note insertion result:', first ? `Note ID #${first.id}` : 'NULL');
  if (!first) throw new Error('First insertion should have succeeded');

  // Second duplicate insertion
  const second = await dbService.addShieldedNote(sampleNote);
  console.log('Second duplicate insertion result:', second ? `DUPLICATE ID #${second.id}` : 'NULL (IGNORED AS EXPECTED)');
  if (second !== null) throw new Error('Duplicate insertion should have returned null');

  // Clean up
  await dbService.resetDatabase({ keepKeys: false });
  console.log('Idempotency test PASSED with 100% success!');
}

main().catch(console.error);
