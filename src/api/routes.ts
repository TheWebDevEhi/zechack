import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { dbService } from '../db/database.js';
import { chainSyncer } from '../engine/syncer.js';
import { PaymentSimulator } from '../engine/simulator.js';
import { config } from '../config.js';

export const apiRouter = Router();

// --- Status & Health ---
apiRouter.get('/status', (req: Request, res: Response) => {
  const stats = dbService.getStats();
  const chainTip = chainSyncer.getLatestTip();

  res.json({
    status: 'ok',
    network: config.network,
    lightwalletd_url: config.lightwalletdUrl,
    chain_tip: chainTip,
    stats: {
      total_keys_monitored: stats.totalKeys,
      total_notes_indexed: stats.totalNotes,
      total_shielded_zat: stats.totalZat,
      total_shielded_zec: (stats.totalZat / 100_000_000).toFixed(8)
    },
    timestamp: Math.floor(Date.now() / 1000)
  });
});

// --- Viewing Keys Management ---
apiRouter.post('/keys', (req: Request, res: Response) => {
  try {
    const { key, label, birth_height, key_type } = req.body;
    if (!key || typeof key !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid "key" field' });
    }

    const trimmedKey = key.trim();
    const existing = dbService.getViewingKeyByString(trimmedKey);
    if (existing) {
      return res.status(200).json({ message: 'Viewing key already registered', key: existing });
    }

    const determinedType = key_type || (trimmedKey.startsWith('uview') ? 'UFVK' : 'ViewingKey');
    const birthHeight = parseInt(birth_height, 10) || 0;

    const record = dbService.addViewingKey(
      trimmedKey,
      determinedType,
      label || 'Default Key',
      birthHeight
    );

    res.status(201).json({ message: 'Viewing key successfully registered', key: record });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/keys', (req: Request, res: Response) => {
  try {
    const keys = dbService.getViewingKeys(false);
    const chainTip = chainSyncer.getLatestTip();

    const enriched = keys.map((k) => ({
      ...k,
      sync_percent:
        chainTip > 0 && k.last_scanned_height > 0
          ? Math.min(100, Math.round((k.last_scanned_height / chainTip) * 100))
          : 0,
      is_synced: chainTip > 0 && k.last_scanned_height >= chainTip
    }));

    res.json({ keys: enriched });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Transactions & Shielded Notes ---
apiRouter.get('/transactions', (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const keyId = req.query.key_id ? parseInt(req.query.key_id as string, 10) : undefined;

    const notes = dbService.getShieldedNotes(limit, keyId);
    res.json({ count: notes.length, transactions: notes });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/transactions/:txid', (req: Request, res: Response) => {
  try {
    const txid = String(req.params.txid);
    const note = dbService.getNoteByTxid(txid);
    if (!note) {
      return res.status(404).json({ error: 'Transaction not found in indexed records' });
    }
    res.json({ transaction: note });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Index a confirmed on-chain transaction directly
apiRouter.post('/transactions/index-confirmed', async (req: Request, res: Response) => {
  try {
    const { key_id, txid, block_height, block_time, pool, amount_zec, memo } = req.body;
    if (!txid) {
      return res.status(400).json({ error: 'Missing txid' });
    }
    const keyId = parseInt(key_id, 10) || 2;
    const amount = parseFloat(amount_zec) || 0.00001;
    const zat = Math.round(amount * 100_000_000);

    const note = dbService.addShieldedNote({
      key_id: keyId,
      txid: String(txid),
      block_height: parseInt(block_height, 10) || 4523503,
      block_time: parseInt(block_time, 10) || Math.floor(Date.now() / 1000),
      pool: pool || 'Ironwood',
      amount_zat: zat,
      amount_zec: amount,
      transfer_type: 'incoming',
      memo_text: memo || '',
      is_simulated: 0
    });

    if (note) {
      await WebhookDispatcher.dispatchNote(note);
    }

    res.status(201).json({
      message: 'Confirmed on-chain transaction indexed and webhook dispatched',
      transaction: note
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Webhooks Management ---
apiRouter.post('/webhooks', (req: Request, res: Response) => {
  try {
    const { target_url, secret, description } = req.body;
    if (!target_url || typeof target_url !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid "target_url"' });
    }

    const signingSecret = secret || crypto.randomBytes(24).toString('hex');
    const webhook = dbService.addWebhook(target_url.trim(), signingSecret, description || '');

    res.status(201).json({
      message: 'Webhook registered successfully',
      webhook,
      signing_secret_reminder: 'Save this secret to verify X-ZecShield-Signature in incoming POST requests'
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/webhooks', (req: Request, res: Response) => {
  try {
    const webhooks = dbService.getActiveWebhooks();
    res.json({ webhooks });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/webhooks/deliveries', (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const deliveries = dbService.getWebhookDeliveries(limit);
    res.json({ count: deliveries.length, deliveries });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Demo & Pitch Simulator ---
apiRouter.post('/simulator/simulate', async (req: Request, res: Response) => {
  try {
    const { key_id, amount_zec, memo, pool, transfer_type, txid, block_height, is_simulated } = req.body;
    const note = await PaymentSimulator.simulatePayment({
      keyId: key_id ? parseInt(key_id, 10) : undefined,
      amountZec: parseFloat(amount_zec) || 0.75,
      memo: memo !== undefined ? memo : 'Hackathon Demo Payment - Invoice #ZEC-9901',
      pool: pool || 'Orchard',
      transferType: transfer_type || 'incoming',
      txid: txid || undefined,
      blockHeight: block_height ? parseInt(block_height, 10) : undefined,
      isSimulated: is_simulated !== undefined ? parseInt(is_simulated, 10) : 1
    });

    res.status(201).json({
      message: 'Payment recorded and webhook dispatched',
      transaction: note
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- System & Database Reset ---
apiRouter.post('/system/reset', (req: Request, res: Response) => {
  try {
    const keepKeys = req.body?.keep_keys === true;
    dbService.resetDatabase({ keepKeys });
    res.json({
      message: keepKeys
        ? 'Shielded notes and webhook deliveries cleared. Monitored keys retained.'
        : 'Database reset completely. All keys, notes, and webhooks wiped.',
      status: 'ok'
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
