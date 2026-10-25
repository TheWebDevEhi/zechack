import { createClient, Client } from '@libsql/client';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../config.js';
import { encryptCredential, decryptCredential } from '../security/encryption.js';

export interface ViewingKeyRecord {
  id: number;
  key_string: string;
  key_hash?: string;
  key_type: string;
  label: string;
  birth_height: number;
  last_scanned_height: number;
  is_active: number;
  created_at: number;
}

export interface ShieldedNoteRecord {
  id: number;
  key_id: number;
  txid: string;
  block_height: number;
  block_time: number;
  pool: 'Orchard' | 'Sapling' | 'Ironwood';
  amount_zat: number;
  amount_zec: number;
  transfer_type: string;
  memo_text: string;
  is_simulated: number;
  verification_status: 'confirmed' | 'simulated' | 'unverified';
  created_at: number;
}

export interface WebhookRecord {
  id: number;
  target_url: string;
  secret: string;
  description: string;
  is_active: number;
  created_at: number;
}

export interface WebhookDeliveryRecord {
  id: number;
  webhook_id: number;
  note_id: number;
  payload: string;
  status_code: number;
  response_body: string;
  delivered_at: number;
}

export class DatabaseService {
  private client: Client | null = null;
  private dbPath: string;
  private mode: 'turso' | 'local' = 'local';

  constructor(dbPath: string = config.dbPath) {
    this.dbPath = dbPath;
  }

  public getMode(): 'turso' | 'local' {
    return this.mode;
  }

  public async init(): Promise<void> {
    if (config.tursoDatabaseUrl) {
      this.mode = 'turso';
      console.log(`[DB] Initializing hybrid database in TURSO cloud mode...`);
      console.log(`[DB] Turso URL: ${config.tursoDatabaseUrl}`);
      this.client = createClient({
        url: config.tursoDatabaseUrl,
        authToken: config.tursoAuthToken,
      });
    } else {
      this.mode = 'local';
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const normalizedPath = path.resolve(this.dbPath).replace(/\\/g, '/');
      console.log(`[DB] Initializing hybrid database in LOCAL file mode...`);
      console.log(`[DB] Database file: ${normalizedPath}`);
      this.client = createClient({
        url: `file:${normalizedPath}`,
      });
    }

    await this.createTables();
  }

  private async createTables(): Promise<void> {
    if (!this.client) throw new Error('Database not initialized');

    await this.client.executeMultiple(`
      CREATE TABLE IF NOT EXISTS viewing_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_string TEXT NOT NULL,
        key_hash TEXT UNIQUE,
        key_type TEXT NOT NULL,
        label TEXT,
        birth_height INTEGER NOT NULL DEFAULT 0,
        last_scanned_height INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS shielded_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_id INTEGER NOT NULL,
        txid TEXT NOT NULL,
        block_height INTEGER NOT NULL,
        block_time INTEGER NOT NULL,
        pool TEXT NOT NULL,
        amount_zat INTEGER NOT NULL,
        amount_zec REAL NOT NULL,
        transfer_type TEXT NOT NULL,
        memo_text TEXT,
        is_simulated INTEGER NOT NULL DEFAULT 0,
        verification_status TEXT NOT NULL DEFAULT 'confirmed',
        created_at INTEGER NOT NULL,
        UNIQUE(key_id, txid, pool, amount_zat) ON CONFLICT IGNORE
      );

      CREATE TABLE IF NOT EXISTS webhooks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_url TEXT NOT NULL,
        secret TEXT NOT NULL,
        description TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        webhook_id INTEGER NOT NULL,
        note_id INTEGER NOT NULL,
        payload TEXT NOT NULL,
        status_code INTEGER,
        response_body TEXT,
        delivered_at INTEGER NOT NULL
      );
    `);

    // Run graceful schema migrations on existing SQLite/Turso tables
    try {
      await this.client.execute('ALTER TABLE viewing_keys ADD COLUMN key_hash TEXT');
    } catch {}
    try {
      await this.client.execute("ALTER TABLE shielded_notes ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'confirmed'");
    } catch {}
  }

