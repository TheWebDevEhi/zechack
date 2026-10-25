import { ViewingKeyRecord, WebhookRecord } from '../db/database.js';

export interface SanitizedViewingKeyRecord {
  id: number;
  key_preview: string;
  key_type: string;
  label: string;
  birth_height: number;
  last_scanned_height: number;
  is_active: number;
  created_at: number;
  sync_percent?: number;
  is_synced?: boolean;
}

export interface SanitizedWebhookRecord {
  id: number;
  target_url: string;
  description: string;
  is_active: number;
  created_at: number;
  secret_preview?: string;
}

/**
 * Masks a viewing key so only the prefix and the trailing 4 characters are visible.
 * Example: uview1qqqq...9901
 */
export function maskViewingKey(key: string): string {
  if (!key) return '';
  const clean = key.startsWith('enc:v1:') ? 'uview...[encrypted]' : key;
  if (clean.length <= 16) {
    return `${clean.slice(0, 4)}...${clean.slice(-4)}`;
  }
  const prefix = clean.slice(0, 10);
  const suffix = clean.slice(-4);
  return `${prefix}...${suffix}`;
}

/**
 * Masks a webhook secret.
 */
export function maskSecret(secret: string): string {
  if (!secret) return '';
  return 'whsec_••••••••••••';
}

/**
 * Sanitizes a ViewingKeyRecord to prevent leaking the full raw viewing key.
 */
export function sanitizeViewingKey(record: ViewingKeyRecord): SanitizedViewingKeyRecord {
  const { key_string, ...rest } = record;
  return {
    ...rest,
    key_preview: maskViewingKey(key_string)
  };
}

/**
 * Sanitizes a WebhookRecord to prevent leaking the signing secret in list or detail queries.
 */
export function sanitizeWebhook(record: WebhookRecord, includePreview: boolean = false): SanitizedWebhookRecord {
  const { secret, ...rest } = record;
  return {
    ...rest,
    ...(includePreview ? { secret_preview: maskSecret(secret) } : {})
  };
}
