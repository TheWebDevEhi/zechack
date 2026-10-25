import crypto from 'crypto';
import { dbService, ShieldedNoteRecord, WebhookRecord } from '../db/database.js';
import { validateWebhookUrl } from '../security/ssrf.js';
import { config } from '../config.js';

export class WebhookDispatcher {
  /**
   * Dispatches a detected shielded note event to all active webhooks.
   */
  public static async dispatchNote(note: ShieldedNoteRecord): Promise<void> {
    // 1. Filter out internal wallet change notes from triggering payment webhooks.
    if (note.transfer_type === 'internal') {
      console.log(`[Webhook] Skipping internal change note ID #${note.id} for tx ${note.txid} (${note.amount_zec} ZEC)`);
      return;
    }

    const activeWebhooks = await dbService.getActiveWebhooks();
    if (!activeWebhooks.length) {
      return;
    }

    const isSimulated = Boolean(note.is_simulated);
    const eventName = isSimulated ? 'shielded_note.simulated' : 'shielded_note.confirmed';
    const timestamp = Math.floor(Date.now() / 1000);

    const payload = {
      event: eventName,
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
        is_simulated: isSimulated,
        verification_status: note.verification_status || (isSimulated ? 'simulated' : 'confirmed'),
      },
      timestamp
    };

    const payloadJson = JSON.stringify(payload);

    for (const webhook of activeWebhooks) {
      // Validate against SSRF before connecting
      const ssrfCheck = await validateWebhookUrl(webhook.target_url, config.allowHttpWebhooks);
      if (!ssrfCheck.isValid) {
        console.warn(`[Webhook] Blocked dispatch to #${webhook.id} due to SSRF policy: ${ssrfCheck.error} (${webhook.target_url})`);
        await dbService.logWebhookDelivery(
          webhook.id,
          note.id,
          payloadJson,
          0,
          `Blocked by SSRF policy: ${ssrfCheck.error}`
        );
        continue;
      }

      // Note: Multi-note deduplication logic will be refined in Phase 3
      if ((await dbService.hasSuccessfulDelivery(webhook.id, note.id))) {
        console.log(`[Webhook] Note #${note.id} was already successfully delivered to webhook #${webhook.id}. Skipping duplicate.`);
        continue;
      }

      await this.sendWithRetry(webhook, note.id, payloadJson, eventName, isSimulated, timestamp, 3);
    }
  }

  private static async sendWithRetry(
    webhook: WebhookRecord,
    noteId: number,
    payloadJson: string,
    eventName: string,
    isSimulated: boolean,
    timestamp: number,
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
            'X-ZecShield-Event': eventName,
            'X-ZecShield-Simulated': isSimulated ? 'true' : 'false',
            'X-ZecShield-Delivery-Timestamp': timestamp.toString(),
            'User-Agent': 'ZecShield-Webhook-Dispatcher/1.0'
          },
          body: payloadJson,
          redirect: 'error', // Defend against DNS rebinding / redirect SSRF bypasses
          signal: AbortSignal.timeout(10000) // 10s timeout
        });

        const responseText = await response.text().catch(() => '');
        await dbService.logWebhookDelivery(
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
        await dbService.logWebhookDelivery(
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
