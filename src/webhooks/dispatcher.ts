import crypto from 'crypto';
import { dbService, ShieldedNoteRecord, WebhookRecord } from '../db/database.js';
import { validateWebhookUrl, safeWebhookPost } from '../security/ssrf.js';
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

    const eventId = `evt_note_${note.id}_${note.txid.slice(0, 10)}`;

    const payload = {
      event_id: eventId,
      event: eventName,
      data: {
        note_id: note.id,
        key_id: note.key_id,
        txid: note.txid,
        output_index: note.output_index ?? 0,
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
      const ssrfCheck = await validateWebhookUrl(webhook.target_url, config.allowHttpWebhooks, config.allowLocalhostWebhooks);
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

      // Note identity deduplication: Deduplicated by (webhook.id, note.id), NOT txid alone!
      // This ensures that multi-note transactions deliver webhooks for each incoming note independently.
      if (await dbService.hasSuccessfulDelivery(webhook.id, note.id)) {
        console.log(`[Webhook] Note #${note.id} was already successfully delivered to webhook #${webhook.id}. Skipping duplicate.`);
        continue;
      }

      await this.sendWithRetry(webhook, note.id, payloadJson, eventName, isSimulated, timestamp, eventId, 3);
    }
  }

  /**
   * Dispatches multiple notes in a batch sequentially.
   */
  public static async dispatchNotes(notes: ShieldedNoteRecord[]): Promise<void> {
    for (const note of notes) {
      await this.dispatchNote(note);
    }
  }

  /**
   * Dispatches chain reorganization alerts to all active webhooks when a transaction is reverted.
   */
  public static async dispatchReorg(revertedNotes: ShieldedNoteRecord[], forkHeight: number): Promise<void> {
    if (!revertedNotes || revertedNotes.length === 0) return;
    const activeWebhooks = await dbService.getActiveWebhooks();
    if (!activeWebhooks.length) return;

    for (const note of revertedNotes) {
      const timestamp = Math.floor(Date.now() / 1000);
      const eventName = 'shielded_note.reorganized';
      const eventId = `evt_reorg_${note.id}_${note.txid.slice(0, 10)}`;
      const payload = {
        event_id: eventId,
        event: eventName,
        data: {
          note_id: note.id,
          key_id: note.key_id,
          txid: note.txid,
          block_height: note.block_height,
          fork_height: forkHeight,
          pool: note.pool,
          amount_zat: note.amount_zat,
          amount_zec: note.amount_zec,
          status: 'reorganized',
          reason: 'chain_reorganization'
        },
        timestamp
      };
      const payloadJson = JSON.stringify(payload);

      for (const webhook of activeWebhooks) {
        const ssrfCheck = await validateWebhookUrl(webhook.target_url, config.allowHttpWebhooks, config.allowLocalhostWebhooks);
        if (!ssrfCheck.isValid) continue;
        await this.sendWithRetry(webhook, note.id, payloadJson, eventName, false, timestamp, eventId, 3);
      }
    }
  }

  private static sanitizeDeliveryResponse(body: string): string {
    if (!body) return '';
    return body
      .slice(0, 500)
      .replace(/(Bearer\s+[A-Za-z0-9_\-\.]+)|(whsec_[A-Za-z0-9]+)|(zc_admin_[A-Za-z0-9_]+)|((?:password|secret|token)["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, '$4[REDACTED]');
  }

  private static async sendWithRetry(
    webhook: WebhookRecord,
    noteId: number,
    payloadJson: string,
    eventName: string,
    isSimulated: boolean,
    timestamp: number,
    eventId: string,
    maxRetries: number
  ): Promise<void> {
    const signature = crypto
      .createHmac('sha256', webhook.secret)
      .update(payloadJson)
      .digest('hex');

    let attempt = 0;
    let delay = config.nodeEnv === 'test' ? 20 : 1000;

    while (attempt < maxRetries) {
      attempt++;
      try {
        // Re-verify SSRF right before connection to defend against rapid DNS rebinding (SEC-03)
        const preFlightCheck = await validateWebhookUrl(webhook.target_url, config.allowHttpWebhooks, config.allowLocalhostWebhooks);
        if (!preFlightCheck.isValid) {
          console.warn(`[Webhook] Pre-flight SSRF check failed for #${webhook.id}: ${preFlightCheck.error}`);
          await dbService.logWebhookDelivery(
            webhook.id,
            noteId,
            payloadJson,
            0,
            `Blocked by pre-flight SSRF policy: ${preFlightCheck.error}`
          );
          return;
        }

        const response = await safeWebhookPost(
          webhook.target_url,
          {
            'Content-Type': 'application/json',
            'X-ZecShield-Signature': signature,
            'X-ZecShield-Event': eventName,
            'X-ZecShield-Event-Id': eventId,
            'X-ZecShield-Simulated': isSimulated ? 'true' : 'false',
            'X-ZecShield-Delivery-Timestamp': timestamp.toString(),
            'User-Agent': 'ZecShield-Webhook-Dispatcher/1.0'
          },
          payloadJson,
          10000,
          config.allowLocalhostWebhooks
        );

        const responseText = await response.text().catch(() => '');
        await dbService.logWebhookDelivery(
          webhook.id,
          noteId,
          payloadJson,
          response.status,
          this.sanitizeDeliveryResponse(responseText)
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
          this.sanitizeDeliveryResponse(`Error: ${err.message}`)
        );
      }

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      }
    }
  }
}
