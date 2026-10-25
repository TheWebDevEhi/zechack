import { startSync, getChainTip, ShieldedTransaction } from '@ledgerhq/zcash-utils';
import { dbService, ViewingKeyRecord, ShieldedNoteRecord } from '../db/database.js';
import { WebhookDispatcher } from '../webhooks/dispatcher.js';
import { protocolAdapterProxy } from './proxy.js';
import { config } from '../config.js';

export class ChainSyncer {
  private isRunning: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private currentTip: number = 0;
  private keyFailureCounts: Map<number, number> = new Map();

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[Syncer] Starting Zcash Chain Scanner on ${config.network} (${config.lightwalletdUrl})...`);

    // Start local protocol adapter proxy for automatic Version 6 (ZIP 229) & multi-pool normalization
    try {
      const proxyUrl = await protocolAdapterProxy.start();
      console.log(`[Syncer] Protocol Adapter Proxy online at ${proxyUrl}`);
    } catch (err: any) {
      console.warn(`[Syncer] Failed to start adapter proxy, falling back to upstream: ${err.message}`);
    }

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
    protocolAdapterProxy.stop().catch(() => {});
    console.log('[Syncer] Stopped chain scanner.');
  }

  public getLatestTip(): number {
    return this.currentTip;
  }

  /**
   * Main sync cycle: Checks chain tip, verifies reorg continuity, and scans keys.
   */
  public async syncCycle(): Promise<void> {
    try {
      this.currentTip = await getChainTip(config.lightwalletdUrl);
    } catch (err: any) {
      console.warn(`[Syncer] Failed to fetch chain tip from ${config.lightwalletdUrl}: ${err.message}`);
      return;
    }

    const activeKeys = await dbService.getViewingKeys(true);
    if (!activeKeys.length) {
      return;
    }

    for (const key of activeKeys) {
      await this.syncKey(key, this.currentTip);
    }
  }

  /**
   * Scans a specific viewing key with resilient batch retry and strict checkpoint persistence.
   * If a batch fails, it retries with exponential backoff and NEVER advances past un-scanned blocks.
   */
  private async syncKey(key: ViewingKeyRecord, chainTip: number): Promise<void> {
    let startHeight = key.last_scanned_height;
    if (startHeight <= 0) {
      startHeight = key.birth_height > 0 ? key.birth_height : Math.max(1, chainTip - 100);
    } else {
      // Advance by 1 because last_scanned_height was already fully processed
      startHeight = startHeight + 1;
    }

    if (startHeight > chainTip) {
      return; // Key is already caught up to current chain tip
    }

    const batchSize = Math.max(config.batchSize, 500);
    const targetGrpcUrl = config.lightwalletdUrl;
    const maxRetries = 3;

    // Fast catch-up loop: continuously process batches until caught up to chainTip
    while (startHeight <= chainTip && this.isRunning) {
      const endHeight = Math.min(chainTip, startHeight + batchSize - 1);
      let batchSuccess = false;
      let attempt = 0;
      let delay = 1000;
      let lastErrorMessage = 'Scan failed after maximum retries';

      while (attempt < maxRetries && !batchSuccess && this.isRunning) {
        attempt++;
        try {
          console.log(
            `[Syncer] Scanning key #${key.id} (${key.label || 'unlabeled'}) blocks ${startHeight} to ${endHeight} (attempt ${attempt}/${maxRetries}, tip: ${chainTip})...`
          );

          const stream = await startSync({
            grpcUrl: targetGrpcUrl,
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

            // Store block continuity hash if provided
            const blockHash = (tx as any).blockHash || (tx as any).hash || '';
            if (blockHash) {
              await dbService.addIndexedBlock(tx.blockHeight, blockHash);
            }

            // 1. Process Ironwood Notes (NU6.3 / ZIP 2005)
            const ironwoodNotes = (tx as any).ironwoodNotes;
            if (ironwoodNotes && ironwoodNotes.length > 0) {
              for (const [idx, note] of ironwoodNotes.entries()) {
                const saved = await dbService.addShieldedNote({
                  key_id: key.id,
                  txid: tx.txid,
                  output_index: (note as any).outputIndex ?? (note as any).actionIndex ?? idx,
                  block_height: tx.blockHeight,
                  block_hash: blockHash,
                  block_time: tx.blockTime,
                  pool: 'Ironwood',
                  amount_zat: note.amount,
                  amount_zec: note.amount / 100_000_000,
                  transfer_type: note.transferType,
                  memo_text: note.memo,
                  is_simulated: 0,
                  verification_status: 'confirmed'
                });
                if (saved) {
                  console.log(`[Syncer] Dispatched Ironwood note ID ${saved.id} (output #${saved.output_index ?? idx}, ${saved.amount_zec} ZEC)`);
                  await WebhookDispatcher.dispatchNote(saved);
                }
              }
            }

            // 2. Process Orchard Notes
            if (tx.orchardNotes && tx.orchardNotes.length > 0) {
              for (const [idx, note] of tx.orchardNotes.entries()) {
                const saved = await dbService.addShieldedNote({
                  key_id: key.id,
                  txid: tx.txid,
                  output_index: (note as any).outputIndex ?? (note as any).actionIndex ?? idx,
                  block_height: tx.blockHeight,
                  block_hash: blockHash,
                  block_time: tx.blockTime,
                  pool: 'Orchard',
                  amount_zat: note.amount,
                  amount_zec: note.amount / 100_000_000,
                  transfer_type: note.transferType,
                  memo_text: note.memo,
                  is_simulated: 0,
                  verification_status: 'confirmed'
                });
                if (saved) {
                  console.log(`[Syncer] Dispatched Orchard note ID ${saved.id} (output #${saved.output_index ?? idx}, ${saved.amount_zec} ZEC)`);
                  await WebhookDispatcher.dispatchNote(saved);
                }
              }
            }

            // 3. Process Sapling Notes
            if (tx.saplingNotes && tx.saplingNotes.length > 0) {
              for (const [idx, note] of tx.saplingNotes.entries()) {
                const saved = await dbService.addShieldedNote({
                  key_id: key.id,
                  txid: tx.txid,
                  output_index: (note as any).outputIndex ?? (note as any).actionIndex ?? idx,
                  block_height: tx.blockHeight,
                  block_hash: blockHash,
                  block_time: tx.blockTime,
                  pool: 'Sapling',
                  amount_zat: note.amount,
                  amount_zec: note.amount / 100_000_000,
                  transfer_type: note.transferType,
                  memo_text: note.memo,
                  is_simulated: 0,
                  verification_status: 'confirmed'
                });
                if (saved) {
                  console.log(`[Syncer] Dispatched Sapling note ID ${saved.id} (output #${saved.output_index ?? idx}, ${saved.amount_zec} ZEC)`);
                  await WebhookDispatcher.dispatchNote(saved);
                }
              }
            }
          }

          // Record indexed block marker for batch end
          await dbService.addIndexedBlock(endHeight, `block_${endHeight}_hash`);

          // Only update checkpoint after the ENTIRE batch has processed successfully!
          await dbService.updateLastScannedHeight(key.id, endHeight);
          this.keyFailureCounts.delete(key.id);
          batchSuccess = true;
          startHeight = endHeight + 1;
        } catch (err: any) {
          lastErrorMessage = err?.message || String(err);
          console.warn(
            `[Syncer] Batch scan error for key #${key.id} in range ${startHeight}-${endHeight} (attempt ${attempt}/${maxRetries}): ${lastErrorMessage}`
          );

          if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, delay));
            delay *= 2;
          }
        }
      }

      // If all retries failed, NEVER advance last_scanned_height past the failed block!
      if (!batchSuccess) {
        const failures = (this.keyFailureCounts.get(key.id) || 0) + 1;
        this.keyFailureCounts.set(key.id, failures);

        console.error(
          `[Syncer Alert] Batch scan permanently failed for key #${key.id} in range ${startHeight}-${endHeight} after ${maxRetries} attempts (Consecutive failures: ${failures}). Checkpoint preserved at block ${key.last_scanned_height}. Zero blocks skipped.`
        );

        // Record failed block range into Dead-Letter Queue (scan_errors table)
        await dbService.recordScanError(key.id, startHeight, endHeight, lastErrorMessage, maxRetries);

        // Break out of catch-up loop for this key; next cycle will resume from the exact same block
        break;
      }
    }
  }

  /**
   * Handles a detected chain reorganization:
   * 1. Reconciles database records back to the common ancestor fork height.
   * 2. Marks all affected notes as 'reorganized'.
   * 3. Dispatches retraction/reversal webhooks ('shielded_note.reorganized').
   * 4. Rewinds viewing key checkpoints to resume scanning from the fork height.
   */
  public async handleReorganization(forkHeight: number): Promise<{ rolledBackNotes: ShieldedNoteRecord[]; affectedHeight: number }> {
    console.warn(`[Syncer Alert] Chain reorganization detected! Rolling back to fork height ${forkHeight}...`);

    const result = await dbService.rollbackToHeight(forkHeight);
    console.log(
      `[Syncer] Reorganization rollback complete. ${result.rolledBackNotes.length} notes marked as reorganized.`
    );

    // Dispatch webhook notifications so receivers know previously confirmed payments were reverted
    if (result.rolledBackNotes.length > 0) {
      await WebhookDispatcher.dispatchReorg(result.rolledBackNotes, forkHeight);
    }

    return result;
  }
}

export const chainSyncer = new ChainSyncer();
