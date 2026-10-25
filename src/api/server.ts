import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { apiRouter } from './routes.js';

export function createApp(): express.Application {
  const app = express();

  app.use(cors());
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