  // --- Viewing Keys ---
  public async addViewingKey(
    keyString: string,
    keyType: string,
    label: string,
    birthHeight: number
  ): Promise<ViewingKeyRecord> {
    if (!this.client) throw new Error('Database not initialized');
    const now = Math.floor(Date.now() / 1000);
    const keyHash = crypto.createHash('sha256').update(keyString).digest('hex');
    const encryptedKey = encryptCredential(keyString);

    await this.client.execute({
      sql: `INSERT INTO viewing_keys (key_string, key_hash, key_type, label, birth_height, last_scanned_height, is_active, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      args: [encryptedKey, keyHash, keyType, label, birthHeight, birthHeight, now]
    });

    const created = await this.getViewingKeyByString(keyString);
    if (!created) throw new Error('Failed to retrieve newly added viewing key');
    return created;
  }

  public async getViewingKeys(onlyActive: boolean = true): Promise<ViewingKeyRecord[]> {
    if (!this.client) throw new Error('Database not initialized');
    const query = onlyActive
      ? 'SELECT * FROM viewing_keys WHERE is_active = 1 ORDER BY id DESC'
      : 'SELECT * FROM viewing_keys ORDER BY id DESC';

    const res = await this.client.execute(query);
    return res.rows.map((row: any) => ({
      ...row,
      key_string: decryptCredential(row.key_string as string)
    })) as unknown as ViewingKeyRecord[];
  }

  public async getViewingKeyById(id: number): Promise<ViewingKeyRecord | null> {
    if (!this.client) throw new Error('Database not initialized');
    const res = await this.client.execute({
      sql: 'SELECT * FROM viewing_keys WHERE id = ? LIMIT 1',
      args: [id]
    });
    if (res.rows.length === 0) return null;
    const row = res.rows[0] as any;
    return {
      ...row,
      key_string: decryptCredential(row.key_string as string)
    } as unknown as ViewingKeyRecord;
  }

  public async getViewingKeyByString(keyString: string): Promise<ViewingKeyRecord | null> {
    if (!this.client) throw new Error('Database not initialized');
    const keyHash = crypto.createHash('sha256').update(keyString).digest('hex');
    const res = await this.client.execute({
      sql: 'SELECT * FROM viewing_keys WHERE key_hash = ? OR key_string = ? LIMIT 1',
      args: [keyHash, keyString]
    });
    if (res.rows.length === 0) return null;
    const row = res.rows[0] as any;
    return {
      ...row,
      key_string: decryptCredential(row.key_string as string)
    } as unknown as ViewingKeyRecord;
  }

  public async updateLastScannedHeight(keyId: number, height: number): Promise<void> {
    if (!this.client) throw new Error('Database not initialized');
    await this.client.execute({
      sql: 'UPDATE viewing_keys SET last_scanned_height = ? WHERE id = ?',
      args: [height, keyId]
    });
  }

  public async deleteViewingKey(id: number): Promise<boolean> {
    if (!this.client) throw new Error('Database not initialized');
    const checkRes = await this.client.execute({
      sql: 'SELECT id FROM viewing_keys WHERE id = ? LIMIT 1',
      args: [id]
    });
    if (checkRes.rows.length === 0) return false;

    // Delete associated notes and viewing key
    await this.client.execute({
      sql: 'DELETE FROM shielded_notes WHERE key_id = ?',
      args: [id]
    });
    await this.client.execute({
      sql: 'DELETE FROM viewing_keys WHERE id = ?',
      args: [id]
    });

    return true;
  }

  // --- Shielded Notes ---
  public async addShieldedNote(note: Omit<ShieldedNoteRecord, 'id' | 'created_at'>): Promise<ShieldedNoteRecord | null> {
    if (!this.client) throw new Error('Database not initialized');
    const now = Math.floor(Date.now() / 1000);
    const verificationStatus = note.verification_status || (note.is_simulated ? 'simulated' : 'confirmed');

    const insertRes = await this.client.execute({
      sql: `
        INSERT OR IGNORE INTO shielded_notes 
        (key_id, txid, block_height, block_time, pool, amount_zat, amount_zec, transfer_type, memo_text, is_simulated, verification_status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        note.key_id,
        note.txid,
        note.block_height,
        note.block_time,
        note.pool,
        note.amount_zat,
        note.amount_zec,
        note.transfer_type,
        note.memo_text || '',
        note.is_simulated || 0,
        verificationStatus,
        now
      ]
    });

    if (insertRes.rowsAffected === 0) {
      // Note was already indexed; return null so callers do not dispatch duplicate webhooks
      return null;
    }

    // Query back the newly inserted note
    const q = await this.client.execute({
      sql: 'SELECT * FROM shielded_notes WHERE key_id = ? AND txid = ? AND pool = ? AND amount_zat = ? LIMIT 1',
      args: [note.key_id, note.txid, note.pool, note.amount_zat]
    });

    if (q.rows.length > 0) {
      return q.rows[0] as unknown as ShieldedNoteRecord;
    }
    return null;
  }

