import http from 'http';
import crypto from 'crypto';
import { createApp } from '../src/api/server.js';
import { dbService } from '../src/db/database.js';
import { config } from '../src/config.js';

async function verifyMilestone3() {
  console.log('=== Milestone 3 Live Webhook & HMAC Verification ===\n');

  config.allowHttpWebhooks = true;
  config.allowLocalhostWebhooks = true;

  const WEBHOOK_PORT = 3088;
  const API_PORT = 3089;
  const SECRET = 'zcash_hackathon_hmac_secret_2026';

  let webhookReceivedPromiseResolve: (data: any) => void;
  const webhookReceivedPromise = new Promise<any>((resolve) => {
    webhookReceivedPromiseResolve = resolve;
  });

  // 1. Start Local Webhook Receiver
  console.log(`[1/4] Starting local Webhook Receiver on port ${WEBHOOK_PORT}...`);
  const webhookServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/webhook') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const receivedSignature = req.headers['x-zecshield-signature'] as string;
        const eventType = req.headers['x-zecshield-event'] as string;

        // Recalculate HMAC-SHA256
        const expectedSignature = crypto
          .createHmac('sha256', SECRET)
          .update(body)
          .digest('hex');

        const isValid = receivedSignature === expectedSignature;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'delivered', signature_valid: isValid }));

        webhookReceivedPromiseResolve({
          body: JSON.parse(body),
          receivedSignature,
          expectedSignature,
          isValid,
          eventType
        });
      });
    } else {
      res.writeHead(404).end();
    }
  });

  await new Promise<void>((r) => webhookServer.listen(WEBHOOK_PORT, r));
  console.log('      Webhook receiver listening.\n');

  // 2. Start ZecShield API
  console.log(`[2/4] Starting ZecShield API server on port ${API_PORT}...`);
  await dbService.init();
  const app = createApp();
  const apiServer = http.createServer(app);
  await new Promise<void>((r) => apiServer.listen(API_PORT, r));
  console.log('      API server listening.\n');

  try {
    // 3. Register Webhook
    console.log('[3/4] Registering webhook via POST /api/v1/webhooks...');
    const regRes = await fetch(`http://localhost:${API_PORT}/api/v1/webhooks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.adminApiKey
      },
      body: JSON.stringify({
        target_url: `http://localhost:${WEBHOOK_PORT}/webhook`,
        secret: SECRET,
        description: 'Local Live Verifier'
      })
    });
    const regData: any = await regRes.json();
    if (!regRes.ok) {
      console.error('Registration failed HTTP', regRes.status, regData);
    }
    console.log('      Webhook registered with ID:', regData.webhook?.id);

    // 4. Trigger Note via Simulator
    console.log('\n[4/4] Triggering note detection to test live dispatch...');
    const simRes = await fetch(`http://localhost:${API_PORT}/api/v1/simulator/simulate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.adminApiKey
      },
      body: JSON.stringify({
        amount_zec: 3.14159,
        memo: 'Payment for Hackathon License #HMAC-VERIFIED',
        pool: 'Orchard'
      })
    });
    const simData = await simRes.json();
    console.log(`      Simulated note txid: ${simData.transaction.txid}`);

    // Wait for webhook delivery
    console.log('      Awaiting webhook dispatch and delivery...');
    const delivery = await Promise.race([
      webhookReceivedPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Webhook timeout after 5s')), 5000))
    ]);

    console.log('\n--- Webhook Delivered Successfully ---');
    console.log('Event Type Header:', delivery.eventType);
    console.log('Received Signature:', delivery.receivedSignature);
    console.log('Calculated Signature:', delivery.expectedSignature);
    console.log('HMAC Signature Valid?:', delivery.isValid ? 'YES! (Cryptographically Authenticated)' : 'NO');
    console.log('Note TxID received:', delivery.body.data.txid);
    console.log('Amount ZEC received:', delivery.body.data.amount_zec);
    console.log('Decrypted Memo received:', `"${delivery.body.data.memo}"`);

    // Verify delivery logged in DB
    const deliveriesRes = await fetch(`http://localhost:${API_PORT}/api/v1/webhooks/deliveries`, {
      headers: { 'X-API-Key': config.adminApiKey }
    });
    const deliveriesData = await deliveriesRes.json();
    const lastDelivery = deliveriesData.deliveries[0];
    console.log('\nDatabase Delivery Log:');
    console.log('  Status Code recorded:', lastDelivery.status_code);
    console.log('  Response body recorded:', lastDelivery.response_body);

    if (!delivery.isValid || lastDelivery.status_code !== 200) {
      throw new Error('HMAC verification or DB logging failed');
    }

    console.log('\n======================================================');
    console.log('  MILESTONE 3 LIVE WEBHOOK VERIFICATION: 100% SUCCESS  ');
    console.log('======================================================');
  } finally {
    webhookServer.close();
    apiServer.close();
  }
}

verifyMilestone3().catch((err) => {
  console.error('\nVerification failed:', err);
  process.exit(1);
});
