/**
 * Comprehensive input validation utilities for API requests.
 */

export interface ValidationResult<T> {
  isValid: boolean;
  value?: T;
  error?: string;
}

/**
 * Validates a 64-character hexadecimal Zcash transaction hash.
 */
export function validateTxid(txid: unknown): ValidationResult<string> {
  if (!txid || typeof txid !== 'string') {
    return { isValid: false, error: 'Transaction ID is required and must be a string' };
  }
  const clean = txid.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    return {
      isValid: false,
      error: 'Invalid transaction hash format. Must be a 64-character lowercase hex string'
    };
  }
  return { isValid: true, value: clean };
}

/**
 * Validates a block height parameter.
 */
export function validateBlockHeight(height: unknown, maxTip?: number): ValidationResult<number> {
  if (height === undefined || height === null || height === '') {
    return { isValid: false, error: 'Block height is required' };
  }
  const parsed = Number(height);
  if (!Number.isInteger(parsed) || isNaN(parsed)) {
    return { isValid: false, error: 'Block height must be an integer' };
  }
  if (parsed < 0) {
    return { isValid: false, error: 'Block height cannot be negative' };
  }
  if (maxTip !== undefined && maxTip > 0 && parsed > maxTip + 100) {
    return {
      isValid: false,
      error: `Block height ${parsed} exceeds current chain tip (${maxTip}) by more than allowable margin`
    };
  }
  return { isValid: true, value: parsed };
}

/**
 * Validates a ZEC amount.
 */
export function validateAmountZec(amount: unknown): ValidationResult<number> {
  if (amount === undefined || amount === null || amount === '') {
    return { isValid: false, error: 'Amount in ZEC is required' };
  }
  const parsed = Number(amount);
  if (isNaN(parsed) || !isFinite(parsed)) {
    return { isValid: false, error: 'Amount must be a valid numeric value' };
  }
  if (parsed <= 0) {
    return { isValid: false, error: 'Amount must be greater than zero' };
  }
  // Max ZEC supply is 21 million
  if (parsed > 21_000_000) {
    return { isValid: false, error: 'Amount cannot exceed maximum ZEC supply (21,000,000 ZEC)' };
  }
  return { isValid: true, value: parsed };
}

/**
 * Validates a Zcash pool identifier.
 */
export function validatePool(pool: unknown): ValidationResult<'Orchard' | 'Sapling' | 'Ironwood'> {
  if (!pool || typeof pool !== 'string') {
    return { isValid: true, value: 'Orchard' }; // default
  }
  const normalized = pool.trim();
  if (normalized === 'Orchard' || normalized === 'Sapling' || normalized === 'Ironwood') {
    return { isValid: true, value: normalized };
  }
  return {
    isValid: false,
    error: `Invalid pool "${pool}". Allowed pools are: "Orchard", "Sapling", "Ironwood"`
  };
}

/**
 * Validates and clamps pagination limit and offset parameters.
 */
export function validatePagination(
  limit: unknown,
  defaultLimit: number = 50,
  maxLimit: number = 100
): ValidationResult<number> {
  if (limit === undefined || limit === null || limit === '') {
    return { isValid: true, value: defaultLimit };
  }
  const parsed = Number(limit);
  if (!Number.isInteger(parsed) || isNaN(parsed) || parsed <= 0) {
    return { isValid: false, error: 'Pagination limit must be a positive integer' };
  }
  const clamped = Math.min(parsed, maxLimit);
  return { isValid: true, value: clamped };
}

/**
 * Validates viewing key strings (UFVK / ViewingKey) and bounds.
 */
export function validateViewingKeyInput(
  key: unknown,
  keyType?: unknown
): ValidationResult<{ cleanKey: string; determinedType: string }> {
  if (!key || typeof key !== 'string') {
    return { isValid: false, error: 'Viewing key string is required' };
  }
  const clean = key.trim();
  if (clean.length < 16) {
    return { isValid: false, error: 'Viewing key string is too short' };
  }
  if (clean.length > 2048) {
    return { isValid: false, error: 'Viewing key string exceeds maximum allowable length (2048 chars)' };
  }

  const determinedType =
    typeof keyType === 'string' && keyType.trim()
      ? keyType.trim()
      : clean.startsWith('uview')
        ? 'UFVK'
        : 'ViewingKey';

  return {
    isValid: true,
    value: { cleanKey: clean, determinedType }
  };
}
