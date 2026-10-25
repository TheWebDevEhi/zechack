import { createApp } from './api/server.js';
import { dbService } from './db/database.js';
import { chainSyncer } from './engine/syncer.js';
import { config } from './config.js';

async function bootstrap() {
  console.log('==================================================');
  console.log('       ZecShield Indexer & Webhook Gateway        ');
  console.log('==================================================');

  // 1. Initialize SQLite Database
  console.log(`[Init] Initializing database at ${config.dbPath}...`);
  await dbService.init();
  console.log('[Init] Database initialized successfully.');

  // 2. Start Express API Server
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`[API] Server listening on http://localhost:${config.port}`);
    console.log(`[API] Network: ${config.network.toUpperCase()} (${config.lightwalletdUrl})`);
  });

  // 3. Start Background Chain Syncer
  await chainSyncer.start();

  // Graceful shutdown with forced termination safeguard
  let isShuttingDown = false;
  const shutdown = () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log('\n[Shutdown] Stopping services...');
    chainSyncer.stop();

    const forceTimer = setTimeout(() => {
      console.warn('[Shutdown] Forced shutdown after timeout.');
      process.exit(1);
    }, 5000);
    if (typeof forceTimer.unref === 'function') forceTimer.unref();

    if (typeof (server as any).closeAllConnections === 'function') {
      (server as any).closeAllConnections();
    }

    server.close(() => {
      clearTimeout(forceTimer);
      console.log('[Shutdown] Server closed cleanly. Exiting.');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('[Fatal] Error starting ZecShield gateway:', err);
  process.exit(1);
});
