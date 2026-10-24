import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { dbService } from '../db/database.js';
import { chainSyncer } from '../engine/syncer.js';
import { PaymentSimulator } from '../engine/simulator.js';
import { WebhookDispatcher } from '../webhooks/dispatcher.js';
import { config } from '../config.js';

export const apiRouter = Router();

// --- Status & Health ---
apiRouter.get('/status', async (req: Request, res: Response) => {
  try {
    const stats = await dbService.getStats();
    const chainTip = chainSyncer.getLatestTip();

    res.json({
      status: 'ok',
      network: config.network,
      lightwalletd_url: config.lightwalletdUrl,
      database_mode: dbService.getMode(),
      chain_tip: chainTip,
      stats: {
        total_keys_monitored: stats.totalKeys,
        total_notes_indexed: stats.totalNotes,
        total_shielded_zat: stats.totalZat,
        total_shielded_zec: (stats.totalZat / 100_000_000).toFixed(8)
      },
      timestamp: Math.floor(Date.now() / 1000)
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Viewing Keys Management ---
apiRouter.post('/keys', async (req: Request, res: Response) => {
  try {
    const { key, label, birth_height, key_type } = req.body;
    if (!key || typeof key !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid "key" field' });
    }

    const trimmedKey = key.trim();
    const existing = await dbService.getViewingKeyByString(trimmedKey);
    if (existing) {
      return res.status(200).json({ message: 'Viewing key already registered', key: existing });
    }

    const determinedType = key_type || (trimmedKey.startsWith('uview') ? 'UFVK' : 'ViewingKey');
    const birthHeight = parseInt(birth_height, 10) || 0;

    const record = await dbService.addViewingKey(
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

apiRouter.get('/keys', async (req: Request, res: Response) => {
  try {
    const keys = await dbService.getViewingKeys(false);
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

apiRouter.delete('/keys/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid key ID' });
    }
    const deleted = await dbService.deleteViewingKey(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Viewing key not found' });
    }
    res.json({ message: 'Viewing key and associated notes deleted successfully', id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.delete('/viewing-keys/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid key ID' });
    }
    const deleted = await dbService.deleteViewingKey(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Viewing key not found' });
    }
    res.json({ message: 'Viewing key and associated notes deleted successfully', id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Transactions & Shielded Notes ---
apiRouter.get('/transactions', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const keyId = req.query.key_id ? parseInt(req.query.key_id as string, 10) : undefined;

    const notes = await dbService.getShieldedNotes(limit, keyId);
    res.json({ count: notes.length, transactions: notes });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/transactions/:txid', async (req: Request, res: Response) => {
  try {
    const txid = String(req.params.txid);
    const note = await dbService.getNoteByTxid(txid);
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

    const note = await dbService.addShieldedNote({
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
apiRouter.post('/webhooks', async (req: Request, res: Response) => {
  try {
    const { target_url, secret, description } = req.body;
    if (!target_url || typeof target_url !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid "target_url"' });
    }

    const signingSecret = secret || crypto.randomBytes(24).toString('hex');
    const webhook = await dbService.addWebhook(target_url.trim(), signingSecret, description || '');

    res.status(201).json({
      message: 'Webhook registered successfully',
      webhook,
      signing_secret_reminder: 'Save this secret to verify X-ZecShield-Signature in incoming POST requests'
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/webhooks', async (req: Request, res: Response) => {
  try {
    const webhooks = await dbService.getActiveWebhooks();
    res.json({ webhooks });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.delete('/webhooks/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid webhook ID' });
    }
    const deleted = await dbService.deleteWebhook(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Webhook not found' });
    }
    res.json({ message: 'Webhook and associated delivery history deleted successfully', id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/webhooks/deliveries', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const deliveries = await dbService.getWebhookDeliveries(limit);
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

// --- Ephemeral Wallet Pairing Sessions (For Mobile QR & Extensions) ---
interface WalletPairSession {
  sessionId: string;
  createdAt: number;
  expiresAt: number;
  status: 'pending' | 'approved' | 'rejected';
  key?: any;
}

const pairSessions = new Map<string, WalletPairSession>();

function cleanupSessions() {
  const now = Date.now();
  for (const [id, session] of pairSessions.entries()) {
    if (session.expiresAt < now) {
      pairSessions.delete(id);
    }
  }
}

// 1. Create a pairing session
apiRouter.post('/wallet-pair/session', (req: Request, res: Response) => {
  cleanupSessions();
  const sessionId = 'zpair_' + crypto.randomBytes(12).toString('hex');
  const now = Date.now();
  const expiresAt = now + 5 * 60 * 1000; // 5 minutes validity

  const session: WalletPairSession = {
    sessionId,
    createdAt: now,
    expiresAt,
    status: 'pending'
  };

  pairSessions.set(sessionId, session);

  res.json({
    session_id: sessionId,
    expires_at: expiresAt,
    qr_payload: JSON.stringify({
      app: 'ZecShield Gateway',
      action: 'connect_wallet',
      session_id: sessionId,
      network: config.network,
      endpoint: `${req.protocol}://${req.get('host')}/api/wallet-pair/session/${sessionId}/approve`
    })
  });
});

// 2. Poll session status
apiRouter.get('/wallet-pair/session/:id', (req: Request, res: Response) => {
  cleanupSessions();
  const id = req.params.id as string;
  const session = pairSessions.get(id);

  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired', status: 'expired' });
  }

  res.json({
    session_id: session.sessionId,
    status: session.status,
    key: session.key || null
  });
});

// 3. Approve wallet pairing (from mobile companion or scanner)
apiRouter.post('/wallet-pair/session/:id/approve', async (req: Request, res: Response) => {
  cleanupSessions();
  const id = req.params.id as string;
  const session = pairSessions.get(id);

  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }

  const { key, label, birth_height, key_type } = req.body;
  if (!key || typeof key !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid "key" field' });
  }

  const trimmedKey = key.trim();
  let existing = await dbService.getViewingKeyByString(trimmedKey);
  let record = existing;

  if (!record) {
    const determinedType = key_type || (trimmedKey.startsWith('uview') ? 'UFVK' : 'ViewingKey');
    const birthHeight = parseInt(birth_height, 10) || 0;
    record = await dbService.addViewingKey(
      trimmedKey,
      determinedType,
      label || 'Connected Mobile Wallet',
      birthHeight
    );
  }

  session.status = 'approved';
  session.key = record;

  res.json({
    message: 'Wallet successfully approved and registered with ZecShield',
    key: record
  });
});

// --- System & Database Reset ---
apiRouter.post('/system/reset', async (req: Request, res: Response) => {
  try {
    const keepKeys = req.body?.keep_keys === true;
    await dbService.resetDatabase({ keepKeys });
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
