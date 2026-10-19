import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export interface AppConfig {
  port: number;
  network: 'testnet' | 'mainnet';
  lightwalletdUrl: string;
  dbPath: string;
  syncIntervalMs: number;
  batchSize: number;
}

const isMainnet = process.env.NETWORK === 'mainnet';

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '3001', 10),
  network: isMainnet ? 'mainnet' : 'testnet',
  lightwalletdUrl: process.env.LIGHTWALLETD_URL || (isMainnet ? 'https://na.zec.rocks:443' : 'https://testnet.zec.rocks:443'),
  dbPath: process.env.DB_PATH || path.resolve(process.cwd(), 'data', 'zecshield.db'),
  syncIntervalMs: parseInt(process.env.SYNC_INTERVAL_MS || '15000', 10), // check for new blocks every 15s
  batchSize: parseInt(process.env.BATCH_SIZE || '100', 10),
};
