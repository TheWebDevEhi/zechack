# ZecShield Indexer & Webhook Gateway
### Developer Infrastructure for Shielded Zcash (ZEC)

---

## 1. Executive Summary & Vision

**ZecShield** is a developer-first indexing and event-notification gateway for the Zcash blockchain. It acts as the *"Alchemy / Moralis for Shielded Zcash"*.

### The Problem
On transparent blockchains (Bitcoin, Ethereum), transactions publicly disclose sender, recipient, and amount. Indexing requires simple database queries on plaintext addresses. On Zcash (Sapling & Orchard), **transactions are zero-knowledge ciphertexts**. Transactions do not contain recipient addresses or amounts on-chain. Detecting a payment requires **trial decryption** against an Incoming Viewing Key (IVK). 

Currently, any developer or merchant wanting to accept shielded Zcash or build a private web application must:
1. Run a full node or maintain a complex native Rust client.
2. Interface with raw gRPC streams via `lightwalletd`.
3. Manage cryptographic proving and scanning keys.

### The Solution
ZecShield abstracts away the cryptographic complexity:
* Developers register their **Incoming Viewing Keys (IVKs)** or **Unified Full Viewing Keys (UFVKs)**.
* ZecShield syncs compact blocks, trial-decrypts outputs in the background, and extracts payment details and 512-byte encrypted memos.
* ZecShield fires **HMAC-signed Webhooks** to developer URLs (e.g., when an invoice is paid) and exposes clean **REST & WebSocket APIs** to query balances, notes, and decrypted memos.

---

## 2. Core Concepts & Security Model

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

### Supported Shielded Pools
* **Orchard (NU5, Halo 2)**: Primary modern pool, no trusted setup, Unified Addresses (`u1...`).
* **Sapling**: Established pool, Groth16 zk-SNARKs (`zs1...`).

---

## 3. High-Level Architecture Diagram

```
                 +--------------------------+
                 |  Zcash Network (Testnet) |
                 +--------------------------+
                              |
                              v
                 +--------------------------+
                 | lightwalletd gRPC Server |
                 +--------------------------+
                              |
                     (CompactBlock Stream)
                              |
                              v
+-------------------------------------------------------------+
|                  ZECSHIELD CORE ENGINE                      |
|                                                             |
|  +------------------------+      +-----------------------+  |
|  |  Chain Ingestion Worker| ---> | Block Buffer / Queue  |  |
|  +------------------------+      +-----------------------+  |
|                                              |              |
|                                              v              |
|  +------------------------+      +-----------------------+  |
|  | Registered Keys Store  | ---> | Trial Decryption Pool |  |
|  +------------------------+      +-----------------------+  |
|                                              |              |
|                                         (Match Found)       |
|                                              |              |
|                                              v              |
|                                  +-----------------------+  |
|                                  | Note & Memo Extractor |  |
|                                  +-----------------------+  |
|                                              |              |
|                                              v              |
|  +-------------------------------------------------------+  |
|  |             SQLite / PostgreSQL Database              |  |
|  |  (Accounts, Keys, Notes, Memos, Webhooks, Deliveries) |  |
|  +-------------------------------------------------------+  |
|               |                                |            |
+---------------|--------------------------------|------------+
                |                                |
                v                                v
+-------------------------------+  +-------------------------------+
|     REST & WebSocket API      |  |   Webhook Dispatcher Worker   |
+-------------------------------+  +-------------------------------+
                |                                |
        (JSON Queries / Stream)         (HTTP POST with HMAC)
                |                                |
                v                                v
+-------------------------------+  +-------------------------------+
|  Developer Dashboard Web UI   |  |   Merchant / Client Backend   |
+-------------------------------+  +-------------------------------+
```

---

## 4. Technology Stack

| Layer | Recommended Choice | Rationale |
| :--- | :--- | :--- |
| **Scanning Engine** | **Rust** (`zcash_client_backend`, `orchard`, `sapling-crypto`, `tonic`, `tokio`) | Native performance for trial-decryption; official reference implementation for Zcash cryptography. |
| **API & Webhook Service** | **TypeScript / Node.js** (Fastify / Express) or **Rust** (Axum) | High-concurrency REST endpoints, SSE/WebSocket streaming, and resilient HTTP request dispatching. |
| **Database** | **SQLite** (or PostgreSQL) | Zero external dependencies for local setup; robust ACID support, fast indexing. |
| **Frontend Dashboard** | **React / Vite + Vanilla CSS** | Ultra-responsive, dark-mode developer experience; real-time event logs, webhook test trigger, documentation. |
| **Network Interface** | **`lightwalletd` gRPC** | `testnet.lightwalletd.com:9067` for rapid testing without running a 30GB+ node. |

---

## 5. Detailed Step-by-Step Implementation Roadmap

### Step 0: Environment & Workspace Scaffolding
- [ ] Initialize monorepo / project structure in `zechack/`:
  - `crates/scanner` (Rust scanner engine or integrated daemon).
  - `server/` (API & Webhook service).
  - `dashboard/` (React developer UI).
- [ ] Configure Zcash Testnet connectivity (`testnet.lightwalletd.com:9067`).
- [ ] Set up developer testnet wallet (e.g. Zashi / YWallet) and obtain testnet ZEC from the faucet.

---

