import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';

export type UserRole = 'admin' | 'read';

export interface AuthContext {
  role: UserRole;
  authenticated: boolean;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/**
 * Compares two strings in constant time to prevent timing attacks.
 */
function timingSafeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Constant time dummy comparison
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Extracts the API key from request headers:
 * - X-API-Key: <key>
 * - Authorization: Bearer <key>
 */
export function extractApiKey(req: Request): string | null {
  const xApiKey = req.header('x-api-key');
  if (xApiKey && typeof xApiKey === 'string') {
    return xApiKey.trim();
  }

  const authHeader = req.header('authorization');
  if (authHeader && typeof authHeader === 'string') {
    const parts = authHeader.trim().split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
      return parts[1].trim();
    }
  }

  return null;
}

/**
 * Validates the API key and returns the associated role, or null if invalid.
 */
export function verifyApiKey(key: string): UserRole | null {
  if (!key) return null;

  // Check admin key
  if (timingSafeCompare(key, config.adminApiKey)) {
    return 'admin';
  }

  // Check read key if configured
  if (config.readApiKey && timingSafeCompare(key, config.readApiKey)) {
    return 'read';
  }

  return null;
}

/**
 * Middleware enforcing authentication and role-based authorization.
 *
 * @param requiredRole 'admin' for mutating/privileged operations, 'read' for read-only sensitive data
 */
export function requireAuth(requiredRole: UserRole = 'read') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const apiKey = extractApiKey(req);

    if (!apiKey) {
      res.status(401).json({
        error: 'Unauthorized: Missing API key. Provide via "X-API-Key" header or "Authorization: Bearer <key>".',
        status: 401
      });
      return;
    }

    const role = verifyApiKey(apiKey);
    if (!role) {
      res.status(401).json({
        error: 'Unauthorized: Invalid API key.',
        status: 401
      });
      return;
    }

    // Role check: admin has access to both admin and read
    if (requiredRole === 'admin' && role !== 'admin') {
      res.status(403).json({
        error: 'Forbidden: This operation requires administrative privileges.',
        status: 403
      });
      return;
    }

    req.auth = { role, authenticated: true };
    next();
  };
}

/**
 * Structured audit logger for privileged operations.
 */
export function auditLog(req: Request, action: string, details: Record<string, any> = {}): void {
  const logEntry = {
    timestamp: new Date().toISOString(),
    event: 'AUDIT_LOG',
    action,
    role: req.auth?.role || 'unauthenticated',
    ip: req.ip || req.socket.remoteAddress,
    method: req.method,
    path: req.originalUrl || req.path,
    details
  };
  console.log(`[AUDIT] ${JSON.stringify(logEntry)}`);
}
