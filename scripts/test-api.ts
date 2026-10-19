import { createApp } from '../src/api/server.js';
import { dbService } from '../src/db/database.js';
import http from 'http';

async function runTests() {
  console.log('=== Starting ZecShield Milestone 2 Automated Verification ===\n');

  // 1. Initialize Database
  console.log('[1/7] Initializing SQLite database...');
  await dbService.init();
  console.log('      Database initialized.\n');

  // 2. Start Express app on test port
  const TEST_PORT = 3099;
  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(TEST_PORT, () => {
      console.log(`[2/7] Test server listening on http://localhost:${TEST_PORT}\n`);
      resolve();
    });
  });

  const BASE_URL = `http://localhost:${TEST_PORT}/api/v1`;

  try {
    // 3. Test GET /status
    console.log('[3/7] Testing GET /api/v1/status...');
    const statusRes = await fetch(`${BASE_URL}/status`);
    const statusData = await statusRes.json();
    console.log('      Status response:', JSON.stringify(statusData, null, 2));
    if (!statusRes.ok) throw new Error('Status endpoint failed');
    console.log('      Status endpoint passed!\n');

    // 4. Test POST /keys (Register a test viewing key)
    console.log('[4/7] Testing POST /api/v1/keys (Register viewing key)...');
    const testKeyString = 'uviewtest1samplekeyforautomatedtestverification9876543210abcdef';
    const keyRes = await fetch(`${BASE_URL}/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: testKeyString,
        label: 'Merchant Invoice Account',
        birth_height: 4500000,
        key_type: 'UFVK'
      })
    });
    const keyData = await keyRes.json();
    console.log('      Key registration response:', JSON.stringify(keyData, null, 2));
    if (!keyRes.ok) throw new Error('Key registration failed');
    console.log('      Key registration passed!\n');

    // 5. Test POST /webhooks (Register a webhook)
    console.log('[5/7] Testing POST /api/v1/webhooks (Register webhook)...');
    const webhookRes = await fetch(`${BASE_URL}/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_url: 'https://webhook.site/00000000-0000-0000-0000-000000000000',
        description: 'Store Payment Listener',
        secret: 'test_secret_for_hmac_verification_123'
      })
    });
    const webhookData = await webhookRes.json();
    console.log('      Webhook registration response:', JSON.stringify(webhookData, null, 2));
    if (!webhookRes.ok) throw new Error('Webhook registration failed');
    console.log('      Webhook registration passed!\n');

    // 6. Test POST /simulator/simulate (Simulate a shielded payment)
    console.log('[6/7] Testing POST /api/v1/simulator/simulate (Simulate shielded note)...');
    const simRes = await fetch(`${BASE_URL}/simulator/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount_zec: 1.25,
        memo: 'Order #49201 Paid - Express Shipping to NYC',
        pool: 'Orchard'
      })
    });
    const simData = await simRes.json();
    console.log('      Simulation response:', JSON.stringify(simData, null, 2));
    if (!simRes.ok) throw new Error('Simulation failed');
    console.log('      Simulation passed!\n');

    // 7. Test GET /transactions (Verify indexed note & memo)
    console.log('[7/7] Testing GET /api/v1/transactions...');
    const txRes = await fetch(`${BASE_URL}/transactions`);
    const txData = await txRes.json();
    console.log('      Indexed transactions response:', JSON.stringify(txData, null, 2));
    if (!txRes.ok || txData.count < 1) throw new Error('Transactions query failed or empty');
    
    const matched = txData.transactions.find((t: any) => t.txid === simData.transaction.txid);
    if (!matched) throw new Error('Simulated transaction was not found in indexed records');
    console.log(`      Found note txid: ${matched.txid}`);
    console.log(`      Decrypted memo: "${matched.memo_text}"`);
    console.log(`      Amount: ${matched.amount_zec} ZEC (${matched.pool} pool)`);
    console.log('      Transactions endpoint passed!\n');

    console.log('====================================================');
    console.log('  ALL MILESTONE 2 TESTS PASSED SUCCESSFULLY! (7/7)  ');
    console.log('====================================================');
  } finally {
    server.close();
  }
}

runTests().catch((err) => {
  console.error('\nVerification failed:', err);
  process.exit(1);
});