### Step 1: Ingestion & Protobuf Client
- [ ] Compile `service.proto` and `compact_formats.proto` from the `lightwalletd` specification.
- [ ] Implement `ChainClient` to query:
  - `GetLatestBlock`: Fetch chain tip height.
  - `GetBlockRange`: Stream sequential `CompactBlock` batches.
  - `GetTransaction`: Fetch full transaction ciphertext for 512-byte memo decryption.
- [ ] Build reconnection and exponential backoff retry logic for gRPC streams.

---

### Step 2: Key Management & Trial Decryption Engine
- [ ] Define key representations:
  - Orchard Raw Incoming Viewing Key (`OrchardIvk`).
  - Sapling Incoming Viewing Key (`SaplingIvk`).
  - Unified Full Viewing Key (`UFVK`).
- [ ] Support **Birthday Heights**: Record the block height of key creation so the scanner skips past historical blocks.
- [ ] Implement Trial Decryption Pipeline:
  - For each `CompactBlock`, iterate through `CompactTx`.
  - For each output/action, attempt decryption using active IVKs.
  - Upon decryption success:
    - Extract recipient diversifier, value (zatoshis), and note position.
    - Fetch transaction memo field (512 bytes) and decode UTF-8 string/payload.

---

### Step 3: Database & State Persistence
- [ ] Create database schema with migrations:
  - `users`: ID, API key, created_at.
  - `viewing_keys`: ID, user_id, key_type, key_string, birth_height, last_scanned_height.
  - `shielded_notes`: ID, key_id, txid, block_height, value_zat, memo_text, timestamp.
  - `webhooks`: ID, user_id, target_url, secret_token, is_active.
  - `webhook_deliveries`: ID, webhook_id, note_id, payload, status_code, attempts, delivered_at.
- [ ] Handle chain reorganizations (reorg rollbacks) using block hashes and heights.

---

### Step 4: Developer REST & WebSocket API
- [ ] Implement core endpoints:
  - `POST /api/v1/keys`: Register a new viewing key with birthday height.
  - `GET /api/v1/keys`: List monitored viewing keys and sync progress.
  - `GET /api/v1/transactions`: Query indexed transactions with filter by key, date range, or txid.
  - `GET /api/v1/notes/:id/memo`: Retrieve full decrypted memo.
  - `POST /api/v1/webhooks`: Register endpoint URL and generate HMAC signing secret.
  - `GET /api/v1/status`: Health check, chain tip, synced height.
- [ ] Implement WebSocket / Server-Sent Events (SSE):
  - `WS /api/v1/events`: Real-time streaming of incoming notes as they confirm.

---

### Step 5: Webhook Dispatcher & Delivery Engine
- [ ] Worker that listens for newly detected notes in the database.
- [ ] Formats webhook payload:
  ```json
  {
    "event": "shielded_note.detected",
    "txid": "e4a5...",
    "block_height": 2814200,
    "amount_zat": 100000000,
    "amount_zec": "1.0",
    "memo": "order_invoice_4921",
    "timestamp": 1729338000
  }
  ```
- [ ] Cryptographic signing: Compute `HMAC-SHA256(payload, secret)` and attach to header `X-ZecShield-Signature`.
- [ ] Resilient retry policy: Exponential backoff with up to 5 retries on failure (5xx or timeout).

---

### Step 6: Developer Dashboard UI
- [ ] Build a sleek, modern UI:
  - **Overview**: System sync status, total monitored keys, recent events.
  - **Key Manager**: Form to input IVK/UFVK + birthday height, status indicators (Syncing / Up to date).
  - **Live Explorer**: Live feed of detected transactions, value badges, and decrypted memos.
  - **Webhook Configurator & Tester**: Set webhook URL, view recent deliveries, and trigger a test payload.
  - **Interactive API Documentation**: Quickstart code snippets (cURL, JavaScript, Python).

---

### Step 7: End-to-End Verification & Hackathon Demo Flow
- [ ] **Verification**:
  1. Register a testnet IVK via the Dashboard.
  2. Register a webhook pointing to a test listener (e.g., `webhook.site`).
  3. Send a testnet transaction with a custom memo (e.g., `"ZecHack-Payment-#101"`) from Zashi/YWallet.
  4. Observe scanner detecting the transaction within seconds of block inclusion.
  5. Confirm webhook receipt with valid HMAC signature on `webhook.site`.
  6. Confirm transaction and memo display in the Dashboard UI.

---

## 6. Project Milestones

| Milestone | Target Deliverable | Verification Criteria |
| :--- | :--- | :--- |
| **M1: Ingestion & Scan Core** | Working gRPC connection & trial decryption test script. | Can decrypt a sample note and print amount + memo to CLI. |
| **M2: Persistent Backend & API** | SQLite schema, background scanner, and REST API. | Can register an IVK via `POST /keys` and query notes via `GET /transactions`. |
| **M3: Webhook Delivery System** | Asynchronous webhook queue with HMAC signatures. | Successfully fires an HTTP POST to `webhook.site` upon note discovery. |
| **M4: Developer Dashboard UI** | Full-featured frontend web app. | Users can interact with the system entirely through the browser. |
| **M5: Polished Demo & Packaging** | One-command startup, sample test scripts, demo video. | Complete end-to-end payment demonstration ready for hackathon judges. |
| **M6: Multi-Pool & NU6.3 Ironwood** | Native support for ZIP 2005 / Version 6 transactions. | Natively scans and trial-decrypts Ironwood, Orchard, and Sapling transactions with full memo extraction and deduplicated webhook delivery. |

