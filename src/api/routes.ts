import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { dbService } from '../db/database.js';
import { chainSyncer } from '../engine/syncer.js';
import { PaymentSimulator } from '../engine/simulator.js';
import { WebhookDispatcher } from '../webhooks/dispatcher.js';
import { config } from '../config.js';
import { requireAuth, auditLog } from '../security/auth.js';
import { verifyTransactionOnChain } from '../engine/verifier.js';
import { sanitizeViewingKey, sanitizeWebhook } from '../security/redaction.js';
import { validateWebhookUrl } from '../security/ssrf.js';
import {
  validateTxid,
  validateBlockHeight,
  validateAmountZec,
  validatePool,
  validatePagination,
  validateViewingKeyInput,
  validateMemo
} from '../security/validation.js';
import { createRateLimiter } from '../security/rate-limit.js';

export const apiRouter = Router();

// Per-endpoint rate limiters
const readLimiter = createRateLimiter({ max: 300, windowMs: 60_000 });
const writeLimiter = createRateLimiter({ max: 60, windowMs: 60_000 });

// --- Status & Health (Public Read-Only) ---
apiRouter.get('/status', readLimiter, async (req: Request, res: Response) => {
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

// --- Viewing Keys Management (Protected) ---
apiRouter.post('/keys', requireAuth('admin'), writeLimiter, async (req: Request, res: Response) => {
  try {
    const { key, label, birth_height, key_type } = req.body;

    const keyVal = validateViewingKeyInput(key, key_type);
    if (!keyVal.isValid) {
      return res.status(400).json({ error: keyVal.error });
    }

    const birthHeightVal = validateBlockHeight(birth_height !== undefined ? birth_height : 0);
    if (!birthHeightVal.isValid) {
      return res.status(400).json({ error: birthHeightVal.error });
    }

    const trimmedKey = keyVal.value!.cleanKey;
    const existing = await dbService.getViewingKeyByString(trimmedKey);
    if (existing) {
      return res.status(200).json({
        message: 'Viewing key already registered',
        key: sanitizeViewingKey(existing)
      });
    }

    const record = await dbService.addViewingKey(
      trimmedKey,
      keyVal.value!.determinedType,
      label || 'Default Key',
      birthHeightVal.value!
    );

    auditLog(req, 'CREATE_VIEWING_KEY', { id: record.id, key_type: keyVal.value!.determinedType, label: record.label });

    res.status(201).json({
      message: 'Viewing key successfully registered',
      key: sanitizeViewingKey(record)
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/keys', requireAuth('read'), readLimiter, async (req: Request, res: Response) => {
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

    res.json({ keys: enriched.map(sanitizeViewingKey) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.delete('/keys/:id', requireAuth('admin'), writeLimiter, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid key ID' });
    }
    const deleted = await dbService.deleteViewingKey(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Viewing key not found' });
    }

    auditLog(req, 'DELETE_VIEWING_KEY', { id });
    res.json({ message: 'Viewing key and associated notes deleted successfully', id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.delete('/viewing-keys/:id', requireAuth('admin'), writeLimiter, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid key ID' });
    }
    const deleted = await dbService.deleteViewingKey(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Viewing key not found' });
    }

    auditLog(req, 'DELETE_VIEWING_KEY', { id });
    res.json({ message: 'Viewing key and associated notes deleted successfully', id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Transactions & Shielded Notes (Protected) ---
apiRouter.get('/transactions', requireAuth('read'), readLimiter, async (req: Request, res: Response) => {
  try {
    const limitVal = validatePagination(req.query.limit, 50, 100);
    if (!limitVal.isValid) {
      return res.status(400).json({ error: limitVal.error });
    }

    const keyId = req.query.key_id ? parseInt(req.query.key_id as string, 10) : undefined;
    const notes = await dbService.getShieldedNotes(limitVal.value, keyId);
    res.json({ count: notes.length, transactions: notes });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/transactions/:txid', requireAuth('read'), readLimiter, async (req: Request, res: Response) => {
  try {
    const txidVal = validateTxid(req.params.txid);
    if (!txidVal.isValid) {
      return res.status(400).json({ error: txidVal.error });
    }

    const note = await dbService.getNoteByTxid(txidVal.value!);
    if (!note) {
      return res.status(404).json({ error: 'Transaction not found in indexed records' });
    }
    res.json({ transaction: note });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Privileged on-chain transaction indexing with strict validation and verification
apiRouter.post('/transactions/index-confirmed', requireAuth('admin'), writeLimiter, async (req: Request, res: Response) => {
  try {
    const { key_id, txid, block_height, block_time, pool, amount_zec, memo, verify_on_chain } = req.body;

    const txidVal = validateTxid(txid);
    if (!txidVal.isValid) {
      return res.status(400).json({ error: txidVal.error });
    }

    const keyId = parseInt(key_id, 10);
    if (!keyId || isNaN(keyId)) {
      return res.status(400).json({ error: 'Valid key_id is required' });
    }

    const keyRecord = await dbService.getViewingKeyById(keyId);
    if (!keyRecord) {
      return res.status(404).json({ error: `Viewing key #${keyId} not found. Cannot associate transaction.` });
    }

    const chainTip = chainSyncer.getLatestTip();
    const heightVal = validateBlockHeight(block_height, chainTip);
    if (!heightVal.isValid) {
      return res.status(400).json({ error: heightVal.error });
    }

    const amountVal = validateAmountZec(amount_zec || 0.00001);
    if (!amountVal.isValid) {
      return res.status(400).json({ error: amountVal.error });
    }

    const poolVal = validatePool(pool);
    if (!poolVal.isValid) {
      return res.status(400).json({ error: poolVal.error });
    }

    const memoVal = validateMemo(memo);
    if (!memoVal.isValid) {
      return res.status(400).json({ error: memoVal.error });
    }

    const cleanTxid = txidVal.value!;
    let finalAmount = amountVal.value!;
    let finalZat = Math.round(finalAmount * 100_000_000);
    let finalPool = poolVal.value!;
    let finalMemo = memoVal.value || '';
    let finalBlockTime = parseInt(block_time, 10) || Math.floor(Date.now() / 1000);
    let finalBlockHash = '';
    let finalOutputIndex = 0;
    let finalTransferType = 'incoming';

    // Rigorous on-chain verification against trusted lightwalletd & viewing key (Item 1)
    if (verify_on_chain === true || config.nodeEnv === 'production') {
      const verif = await verifyTransactionOnChain({
        txid: cleanTxid,
        blockHeight: heightVal.value!,
        viewingKeyString: keyRecord.key_string,
        targetGrpcUrl: config.lightwalletdUrl,
        network: config.network
      });

      if (!verif.verified) {
        return res.status(400).json({
          error: verif.error || 'On-chain verification failed: Transaction not confirmed on Zcash network or note trial-decryption failed.'
        });
      }

      // Derive note metadata and amounts directly from verified chain data
      finalAmount = verif.amountZec!;
      finalZat = verif.amountZat!;
      finalPool = verif.pool!;
      finalMemo = verif.memoText || '';
      finalBlockTime = verif.blockTime || finalBlockTime;
      finalBlockHash = verif.blockHash || '';
      finalOutputIndex = verif.outputIndex || 0;
      finalTransferType = verif.transferType || 'incoming';
    }

    const note = await dbService.addShieldedNote({
      key_id: keyId,
      txid: cleanTxid,
      output_index: finalOutputIndex,
      block_height: heightVal.value!,
      block_hash: finalBlockHash,
      block_time: finalBlockTime,
      pool: finalPool,
      amount_zat: finalZat,
      amount_zec: finalAmount,
      transfer_type: finalTransferType,
      memo_text: finalMemo,
      is_simulated: 0,
      verification_status: 'confirmed'
    });

    if (note) {
      auditLog(req, 'INDEX_CONFIRMED_TRANSACTION', { txid: cleanTxid, block_height: heightVal.value, amount_zec: finalAmount });
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

// --- Webhooks Management (Protected) ---
apiRouter.post('/webhooks', requireAuth('admin'), writeLimiter, async (req: Request, res: Response) => {
  try {
    const { target_url, secret, description } = req.body;
    if (!target_url || typeof target_url !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid "target_url"' });
    }

    const trimmedUrl = target_url.trim();

    // SSRF Validation
    const ssrfCheck = await validateWebhookUrl(trimmedUrl, config.allowHttpWebhooks, config.allowLocalhostWebhooks);
    if (!ssrfCheck.isValid) {
      return res.status(400).json({
        error: `Webhook registration rejected by SSRF policy: ${ssrfCheck.error}`
      });
    }

    const signingSecret = secret && typeof secret === 'string' && secret.trim()
      ? secret.trim()
      : 'whsec_' + crypto.randomBytes(24).toString('hex');

    const webhook = await dbService.addWebhook(trimmedUrl, signingSecret, description || '');

    auditLog(req, 'CREATE_WEBHOOK', { id: webhook.id, target_url: trimmedUrl });

    res.status(201).json({
      message: 'Webhook registered successfully',
      webhook: sanitizeWebhook(webhook),
      signing_secret: signingSecret, // Revealed ONLY once upon registration
      signing_secret_reminder: 'Save this signing secret now. It is encrypted at rest and will not be displayed again.'
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/webhooks', requireAuth('read'), readLimiter, async (req: Request, res: Response) => {
  try {
    const webhooks = await dbService.getActiveWebhooks();
    res.json({ webhooks: webhooks.map((w) => sanitizeWebhook(w, true)) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.delete('/webhooks/:id', requireAuth('admin'), writeLimiter, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid webhook ID' });
    }
    const deleted = await dbService.deleteWebhook(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    auditLog(req, 'DELETE_WEBHOOK', { id });
    res.json({ message: 'Webhook and associated delivery history deleted successfully', id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/webhooks/deliveries', requireAuth('read'), readLimiter, async (req: Request, res: Response) => {
  try {
    const limitVal = validatePagination(req.query.limit, 50, 100);
    if (!limitVal.isValid) {
      return res.status(400).json({ error: limitVal.error });
    }
    const deliveries = await dbService.getWebhookDeliveries(limitVal.value);
    res.json({ count: deliveries.length, deliveries });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Demo & Pitch Simulator (Protected, Safe Simulation with Production Webhook) ---
apiRouter.post('/simulator/simulate', requireAuth('admin'), writeLimiter, async (req: Request, res: Response) => {
  try {
    const { key_id, amount_zec, memo, pool, transfer_type, txid, block_height } = req.body;

    const amountVal = validateAmountZec(amount_zec || 0.75);
    if (!amountVal.isValid) {
      return res.status(400).json({ error: amountVal.error });
    }

    const poolVal = validatePool(pool);
    if (!poolVal.isValid) {
      return res.status(400).json({ error: poolVal.error });
    }

    const memoInput = memo !== undefined ? memo : 'Hackathon Demo Payment - Invoice #ZEC-9901';
    const memoVal = validateMemo(memoInput);
    if (!memoVal.isValid) {
      return res.status(400).json({ error: memoVal.error });
    }

    const note = await PaymentSimulator.simulatePayment({
      keyId: key_id ? parseInt(key_id, 10) : undefined,
      amountZec: amountVal.value!,
      memo: memoVal.value!,
      pool: poolVal.value!,
      transferType: transfer_type || 'incoming',
      txid: txid || undefined,
      blockHeight: block_height ? parseInt(block_height, 10) : undefined
    });

    auditLog(req, 'SIMULATE_PAYMENT', { note_id: note.id, amount_zec: note.amount_zec, pool: note.pool });

    res.status(201).json({
      message: 'Simulated payment recorded and simulation webhook dispatched',
      transaction: note
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Chain Reorganization Handling (Admin Only) ---
apiRouter.post('/reorg/simulate', requireAuth('admin'), writeLimiter, async (req: Request, res: Response) => {
  try {
    const { fork_height } = req.body;
    const heightVal = validateBlockHeight(fork_height);
    if (!heightVal.isValid) {
      return res.status(400).json({ error: heightVal.error });
    }

    const result = await chainSyncer.handleReorganization(heightVal.value!);
    auditLog(req, 'SIMULATE_REORG', {
      fork_height: heightVal.value,
      affected_notes_count: result.rolledBackNotes.length
    });

    res.json({
      message: `Chain reorganization successfully processed back to fork height ${heightVal.value}`,
      fork_height: heightVal.value,
      rolled_back_notes_count: result.rolledBackNotes.length,
      rolled_back_notes: result.rolledBackNotes
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Dead-Letter Queue & Scanner Error Tracking ---
apiRouter.get('/syncer/errors', requireAuth('read'), readLimiter, async (req: Request, res: Response) => {
  try {
    const limitVal = validatePagination(req.query.limit, 50, 100);
    const status = req.query.status as string | undefined;
    const errors = await dbService.getScanErrors(status, limitVal.value);
    res.json({ count: errors.length, errors });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/syncer/errors/:id/resolve', requireAuth('admin'), writeLimiter, async (req: Request, res: Response) => {
  try {
    const errorId = parseInt(req.params.id as string, 10);
    if (isNaN(errorId)) {
      return res.status(400).json({ error: 'Invalid error ID' });
    }
    const resolved = await dbService.resolveScanError(errorId);
    if (!resolved) {
      return res.status(404).json({ error: 'Scan error record not found' });
    }
    auditLog(req, 'RESOLVE_SCAN_ERROR', { error_id: errorId });
    res.json({ message: `Scan error #${errorId} marked as resolved` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Ephemeral Wallet Pairing Sessions (Protected) ---
interface WalletPairSession {
  sessionId: string;
  token: string;
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
apiRouter.post('/wallet-pair/session', requireAuth('admin'), writeLimiter, (req: Request, res: Response) => {
  cleanupSessions();
  const sessionId = 'zpair_' + crypto.randomBytes(12).toString('hex');
  const token = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  const expiresAt = now + 5 * 60 * 1000; // 5 minutes validity

  const session: WalletPairSession = {
    sessionId,
    token,
    createdAt: now,
    expiresAt,
    status: 'pending'
  };

  pairSessions.set(sessionId, session);

  res.json({
    session_id: sessionId,
    token,
    expires_at: expiresAt,
    qr_payload: JSON.stringify({
      app: 'ZecShield Gateway',
      action: 'connect_wallet',
      session_id: sessionId,
      token,
      network: config.network,
      endpoint: `${req.protocol}://${req.get('host')}/api/wallet-pair/session/${sessionId}/approve`
    })
  });
});

// 2. Poll session status
apiRouter.get('/wallet-pair/session/:id', readLimiter, (req: Request, res: Response) => {
  cleanupSessions();
  const id = req.params.id as string;
  const session = pairSessions.get(id);

  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired', status: 'expired' });
  }

  // Only return detailed key metadata if the client provides the correct challenge token (SEC-02)
  const providedToken = req.header('x-pairing-token') || (req.query.token as string);
  const isAuthorized = typeof providedToken === 'string' &&
    providedToken.length === session.token.length &&
    crypto.timingSafeEqual(Buffer.from(providedToken), Buffer.from(session.token));

  res.json({
    session_id: session.sessionId,
    status: session.status,
    key: isAuthorized && session.key ? sanitizeViewingKey(session.key) : null
  });
});

// 3. Approve wallet pairing (from mobile companion or scanner)
apiRouter.post('/wallet-pair/session/:id/approve', writeLimiter, async (req: Request, res: Response) => {
  cleanupSessions();
  const id = req.params.id as string;
  const session = pairSessions.get(id);

  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }

  // Enforce cryptographic challenge-response token authentication (SEC-02)
  const providedToken = req.header('x-pairing-token') || req.body?.token || (req.query.token as string);
  const isAuthorized = typeof providedToken === 'string' &&
    providedToken.length === session.token.length &&
    crypto.timingSafeEqual(Buffer.from(providedToken), Buffer.from(session.token));

  if (!isAuthorized) {
    return res.status(401).json({
      error: 'Unauthorized: Invalid or missing pairing challenge token. ' +
             'Provide the token issued during session creation via "X-Pairing-Token" header or "token" body field.'
    });
  }

  const { key, label, birth_height, key_type } = req.body;
  const keyVal = validateViewingKeyInput(key, key_type);
  if (!keyVal.isValid) {
    return res.status(400).json({ error: keyVal.error });
  }

  const trimmedKey = keyVal.value!.cleanKey;
  let existing = await dbService.getViewingKeyByString(trimmedKey);
  let record = existing;

  if (!record) {
    const birthHeightVal = validateBlockHeight(birth_height !== undefined ? birth_height : 0);
    record = await dbService.addViewingKey(
      trimmedKey,
      keyVal.value!.determinedType,
      label || 'Connected Mobile Wallet',
      birthHeightVal.value || 0
    );
  }

  session.status = 'approved';
  session.key = record;

  res.json({
    message: 'Wallet successfully approved and registered with ZecShield',
    key: sanitizeViewingKey(record)
  });
});

// --- System & Database Reset (Strict Admin Only) ---
const handleReset = async (req: Request, res: Response) => {
  try {
    const keepKeys = req.body?.keep_keys === true;
    await dbService.resetDatabase({ keepKeys });
    auditLog(req, 'RESET_DATABASE', { keepKeys });
    res.json({
      message: keepKeys
        ? 'Shielded notes and webhook deliveries cleared. Monitored keys retained.'
        : 'Database reset completely. All keys, notes, and webhooks wiped.',
      status: 'ok'
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

apiRouter.post('/system/reset', requireAuth('admin'), writeLimiter, handleReset);
apiRouter.post('/debug/purge', requireAuth('admin'), writeLimiter, handleReset);
apiRouter.post('/admin/purge', requireAuth('admin'), writeLimiter, handleReset);
