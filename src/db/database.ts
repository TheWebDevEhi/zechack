import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export interface ViewingKeyRecord {
  id: number;
  key_string: string;
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
  private db: SqlJsDatabase | null = null;
  private dbPath: string;

  constructor(dbPath: string = config.dbPath) {
    this.dbPath = dbPath;
  }

  public async init(): Promise<void> {
    const SQL = await initSqlJs();
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(this.dbPath)) {
      const fileBuffer = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(fileBuffer);
    } else {
      this.db = new SQL.Database();
      this.save();
    }

    this.createTables();
  }

  private save(): void {
    if (!this.db) return;
    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(this.dbPath, buffer);
  }

  private createTables(): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(`
      CREATE TABLE IF NOT EXISTS viewing_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_string TEXT UNIQUE NOT NULL,
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
    this.save();
  }

  // --- Viewing Keys ---
  public addViewingKey(
    keyString: string,
    keyType: string,
    label: string,
    birthHeight: number
  ): ViewingKeyRecord {
    if (!this.db) throw new Error('Database not initialized');
    const now = Math.floor(Date.now() / 1000);

    const stmt = this.db.prepare(
      `INSERT INTO viewing_keys (key_string, key_type, label, birth_height, last_scanned_height, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`
    );
    stmt.run([keyString, keyType, label, birthHeight, birthHeight, now]);
    stmt.free();
    this.save();

    return this.getViewingKeyByString(keyString)!;
  }

  public getViewingKeys(onlyActive: boolean = true): ViewingKeyRecord[] {
    if (!this.db) throw new Error('Database not initialized');
    const query = onlyActive
      ? 'SELECT * FROM viewing_keys WHERE is_active = 1 ORDER BY id DESC'
      : 'SELECT * FROM viewing_keys ORDER BY id DESC';

    const res = this.db.exec(query);
    if (!res.length) return [];

    const columns = res[0].columns;
    return res[0].values.map((row) => {
      const obj: any = {};
      columns.forEach((col, idx) => (obj[col] = row[idx]));
      return obj as ViewingKeyRecord;
    });
  }

  public getViewingKeyById(id: number): ViewingKeyRecord | null {
    if (!this.db) throw new Error('Database not initialized');
    const stmt = this.db.prepare('SELECT * FROM viewing_keys WHERE id = ?');
    stmt.bind([id]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as unknown as ViewingKeyRecord;
      stmt.free();
      return row;
    }
    stmt.free();
    return null;
  }

  public getViewingKeyByString(keyString: string): ViewingKeyRecord | null {
    if (!this.db) throw new Error('Database not initialized');
    const stmt = this.db.prepare('SELECT * FROM viewing_keys WHERE key_string = ?');
    stmt.bind([keyString]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as unknown as ViewingKeyRecord;
      stmt.free();
      return row;
    }
    stmt.free();
    return null;
  }

  public updateLastScannedHeight(keyId: number, height: number): void {
    if (!this.db) throw new Error('Database not initialized');
    const stmt = this.db.prepare('UPDATE viewing_keys SET last_scanned_height = ? WHERE id = ?');
    stmt.run([height, keyId]);
    stmt.free();
    this.save();
  }

  public deleteViewingKey(id: number): boolean {
    if (!this.db) throw new Error('Database not initialized');
    const checkStmt = this.db.prepare('SELECT id FROM viewing_keys WHERE id = ?');
    checkStmt.bind([id]);
    const exists = checkStmt.step();
    checkStmt.free();
    if (!exists) return false;

    // Delete associated notes and viewing key
    const notesStmt = this.db.prepare('DELETE FROM shielded_notes WHERE key_id = ?');
    notesStmt.run([id]);
    notesStmt.free();

    const delStmt = this.db.prepare('DELETE FROM viewing_keys WHERE id = ?');
    delStmt.run([id]);
    delStmt.free();

    this.save();
    return true;
  }

  // --- Shielded Notes ---
  public addShieldedNote(note: Omit<ShieldedNoteRecord, 'id' | 'created_at'>): ShieldedNoteRecord | null {
    if (!this.db) throw new Error('Database not initialized');
    const now = Math.floor(Date.now() / 1000);

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO shielded_notes 
      (key_id, txid, block_height, block_time, pool, amount_zat, amount_zec, transfer_type, memo_text, is_simulated, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run([
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
      now
    ]);
    stmt.free();

    // Check if a row was actually inserted
    const rowsModified = this.db.getRowsModified();
    if (rowsModified === 0) {
      // Note was already indexed; return null so callers do not dispatch duplicate webhooks
      return null;
    }

    this.save();

    // Query back the newly inserted note
    const q = this.db.prepare('SELECT * FROM shielded_notes WHERE key_id = ? AND txid = ? AND pool = ? AND amount_zat = ?');
    q.bind([note.key_id, note.txid, note.pool, note.amount_zat]);
    if (q.step()) {
      const res = q.getAsObject() as unknown as ShieldedNoteRecord;
      q.free();
      return res;
    }
    q.free();
    return null;
  }

  public getShieldedNotes(limit: number = 50, keyId?: number): ShieldedNoteRecord[] {
    if (!this.db) throw new Error('Database not initialized');
    let query = 'SELECT * FROM shielded_notes';
    const params: any[] = [];

    if (keyId !== undefined) {
      query += ' WHERE key_id = ?';
      params.push(keyId);
    }
    query += ' ORDER BY block_height DESC, id DESC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(query);
    stmt.bind(params);
    const results: ShieldedNoteRecord[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject() as unknown as ShieldedNoteRecord);
    }
    stmt.free();
    return results;
  }

  public getNoteByTxid(txid: string): ShieldedNoteRecord | null {
    if (!this.db) throw new Error('Database not initialized');
    const stmt = this.db.prepare('SELECT * FROM shielded_notes WHERE txid = ? LIMIT 1');
    stmt.bind([txid]);
    if (stmt.step()) {
      const res = stmt.getAsObject() as unknown as ShieldedNoteRecord;
      stmt.free();
      return res;
    }
    stmt.free();
    return null;
  }

  // --- Webhooks ---
  public addWebhook(targetUrl: string, secret: string, description: string = ''): WebhookRecord {
    if (!this.db) throw new Error('Database not initialized');
    const now = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare(
      'INSERT INTO webhooks (target_url, secret, description, is_active, created_at) VALUES (?, ?, ?, 1, ?)'
    );
    stmt.run([targetUrl, secret, description, now]);
    stmt.free();
    this.save();

    const q = this.db.prepare('SELECT * FROM webhooks WHERE target_url = ? ORDER BY id DESC LIMIT 1');
    q.bind([targetUrl]);
    q.step();
    const res = q.getAsObject() as unknown as WebhookRecord;
    q.free();
    return res;
  }

  public getActiveWebhooks(): WebhookRecord[] {
    if (!this.db) throw new Error('Database not initialized');
    const stmt = this.db.prepare('SELECT * FROM webhooks WHERE is_active = 1');
    const list: WebhookRecord[] = [];
    while (stmt.step()) {
      list.push(stmt.getAsObject() as unknown as WebhookRecord);
    }
    stmt.free();
    return list;
  }

  public logWebhookDelivery(
    webhookId: number,
    noteId: number,
    payload: string,
    statusCode: number,
    responseBody: string
  ): void {
    if (!this.db) throw new Error('Database not initialized');
    const now = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare(`
      INSERT INTO webhook_deliveries (webhook_id, note_id, payload, status_code, response_body, delivered_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run([webhookId, noteId, payload, statusCode, responseBody, now]);
    stmt.free();
    this.save();
  }

  public getWebhookDeliveries(limit: number = 50): WebhookDeliveryRecord[] {
    if (!this.db) throw new Error('Database not initialized');
    const stmt = this.db.prepare('SELECT * FROM webhook_deliveries ORDER BY id DESC LIMIT ?');
    stmt.bind([limit]);
    const list: WebhookDeliveryRecord[] = [];
    while (stmt.step()) {
      list.push(stmt.getAsObject() as unknown as WebhookDeliveryRecord);
    }
    stmt.free();
    return list;
  }

  // --- Stats ---
  public getStats(): { totalKeys: number; totalNotes: number; totalZat: number } {
    if (!this.db) throw new Error('Database not initialized');
    const keysCount = this.db.exec('SELECT COUNT(*) as count FROM viewing_keys')[0]?.values[0][0] as number || 0;
    const notesRes = this.db.exec('SELECT COUNT(*) as count, COALESCE(SUM(amount_zat), 0) as total FROM shielded_notes')[0]?.values[0] || [0, 0];
    return {
      totalKeys: keysCount,
      totalNotes: notesRes[0] as number,
      totalZat: notesRes[1] as number
    };
  }

  public deleteWebhook(id: number): boolean {
    if (!this.db) throw new Error('Database not initialized');
    const checkStmt = this.db.prepare('SELECT id FROM webhooks WHERE id = ?');
    checkStmt.bind([id]);
    const exists = checkStmt.step();
    checkStmt.free();
    if (!exists) return false;

    // Delete deliveries associated with this webhook and the webhook record
    const delivStmt = this.db.prepare('DELETE FROM webhook_deliveries WHERE webhook_id = ?');
    delivStmt.run([id]);
    delivStmt.free();

    const stmt = this.db.prepare('DELETE FROM webhooks WHERE id = ?');
    stmt.run([id]);
    stmt.free();

    this.save();
    return true;
  }

  // --- Reset Database ---
  public resetDatabase(options: { keepKeys?: boolean } = {}): void {
    if (!this.db) throw new Error('Database not initialized');
    if (options.keepKeys) {
      this.db.run(`
        DELETE FROM shielded_notes;
        DELETE FROM webhook_deliveries;
        DELETE FROM sqlite_sequence WHERE name IN ('shielded_notes', 'webhook_deliveries');
      `);
    } else {
      this.db.run(`
        DELETE FROM shielded_notes;
        DELETE FROM webhook_deliveries;
        DELETE FROM webhooks;
        DELETE FROM viewing_keys;
        DELETE FROM sqlite_sequence WHERE name IN ('shielded_notes', 'webhook_deliveries', 'webhooks', 'viewing_keys');
      `);
    }
    this.save();
  }
}

export const dbService = new DatabaseService();