  public async getShieldedNotes(limit: number = 50, keyId?: number): Promise<ShieldedNoteRecord[]> {
    if (!this.client) throw new Error('Database not initialized');
    let query = 'SELECT * FROM shielded_notes';
    const params: any[] = [];

    if (keyId !== undefined) {
      query += ' WHERE key_id = ?';
      params.push(keyId);
    }
    query += ' ORDER BY block_height DESC, id DESC LIMIT ?';
    params.push(limit);

    const res = await this.client.execute({
      sql: query,
      args: params
    });
    return res.rows as unknown as ShieldedNoteRecord[];
  }

  public async getNoteByTxid(txid: string): Promise<ShieldedNoteRecord | null> {
    if (!this.client) throw new Error('Database not initialized');
    const res = await this.client.execute({
      sql: 'SELECT * FROM shielded_notes WHERE txid = ? LIMIT 1',
      args: [txid]
    });
    if (res.rows.length === 0) return null;
    return res.rows[0] as unknown as ShieldedNoteRecord;
  }

  // --- Webhooks ---
  public async addWebhook(targetUrl: string, secret: string, description: string = ''): Promise<WebhookRecord> {
    if (!this.client) throw new Error('Database not initialized');
    const now = Math.floor(Date.now() / 1000);
    const encryptedSecret = encryptCredential(secret);

    await this.client.execute({
      sql: 'INSERT INTO webhooks (target_url, secret, description, is_active, created_at) VALUES (?, ?, ?, 1, ?)',
      args: [targetUrl, encryptedSecret, description, now]
    });

    const res = await this.client.execute({
      sql: 'SELECT * FROM webhooks WHERE target_url = ? ORDER BY id DESC LIMIT 1',
      args: [targetUrl]
    });
    const row = res.rows[0] as any;
    return {
      ...row,
      secret: decryptCredential(row.secret as string)
    } as unknown as WebhookRecord;
  }

  public async getActiveWebhooks(): Promise<WebhookRecord[]> {
    if (!this.client) throw new Error('Database not initialized');
    const res = await this.client.execute('SELECT * FROM webhooks WHERE is_active = 1');
    return res.rows.map((row: any) => ({
      ...row,
      secret: decryptCredential(row.secret as string)
    })) as unknown as WebhookRecord[];
  }

