import express from 'express';
import cors from 'cors';
import { apiRouter } from './routes.js';

export function createApp(): express.Application {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Mount API routes
  app.use('/api/v1', apiRouter);

  // Root welcome route
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

  return app;
}
