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
}

const isMainnet = process.env.NETWORK === 'mainnet';

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '3001', 10),
  network: isMainnet ? 'mainnet' : 'testnet',
  lightwalletdUrl: process.env.LIGHTWALLETD_URL || (isMainnet ? 'https://na.zec.rocks:443' : 'https://testnet.zec.rocks:443'),
  dbPath: process.env.DB_PATH || path.resolve(process.cwd(), 'data', 'zecshield.db'),
  tursoDatabaseUrl: process.env.TURSO_DATABASE_URL?.trim() || undefined,
  tursoAuthToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined,
  syncIntervalMs: parseInt(process.env.SYNC_INTERVAL_MS || '10000', 10), // check for new blocks every 10s
  batchSize: parseInt(process.env.BATCH_SIZE || '500', 10),
};
