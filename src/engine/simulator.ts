import crypto from 'crypto';
import { dbService, ShieldedNoteRecord } from '../db/database.js';
import { WebhookDispatcher } from '../webhooks/dispatcher.js';

export interface SimulatePaymentOptions {
  keyId?: number;
  amountZec: number;
  memo: string;
  pool?: 'Orchard' | 'Sapling' | 'Ironwood';
  transferType?: 'incoming' | 'outgoing' | 'internal';
  txid?: string;
  blockHeight?: number;
  isSimulated?: number;
}

export class PaymentSimulator {
  /**
   * Generates a realistic simulated shielded payment, saves it to the database,
   * and triggers the webhook dispatcher.
   */
  public static async simulatePayment(options: SimulatePaymentOptions): Promise<ShieldedNoteRecord> {
    const activeKeys = await dbService.getViewingKeys(true);
    let targetKeyId = options.keyId;

    if (!targetKeyId) {
      if (activeKeys.length > 0) {
        targetKeyId = activeKeys[0].id;
      } else {
        // Create a default test viewing key if none exists
        const dummyUfvk = 'uviewtest1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
        const created = await dbService.addViewingKey(dummyUfvk, 'UFVK', 'Demo Simulation Key', 4500000);
        targetKeyId = created.id;
      }
    }

    const txid = options.txid || crypto.randomBytes(32).toString('hex');
    const now = Math.floor(Date.now() / 1000);
    const amountZec = options.amountZec || 0.5;
    const amountZat = Math.round(amountZec * 100_000_000);

    // Get an approximate block height from existing records or default
    const existing = await dbService.getShieldedNotes(1);
    const blockHeight = options.blockHeight || (existing.length > 0 ? existing[0].block_height + 1 : 4520000);

    const noteRecord = await dbService.addShieldedNote({
      key_id: targetKeyId,
      txid,
      block_height: blockHeight,
      block_time: now,
      pool: options.pool || 'Orchard',
      amount_zat: amountZat,
      amount_zec: amountZec,
      transfer_type: options.transferType || 'incoming',
      memo_text: options.memo || '',
      is_simulated: options.isSimulated !== undefined ? options.isSimulated : 1
    });

    if (!noteRecord) {
      throw new Error('Failed to insert simulated note record');
    }

    console.log(`[Simulator] Simulated ${amountZec} ZEC (${options.pool || 'Orchard'}) note with memo: "${options.memo}"`);

    // Dispatch webhooks immediately
    await WebhookDispatcher.dispatchNote(noteRecord);

    return noteRecord;
  }
}
