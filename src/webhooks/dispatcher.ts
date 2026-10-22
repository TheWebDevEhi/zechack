import crypto from 'crypto';
import { dbService, ShieldedNoteRecord, WebhookRecord } from '../db/database.js';

export class WebhookDispatcher {
  /**
   * Dispatches a detected shielded note event to all active webhooks.
   */
  public static async dispatchNote(note: ShieldedNoteRecord): Promise<void> {
    const activeWebhooks = dbService.getActiveWebhooks();
    if (!activeWebhooks.length) {
      return;
    }

    const payload = {
      event: 'shielded_note.detected',
      data: {
        note_id: note.id,
        key_id: note.key_id,
        txid: note.txid,
        block_height: note.block_height,
        block_time: note.block_time,
        pool: note.pool,
        amount_zat: note.amount_zat,
        amount_zec: note.amount_zec,
        transfer_type: note.transfer_type,
        memo: note.memo_text,
        is_simulated: Boolean(note.is_simulated),
      },
      timestamp: Math.floor(Date.now() / 1000)
    };

    const payloadJson = JSON.stringify(payload);

    for (const webhook of activeWebhooks) {
      await this.sendWithRetry(webhook, note.id, payloadJson, 3);
    }
  }

  private static async sendWithRetry(
    webhook: WebhookRecord,
    noteId: number,
    payloadJson: string,
    maxRetries: number
  ): Promise<void> {
    const signature = crypto
      .createHmac('sha256', webhook.secret)
      .update(payloadJson)
      .digest('hex');

    let attempt = 0;
    let delay = 1000;

    while (attempt < maxRetries) {
      attempt++;
      try {
        const response = await fetch(webhook.target_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-ZecShield-Signature': signature,
            'X-ZecShield-Event': 'shielded_note.detected',
            'User-Agent': 'ZecShield-Webhook-Dispatcher/1.0'
          },
          body: payloadJson,
          signal: AbortSignal.timeout(10000) // 10s timeout
        });

        const responseText = await response.text().catch(() => '');
        dbService.logWebhookDelivery(
          webhook.id,
          noteId,
          payloadJson,
          response.status,
          responseText.slice(0, 500)
        );

        if (response.ok) {
          console.log(`[Webhook] Successfully delivered to ${webhook.target_url} (HTTP ${response.status})`);
          return;
        } else {
          console.warn(`[Webhook] Delivery attempt ${attempt} returned status ${response.status} from ${webhook.target_url}`);
        }
      } catch (err: any) {
        console.warn(`[Webhook] Delivery attempt ${attempt} failed for ${webhook.target_url}: ${err.message}`);
        dbService.logWebhookDelivery(
          webhook.id,
          noteId,
          payloadJson,
          0,
          `Error: ${err.message}`.slice(0, 500)
        );
      }

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      }
    }
  }
}
