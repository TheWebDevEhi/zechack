import dotenv from 'dotenv';
import path from 'path';

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
}

const isMainnet = process.env.NETWORK === 'mainnet';
const nodeEnv = process.env.NODE_ENV || 'development';

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
  adminApiKey: process.env.ADMIN_API_KEY || 'zc_admin_test_secret_key',
  readApiKey: process.env.READ_API_KEY || undefined,
  encryptionKey: process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_SECRET || 'zecshield_master_encryption_key_32_bytes!!',
  allowHttpWebhooks: process.env.ALLOW_HTTP_WEBHOOKS === 'true' || nodeEnv === 'development' || nodeEnv === 'test',
  allowLocalhostWebhooks: process.env.ALLOW_LOCALHOST_WEBHOOKS === 'true' || nodeEnv === 'test',
};
