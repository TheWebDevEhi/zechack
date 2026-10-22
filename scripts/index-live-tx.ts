import { dbService } from '../src/db/database.js';
import { WebhookDispatcher } from '../src/webhooks/dispatcher.js';

async function main() {
  console.log('[Indexer] Initializing database...');
  await dbService.init();

  const txid = '13a20d91369da54281c14d11d0930494ba48814633ae834815a16fea073b96ca';
  const blockHeight = 4523503;
  const blockTime = 1792534628;
  const amountZat = 1000;
  const amountZec = 0.00001;
  const keyId = 2; // Key #2 "Testttt"

  console.log(`[Indexer] Adding confirmed on-chain note for key #${keyId}:`);
  console.log(`  TxID: ${txid}`);
  console.log(`  Block Height: ${blockHeight}`);
  console.log(`  Amount: ${amountZec} TAZ (${amountZat} zat)`);
  console.log(`  Pool: Ironwood (NU6.3 / NU7)`);

  const saved = dbService.addShieldedNote({
    key_id: keyId,
    txid,
    block_height: blockHeight,
    block_time: blockTime,
    pool: 'Ironwood',
    amount_zat: amountZat,
    amount_zec: amountZec,
    transfer_type: 'incoming',
    memo_text: null,
    is_simulated: 0
  });

  if (!saved) {
    console.log('[Indexer] Note already exists in database or could not be inserted.');
    const existing = dbService.getNoteByTxid(txid);
    if (existing) {
      console.log('[Indexer] Found existing note ID:', existing.id);
      console.log('[Indexer] Dispatching webhook...');
      await WebhookDispatcher.dispatchNote(existing);
    }
  } else {
    console.log(`[Indexer] Successfully saved Note ID #${saved.id}!`);
    console.log('[Indexer] Dispatching webhook to active endpoints...');
    await WebhookDispatcher.dispatchNote(saved);
  }

  // Update last scanned height to chain tip so it stays fresh
  dbService.updateLastScannedHeight(keyId, 4526745);

  console.log('\n[Indexer] Inspection of DB Notes:');
  const allNotes = dbService.getShieldedNotes();
  console.log(JSON.stringify(allNotes, null, 2));

  console.log('\n[Indexer] Inspection of Webhook Deliveries:');
  const deliveries = dbService.getWebhookDeliveries();
  console.log(JSON.stringify(deliveries, null, 2));

  process.exit(0);
}

main().catch(console.error);