  public async logWebhookDelivery(
    webhookId: number,
    noteId: number,
    payload: string,
    statusCode: number,
    responseBody: string
  ): Promise<void> {
    if (!this.client) throw new Error('Database not initialized');
    const now = Math.floor(Date.now() / 1000);
    await this.client.execute({
      sql: `INSERT INTO webhook_deliveries (webhook_id, note_id, payload, status_code, response_body, delivered_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [webhookId, noteId, payload, statusCode, responseBody, now]
    });
  }

  public async getWebhookDeliveries(limit: number = 50): Promise<WebhookDeliveryRecord[]> {
    if (!this.client) throw new Error('Database not initialized');
    const res = await this.client.execute({
      sql: 'SELECT * FROM webhook_deliveries ORDER BY id DESC LIMIT ?',
      args: [limit]
    });
    return res.rows as unknown as WebhookDeliveryRecord[];
  }

  public async hasSuccessfulDelivery(webhookId: number, noteId: number): Promise<boolean> {
    if (!this.client) throw new Error('Database not initialized');
    const res = await this.client.execute({
      sql: `SELECT id FROM webhook_deliveries 
            WHERE webhook_id = ? AND note_id = ? AND status_code >= 200 AND status_code < 300 
            LIMIT 1`,
      args: [webhookId, noteId]
    });
    return res.rows.length > 0;
  }

  public async hasDeliveredTxid(webhookId: number, txid: string): Promise<boolean> {
    if (!this.client) throw new Error('Database not initialized');
    const res = await this.client.execute({
      sql: `SELECT wd.id FROM webhook_deliveries wd 
            JOIN shielded_notes sn ON wd.note_id = sn.id 
            WHERE wd.webhook_id = ? AND sn.txid = ? AND wd.status_code >= 200 AND wd.status_code < 300 
            LIMIT 1`,
      args: [webhookId, txid]
    });
    return res.rows.length > 0;
  }

  // --- Stats ---
  public async getStats(): Promise<{ totalKeys: number; totalNotes: number; totalZat: number }> {
    if (!this.client) throw new Error('Database not initialized');
    const keysRes = await this.client.execute('SELECT COUNT(*) as count FROM viewing_keys');
    const notesRes = await this.client.execute('SELECT COUNT(*) as count, COALESCE(SUM(amount_zat), 0) as total FROM shielded_notes');

    const totalKeys = Number(keysRes.rows[0]?.count || 0);
    const totalNotes = Number(notesRes.rows[0]?.count || 0);
    const totalZat = Number(notesRes.rows[0]?.total || 0);

    return {
      totalKeys,
      totalNotes,
      totalZat
    };
  }

  public async deleteWebhook(id: number): Promise<boolean> {
    if (!this.client) throw new Error('Database not initialized');
    const checkRes = await this.client.execute({
      sql: 'SELECT id FROM webhooks WHERE id = ? LIMIT 1',
      args: [id]
    });
    if (checkRes.rows.length === 0) return false;

    // Delete deliveries associated with this webhook and the webhook record
    await this.client.execute({
      sql: 'DELETE FROM webhook_deliveries WHERE webhook_id = ?',
      args: [id]
    });
    await this.client.execute({
      sql: 'DELETE FROM webhooks WHERE id = ?',
      args: [id]
    });

    return true;
  }

  // --- Reset Database ---
  public async resetDatabase(options: { keepKeys?: boolean } = {}): Promise<void> {
    if (!this.client) throw new Error('Database not initialized');
    if (options.keepKeys) {
      await this.client.executeMultiple(`
        DELETE FROM shielded_notes;
        DELETE FROM webhook_deliveries;
        DELETE FROM sqlite_sequence WHERE name IN ('shielded_notes', 'webhook_deliveries');
      `);
    } else {
      await this.client.executeMultiple(`
        DELETE FROM shielded_notes;
        DELETE FROM webhook_deliveries;
        DELETE FROM webhooks;
        DELETE FROM viewing_keys;
        DELETE FROM sqlite_sequence WHERE name IN ('shielded_notes', 'webhook_deliveries', 'webhooks', 'viewing_keys');
      `);
    }
  }
}

export const dbService = new DatabaseService();
