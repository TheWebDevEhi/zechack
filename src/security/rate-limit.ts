import { Request, Response, NextFunction } from 'express';
import { extractApiKey } from './auth.js';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * In-memory sliding window rate limiter middleware.
 */
export function createRateLimiter(options: { windowMs?: number; max?: number; message?: string }) {
  const windowMs = options.windowMs || 60_000; // default: 1 minute
  const max = options.max || 100; // default: 100 requests per minute
  const message = options.message || 'Too Many Requests: Rate limit exceeded. Please slow down.';

  const clients = new Map<string, RateLimitEntry>();

  // Periodically clean up stale client entries
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of clients.entries()) {
      if (entry.resetAt < now) {
        clients.delete(key);
      }
    }
  }, Math.max(windowMs, 30_000));

  if (typeof cleanupInterval.unref === 'function') {
    cleanupInterval.unref();
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    const apiKey = extractApiKey(req);
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const clientIdentifier = apiKey ? `key:${apiKey}` : `ip:${clientIp}`;

    const now = Date.now();
    let entry = clients.get(clientIdentifier);

    if (!entry || entry.resetAt < now) {
      entry = {
        count: 1,
        resetAt: now + windowMs
      };
      clients.set(clientIdentifier, entry);
    } else {
      entry.count++;
    }

    const remaining = Math.max(0, max - entry.count);
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));

    res.setHeader('X-RateLimit-Limit', max.toString());
    res.setHeader('X-RateLimit-Remaining', remaining.toString());
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000).toString());

    if (entry.count > max) {
      res.setHeader('Retry-After', retryAfterSeconds.toString());
      res.status(429).json({
        error: message,
        retry_after: retryAfterSeconds,
        status: 429
      });
      return;
    }

    next();
  };
}
