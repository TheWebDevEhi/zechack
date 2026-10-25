import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { apiRouter } from './routes.js';
import { config } from '../config.js';

export function createApp(): express.Application {
  const app = express();

  // Configure reverse proxy trust if specified (SEC-08)
  if (config.trustProxy) {
    app.set('trust proxy', config.trustProxy);
  }

  // Defensive HTTP Security Headers (SEC-04)
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (config.nodeEnv === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  // Strict CORS policy (SEC-04)
  const allowedOrigins = config.corsOrigin
    ? config.corsOrigin.split(',').map((o) => o.trim())
    : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://127.0.0.1:3001', 'http://127.0.0.1:5173'];

  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);
      if (config.nodeEnv !== 'production' || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS origin "${origin}" not allowed by policy`), false);
    },
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization', 'X-Pairing-Token']
  }));
  app.use(express.json({ limit: '100kb' }));

  // Handle JSON parse error safely
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err && (err.type === 'entity.too.large' || err.status === 413)) {
      return res.status(413).json({ error: 'Payload Too Large: Maximum request body size is 100KB' });
    }
    if (err instanceof SyntaxError && 'body' in err) {
      return res.status(400).json({ error: 'Bad Request: Malformed JSON payload' });
    }
    next(err);
  });

  // Mount API routes (support both /api/v1 and /api)
  app.use('/api/v1', apiRouter);
  app.use('/api', apiRouter);

  // Serve static dashboard if built
  const dashboardDist = path.resolve(process.cwd(), 'dashboard', 'dist');
  if (fs.existsSync(dashboardDist)) {
    app.use(express.static(dashboardDist));
    app.use((req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(dashboardDist, 'index.html'));
    });
  } else {
    // Fallback welcome route
    app.get('/', (req, res) => {
      res.json({
        name: 'ZecShield Gateway API',
        version: '0.1.0',
        description: 'Developer-first Shielded Indexer & Webhook Gateway for Zcash',
        endpoints: {
          status: '/api/v1/status',
          keys: '/api/v1/keys',
          transactions: '/api/v1/transactions',
          webhooks: '/api/v1/webhooks',
          simulator: '/api/v1/simulator/simulate'
        }
      });
    });
  }

  return app;
}
