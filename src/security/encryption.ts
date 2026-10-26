import crypto from 'crypto';
import { config } from '../config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const SALT_LENGTH = 16; // 128-bit salt for HKDF
const PREFIX_V1 = 'enc:v1:';
const PREFIX_V2 = 'enc:v2:';

function getDerivedKeyV1(overrideKey?: string): Buffer {
  return crypto.createHash('sha256').update(overrideKey || config.encryptionKey).digest();
}

function getDerivedKeyV2(salt: Buffer, overrideKey?: string): Buffer {
  return Buffer.from(
    crypto.hkdfSync('sha256', overrideKey || config.encryptionKey, salt, 'zecshield-credentials-v2', 32)
  );
}

/**
 * Encrypts a sensitive string (e.g., raw viewing key, webhook secret) using AES-256-GCM with HKDF (enc:v2).
 */
export function encryptCredential(plaintext: string, overrideKey?: string): string {
  if (!plaintext) return plaintext;
  // If already encrypted with any supported format, return as is
  if (plaintext.startsWith(PREFIX_V2) || plaintext.startsWith(PREFIX_V1)) {
    return plaintext;
  }

  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getDerivedKeyV2(salt, overrideKey);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return `${PREFIX_V2}${salt.toString('hex')}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts an encrypted credential.
 * Supports both modern enc:v2: (HKDF) and legacy enc:v1: (SHA-256) formats.
 */
export function decryptCredential(ciphertext: string, overrideKey?: string): string {
  if (!ciphertext) return ciphertext;

  // Modern HKDF format (enc:v2:salt:iv:authTag:ciphertext)
  if (ciphertext.startsWith(PREFIX_V2)) {
    try {
      const parts = ciphertext.slice(PREFIX_V2.length).split(':');
      if (parts.length !== 4) {
        throw new Error('Malformed enc:v2 encrypted credential format');
      }

      const [saltHex, ivHex, authTagHex, encryptedDataHex] = parts;
      const salt = Buffer.from(saltHex, 'hex');
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      const key = getDerivedKeyV2(salt, overrideKey);

      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encryptedDataHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (err: any) {
      console.error('[Security] Failed to decrypt enc:v2 credential:', err.message);
      throw new Error('Cryptographic verification failed for stored credential');
    }
  }

  // Legacy SHA-256 format (enc:v1:iv:authTag:ciphertext)
  if (ciphertext.startsWith(PREFIX_V1)) {
    try {
      const parts = ciphertext.slice(PREFIX_V1.length).split(':');
      if (parts.length !== 3) {
        throw new Error('Malformed enc:v1 encrypted credential format');
      }

      const [ivHex, authTagHex, encryptedDataHex] = parts;
      const key = getDerivedKeyV1(overrideKey);
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');

      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encryptedDataHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (err: any) {
      console.error('[Security] Failed to decrypt enc:v1 credential:', err.message);
      throw new Error('Cryptographic verification failed for stored credential');
    }
  }

  return ciphertext;
}
