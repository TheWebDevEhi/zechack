# 🛡️ ZecShield Gateway

> **Developer-First Shielded Indexer, Webhook Gateway & Trial-Decryption Engine for Zcash (ZEC)**

[![Zcash Network](https://img.shields.io/badge/Network-Testnet%20%7C%20Mainnet-f4b728?style=flat-square&logo=zcash)](https://z.cash)
[![License](https://img.shields.io/badge/License-MIT-10b981?style=flat-square)](LICENSE)
[![Zero-Knowledge](https://img.shields.io/badge/zk--SNARKs-Halo%202%20%7C%20Groth16-a855f7?style=flat-square)](https://zips.z.cash/protocol/protocol.pdf)

---

## 🌟 The Problem ZecShield Solves

On transparent blockchains (Bitcoin, Ethereum), transactions publicly disclose sender, recipient, and amount. Indexing requires simple database queries on plaintext addresses.

On Zcash (Sapling & Orchard), **transactions are zero-knowledge ciphertexts**. Transactions do not contain recipient addresses or amounts on-chain. Detecting a payment requires **trial decryption** against an Incoming Viewing Key (IVK). 

Currently, any developer or merchant wanting to accept shielded Zcash or build a private web application must:
1. Run a full node or maintain a heavy native Rust client.
2. Interface with raw gRPC streams via `lightwalletd`.
3. Manage cryptographic proving and scanning keys.

### The ZecShield Solution
ZecShield acts as the **"Alchemy / Moralis for Shielded Zcash"**:
* Developers register their **Unified Full Viewing Keys (UFVKs)** or **Incoming Viewing Keys (IVKs)**.
* ZecShield syncs compact blocks, trial-decrypts outputs in the background using native Rust cryptographic acceleration, and extracts payment details and **512-byte encrypted memos**.
* ZecShield fires **HMAC-signed Webhooks** to developer URLs (e.g., when an invoice is paid) and exposes clean **REST APIs & a Developer Dashboard UI**.

---

## 🔒 Security & Privacy Model

```
+---------------------------------------------------------------------------------------+
|                                    SECURITY BOUNDARY                                  |
|                                                                                       |
|  [ User Spending Key (SK) ]  ---> REMAINS 100% PRIVATE WITH THE USER (NEVER SHARED)   |
|                                                                                       |
|  [ Incoming Viewing Key (IVK) ] -> SHARED WITH ZECSHIELD                              |
|                                    - CAN detect incoming shielded payments            |
|                                    - CAN decrypt 512-byte memos                       |
|                                    - CANNOT see outgoing spends                       |
|                                    - CANNOT determine total balance                   |
|                                    - CANNOT STEAL OR SPEND FUNDS (100% Non-Custodial)|
+---------------------------------------------------------------------------------------+
```

---

## 🚀 Quickstart

### Prerequisites
* **Node.js** (v18+ or v22+)
* No C++ compilers or native Rust toolchains required (uses pre-compiled native NAPI-RS Rust engines)!

### 1. Installation
```bash
git clone https://github.com/TheWebDevEhi/zechack.git
cd zechack
npm install
npm run build
```

### 2. Start the Full Gateway & Dashboard
```bash
npm start
```
* **Developer Dashboard UI**: Open [http://localhost:3001](http://localhost:3001) in your browser.
* **REST API Server**: Listening at `http://localhost:3001/api/v1`
* **Background Chain Syncer**: Automatically starts scanning compact blocks from `testnet.zec.rocks:443`.

---

## 🧪 Automated Verification Suite

Run our comprehensive end-to-end verification tests:

```bash
# 1. Test live gRPC connection to Zcash nodes (streaming compact blocks)
npm run test:grpc

# 2. Test full REST API, SQLite persistence, and simulation
npm run test:api

# 3. Test live HTTP webhook dispatch and cryptographic HMAC-SHA256 signature verification
npm run test:webhook
```

---

## 📡 REST API Reference

### 1. Gateway Status
```http
GET /api/v1/status
```
**Response:**
```json
{
  "status": "ok",
  "network": "testnet",
  "lightwalletd_url": "https://testnet.zec.rocks:443",
  "chain_tip": 4521590,
  "stats": {
    "total_keys_monitored": 1,
    "total_notes_indexed": 3,
    "total_shielded_zat": 689159000,
    "total_shielded_zec": "6.89159000"
  }
}
```

### 2. Register Viewing Key
```http
POST /api/v1/keys
Content-Type: application/json

{
  "key": "uviewtest1qqqq...",
  "label": "Merchant Checkout Store",
  "birth_height": 4500000,
  "key_type": "UFVK"
}
```

### 3. Query Confirmed Shielded Notes & Memos
```http
GET /api/v1/transactions?limit=20
```
**Response:**
```json
{
  "count": 1,
  "transactions": [
    {
      "id": 1,
      "txid": "292173b907c03ab586479c07a5793a86a3ff5acf93e843827e062b238d3d10f5",
      "block_height": 4520000,
      "pool": "Orchard",
      "amount_zat": 125000000,
      "amount_zec": 1.25,
      "transfer_type": "incoming",
      "memo_text": "Order #49201 Paid - Express Shipping to NYC"
    }
  ]
}
```

### 4. Register Webhook
```http
POST /api/v1/webhooks
Content-Type: application/json

{
  "target_url": "https://api.yourstore.com/webhooks/zcash",
  "secret": "your_custom_hmac_secret",
  "description": "Store Order Dispatcher"
}
```

### 5. Instant Demo Simulator (For Live Pitches)
```http
POST /api/v1/simulator/simulate
Content-Type: application/json

{
  "amount_zec": 2.5,
  "memo": "Hackathon Grand Prize - Shielded Zcash Demo",
  "pool": "Orchard"
}
```

---

## 🔐 Webhook HMAC-SHA256 Verification

When a shielded note is detected, ZecShield sends an HTTP `POST` to your webhook with the `X-ZecShield-Signature` header:

```javascript
import crypto from 'crypto';
import express from 'express';

const app = express();

app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-zecshield-signature'];
  const expectedSignature = crypto
    .createHmac('sha256', process.env.WEBHOOK_SECRET)
    .update(req.body)
    .digest('hex');

  if (signature !== expectedSignature) {
    return res.status(401).send('Unauthorized: Invalid HMAC signature');
  }

  const payload = JSON.parse(req.body);
  console.log('Payment verified! Memo:', payload.data.memo);
  console.log('Amount ZEC:', payload.data.amount_zec);

  res.status(200).send('OK');
});

app.listen(8080);
```

---

## 🖥️ Developer Dashboard Features

1. **Live Network Telemetry**: Chain tip, active network pill, synced blocks, total indexed volume.
2. **Viewing Key Manager**: Register Unified Full Viewing Keys (UFVK), set birth heights, and track sync progress.
3. **Live Shielded Feed**: Real-time explorer of incoming shielded payments with decoded **512-byte memos** and copy tools.
4. **Webhook Configurator & Delivery Inspector**: Inspect delivery logs, HTTP status codes, and latency.
5. **Pitch Simulator**: 1-click test payment injector with sliders for ZEC amount and memo payloads.
6. **Code Generator**: Ready-to-use cURL, TypeScript, and Python snippets.

---

## 🌐 Switching to Mainnet

To switch from Testnet to Mainnet, simply change the `NETWORK` environment variable in `.env`:
```ini
NETWORK=mainnet
LIGHTWALLETD_URL=https://na.zec.rocks:443
```
ZecShield will automatically connect to Mainnet lightwalletd nodes, stream mainnet compact blocks, and decrypt mainnet Orchard/Sapling notes.

---

## 📜 License
MIT License. Built for the Zcash Ecosystem & Hackathon 2026.
