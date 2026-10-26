import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';

dotenv.config();

export interface AppConfig {
  port: number;
  network: 'testnet' | 'mainnet';
  lightwalletdUrl: string;
  dbPath: string;
  tursoDatabaseUrl?: string;
  tursoAuthToken?: string;
  syncIntervalMs: number;
  batchSize: number;
  nodeEnv: string;
  adminApiKey: string;
  readApiKey?: string;
  encryptionKey: string;
  allowHttpWebhooks: boolean;
  allowLocalhostWebhooks: boolean;
  corsOrigin?: string;
  trustProxy?: boolean | string;
}

const isMainnet = process.env.NETWORK === 'mainnet';
const nodeEnv = process.env.NODE_ENV || 'development';

// 1. Resolve ADMIN_API_KEY (SEC-01: Enforce persistent key in production)
let adminApiKey = process.env.ADMIN_API_KEY || (nodeEnv === 'production' ? '' : 'zc_admin_test_secret_key');
if (nodeEnv === 'production') {
  if (!adminApiKey || adminApiKey === 'zc_admin_test_secret_key') {
    throw new Error(
      '[FATAL SECURITY ERROR] Insecure or missing ADMIN_API_KEY in production. ' +
      'You must configure a persistent high-entropy ADMIN_API_KEY (minimum 16 characters) in your deployment environment variables or secret manager.'
    );
  }
  if (adminApiKey.length < 16) {
    throw new Error('[FATAL SECURITY ERROR] ADMIN_API_KEY in production must be at least 16 characters long.');
  }
}

// 2. Resolve ENCRYPTION_KEY (SEC-01 & SEC-06: Enforce persistent key in production, prohibit ephemeral container files)
let encryptionKey = process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_SECRET || (nodeEnv === 'production' ? '' : 'zecshield_master_encryption_key_32_bytes!!');
if (nodeEnv === 'production') {
  if (!encryptionKey || encryptionKey === 'zecshield_master_encryption_key_32_bytes!!') {
    throw new Error(
      '[FATAL SECURITY ERROR] Insecure or missing ENCRYPTION_KEY in production. ' +
      'You must configure a persistent 32-byte ENCRYPTION_KEY in your deployment environment variables or secret manager. ' +
      'Ephemeral container-local file storage is strictly prohibited to guarantee decryption persistence across container redeployments.'
    );
  }
  if (Buffer.from(encryptionKey, 'utf8').length < 32) {
    throw new Error('[FATAL SECURITY ERROR] ENCRYPTION_KEY in production must be at least 32 bytes.');
  }
}

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '3001', 10),
  network: isMainnet ? 'mainnet' : 'testnet',
  lightwalletdUrl: process.env.LIGHTWALLETD_URL || (isMainnet ? 'https://na.zec.rocks:443' : 'https://testnet.zec.rocks:443'),
  dbPath: process.env.DB_PATH || path.resolve(process.cwd(), 'data', 'zecshield.db'),
  tursoDatabaseUrl: process.env.TURSO_DATABASE_URL?.trim() || undefined,
  tursoAuthToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined,
  syncIntervalMs: parseInt(process.env.SYNC_INTERVAL_MS || '10000', 10), // check for new blocks every 10s
  batchSize: parseInt(process.env.BATCH_SIZE || '500', 10),
  nodeEnv,
  adminApiKey,
  readApiKey: process.env.READ_API_KEY || undefined,
  encryptionKey,
  allowHttpWebhooks: process.env.ALLOW_HTTP_WEBHOOKS === 'true' || nodeEnv === 'development' || nodeEnv === 'test',
  allowLocalhostWebhooks: process.env.ALLOW_LOCALHOST_WEBHOOKS === 'true' || nodeEnv === 'test',
  corsOrigin: process.env.CORS_ORIGIN || undefined,
  trustProxy: process.env.TRUST_PROXY === 'true' ? true : process.env.TRUST_PROXY || false,
};
