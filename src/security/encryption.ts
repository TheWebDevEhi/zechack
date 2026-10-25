import crypto from 'crypto';
import { config } from '../config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const PREFIX = 'enc:v1:';

function getDerivedKey(): Buffer {
  return crypto.createHash('sha256').update(config.encryptionKey).digest();
}

/**
 * Encrypts a sensitive string (e.g., raw viewing key, webhook secret) using AES-256-GCM.
 */
export function encryptCredential(plaintext: string): string {
  if (!plaintext) return plaintext;
  // If already encrypted, return as is
  if (plaintext.startsWith(PREFIX)) {
    return plaintext;
  }

  const key = getDerivedKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts an encrypted credential. If the input is not encrypted, returns it unchanged.
 */
export function decryptCredential(ciphertext: string): string {
  if (!ciphertext || !ciphertext.startsWith(PREFIX)) {
    return ciphertext;
  }

  try {
    const parts = ciphertext.slice(PREFIX.length).split(':');
    if (parts.length !== 3) {
      throw new Error('Malformed encrypted credential format');
    }

    const [ivHex, authTagHex, encryptedDataHex] = parts;
    const key = getDerivedKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedDataHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (err: any) {
    console.error('[Security] Failed to decrypt credential:', err.message);
    throw new Error('Cryptographic verification failed for stored credential');
  }
}
