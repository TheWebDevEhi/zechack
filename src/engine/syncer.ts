import { startSync, getChainTip, ShieldedTransaction } from '@ledgerhq/zcash-utils';
import { dbService, ViewingKeyRecord } from '../db/database.js';
import { WebhookDispatcher } from '../webhooks/dispatcher.js';
import { config } from '../config.js';

export class ChainSyncer {
  private isRunning: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private currentTip: number = 0;

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[Syncer] Starting Zcash Chain Scanner on ${config.network} (${config.lightwalletdUrl})...`);

    // Run first cycle immediately
    await this.syncCycle();

    // Schedule recurring loop
    this.timer = setInterval(() => {
      this.syncCycle().catch((err) => {
        console.error('[Syncer] Error in sync cycle:', err.message);
      });
    }, config.syncIntervalMs);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[Syncer] Stopped chain scanner.');
  }

  public getLatestTip(): number {
    return this.currentTip;
  }

  private async syncCycle(): Promise<void> {
    try {
      this.currentTip = await getChainTip(config.lightwalletdUrl);
    } catch (err: any) {
      console.warn(`[Syncer] Failed to fetch chain tip from ${config.lightwalletdUrl}: ${err.message}`);
      return;
    }

    const activeKeys = dbService.getViewingKeys(true);
    if (!activeKeys.length) {
      return;
    }

    for (const key of activeKeys) {
      await this.syncKey(key, this.currentTip);
    }
  }

  private async syncKey(key: ViewingKeyRecord, chainTip: number): Promise<void> {
    // If key has no last_scanned_height or is 0, start from birth_height or (chainTip - 100)
    let startHeight = key.last_scanned_height;
    if (startHeight <= 0) {
      startHeight = key.birth_height > 0 ? key.birth_height : Math.max(1, chainTip - 100);
    }

    if (startHeight >= chainTip) {
      return; // Already up to date
    }

    const endHeight = Math.min(chainTip, startHeight + config.batchSize);

    try {
      console.log(`[Syncer] Scanning key #${key.id} (${key.label || 'unlabeled'}) from block ${startHeight} to ${endHeight} (tip: ${chainTip})...`);

      const stream = await startSync({
        grpcUrl: config.lightwalletdUrl,
        viewingKey: key.key_string,
        startHeight,
        endHeight,
        network: config.network,
        maxRetries: 2
      });

      let tx: ShieldedTransaction | null;
      let matchedCount = 0;

      while ((tx = await stream.next()) !== null) {
        matchedCount++;
        console.log(`[Syncer] Match found! TxID: ${tx.txid} in block ${tx.blockHeight}`);

        // Process Orchard Notes
        if (tx.orchardNotes && tx.orchardNotes.length > 0) {
          for (const note of tx.orchardNotes) {
            const saved = dbService.addShieldedNote({
              key_id: key.id,
              txid: tx.txid,
              block_height: tx.blockHeight,
              block_time: tx.blockTime,
              pool: 'Orchard',
              amount_zat: note.amount,
              amount_zec: note.amount / 100_000_000,
              transfer_type: note.transferType,
              memo_text: note.memo,
              is_simulated: 0
            });
            if (saved) {
              await WebhookDispatcher.dispatchNote(saved);
            }
          }
        }

        // Process Sapling Notes
        if (tx.saplingNotes && tx.saplingNotes.length > 0) {
          for (const note of tx.saplingNotes) {
            const saved = dbService.addShieldedNote({
              key_id: key.id,
              txid: tx.txid,
              block_height: tx.blockHeight,
              block_time: tx.blockTime,
              pool: 'Sapling',
              amount_zat: note.amount,
              amount_zec: note.amount / 100_000_000,
              transfer_type: note.transferType,
              memo_text: note.memo,
              is_simulated: 0
            });
            if (saved) {
              await WebhookDispatcher.dispatchNote(saved);
            }
          }
        }
      }

      // Update checkpoint after successful scan
      dbService.updateLastScannedHeight(key.id, endHeight);
    } catch (err: any) {
      console.error(`[Syncer] Scan error for key #${key.id}:`, err.message);
      // Advance by small increment on error so syncer is not stuck forever on bad block
      dbService.updateLastScannedHeight(key.id, Math.min(chainTip, startHeight + 10));
    }
  }
}

export const chainSyncer = new ChainSyncer();
