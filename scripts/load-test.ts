import http from 'http';
import fs from 'fs';
import path from 'path';
import { createApp } from '../src/api/server.js';
import { dbService } from '../src/db/database.js';
import { config } from '../src/config.js';

interface LatencyStats {
  total: number;
  success: number;
  failed: number;
  durationMs: number;
  rps: number;
  min: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  startMemoryMb: { rss: number; heapUsed: number };
  endMemoryMb: { rss: number; heapUsed: number };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

async function runLoadTest(totalRequests: number = 200, concurrency: number = 20): Promise<LatencyStats> {
  const testDbPath = path.resolve(process.cwd(), 'data', 'test-load.db');
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }

  config.adminApiKey = 'load_test_admin_key_9999';
  config.readApiKey = 'load_test_read_key_1111';
  config.allowHttpWebhooks = true;
  config.allowLocalhostWebhooks = true;
  config.nodeEnv = 'test';

  (dbService as any).dbPath = testDbPath;
  await dbService.init();

  // Populate some seed data
  const key = await dbService.addViewingKey(
    'uviewtest1loadkey00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    'UFVK',
    'Load Seed Key',
    4200000
  );

  for (let i = 1; i <= 25; i++) {
    await dbService.addShieldedNote({
      key_id: key.id,
      txid: `loadtx_${i}_${'a'.repeat(50)}`,
      block_height: 4200000 + i,
      block_hash: `hash_${4200000 + i}`,
      block_time: Math.floor(Date.now() / 1000),
      pool: 'Orchard',
      amount_zat: i * 10_000_000,
      amount_zec: i * 0.1,
      transfer_type: 'incoming',
      memo_text: `Load test invoice #${i}`,
      is_simulated: 0,
      verification_status: 'confirmed'
    });
  }

  const app = createApp();
  let server: http.Server;
  let baseUrl: string;

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr: any = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  const memStart = process.memoryUsage();
  const startMemoryMb = {
    rss: Math.round(memStart.rss / 1024 / 1024),
    heapUsed: Math.round(memStart.heapUsed / 1024 / 1024)
  };

  const endpoints = [
    { path: '/health', headers: {} },
    { path: '/api/v1/status', headers: {} },
    { path: '/api/v1/transactions?limit=20', headers: { 'X-API-Key': config.readApiKey } },
    { path: '/api/v1/keys', headers: { 'X-API-Key': config.adminApiKey } }
  ];

  const latencies: number[] = [];
  let successCount = 0;
  let rateLimitedCount = 0;
  let failCount = 0;

  const startTime = Date.now();
  let completed = 0;

  async function worker() {
    while (completed < totalRequests) {
      const reqId = completed++;
      const ep = endpoints[reqId % endpoints.length];
      const reqStart = performance.now();

      try {
        const res = await fetch(`${baseUrl}${ep.path}`, {
          headers: ep.headers
        });
        const elapsed = performance.now() - reqStart;
        latencies.push(elapsed);

        if (res.status === 200 || res.status === 201) {
          successCount++;
        } else if (res.status === 429) {
          rateLimitedCount++;
        } else {
          failCount++;
          if (failCount === 1) {
            const txt = await res.text().catch(() => '');
            console.error(`[Load Test] First failed request to ${ep.path}: HTTP ${res.status} - ${txt}`);
          }
        }
      } catch (err: any) {
        failCount++;
        if (failCount === 1) {
          console.error(`[Load Test] First network exception to ${ep.path}: ${err.message}`);
        }
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  const durationMs = Date.now() - startTime;
  latencies.sort((a, b) => a - b);

  const memEnd = process.memoryUsage();
  const endMemoryMb = {
    rss: Math.round(memEnd.rss / 1024 / 1024),
    heapUsed: Math.round(memEnd.heapUsed / 1024 / 1024)
  };

  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (fs.existsSync(testDbPath)) {
    try {
      fs.unlinkSync(testDbPath);
    } catch {}
  }

  const stats: LatencyStats = {
    total: totalRequests,
    success: successCount,
    rateLimited: rateLimitedCount,
    failed: failCount,
    durationMs,
    rps: Math.round((totalRequests / (durationMs / 1000)) * 10) / 10,
    min: Math.round((latencies[0] || 0) * 100) / 100,
    p50: Math.round(percentile(latencies, 50) * 100) / 100,
    p90: Math.round(percentile(latencies, 90) * 100) / 100,
    p95: Math.round(percentile(latencies, 95) * 100) / 100,
    p99: Math.round(percentile(latencies, 99) * 100) / 100,
    max: Math.round((latencies[latencies.length - 1] || 0) * 100) / 100,
    startMemoryMb,
    endMemoryMb
  };

  return stats as any;
}

runLoadTest(300, 25).then((stats: any) => {
  console.log('\n======================================================');
  console.log('       ZecShield Gateway Controlled Load Test Results   ');
  console.log('======================================================');
  console.log(`Total Requests:         ${stats.total}`);
  console.log(`Concurrency Level:      25`);
  console.log(`Successful Requests:    ${stats.success}`);
  console.log(`Rate-Limited (429):     ${stats.rateLimited} (Expected by rate limiter)`);
  console.log(`Failed Requests:        ${stats.failed} (5xx / Connection errors)`);
  console.log(`Total Duration:         ${stats.durationMs} ms`);
  console.log(`Throughput (RPS):       ${stats.rps} req/sec`);
  console.log('------------------------------------------------------');
  console.log(`Latency (min):          ${stats.min} ms`);
  console.log(`Latency (p50):          ${stats.p50} ms`);
  console.log(`Latency (p90):          ${stats.p90} ms`);
  console.log(`Latency (p95):          ${stats.p95} ms`);
  console.log(`Latency (p99):          ${stats.p99} ms`);
  console.log(`Latency (max):          ${stats.max} ms`);
  console.log('------------------------------------------------------');
  console.log(`Memory RSS:             ${stats.startMemoryMb.rss} MB -> ${stats.endMemoryMb.rss} MB`);
  console.log(`Memory Heap Used:       ${stats.startMemoryMb.heapUsed} MB -> ${stats.endMemoryMb.heapUsed} MB`);
  console.log('======================================================\n');
  process.exit(stats.failed === 0 ? 0 : 1);
});
