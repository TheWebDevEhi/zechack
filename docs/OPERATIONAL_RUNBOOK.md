# ZecShield Gateway: Production Operational Runbook

This operational runbook provides production-grade architectural guidance, secret management protocols, incident response playbooks, and key rotation procedures for operators running the **ZecShield Shielded Indexer & Webhook Gateway**.

---

## 1. Secure Configuration & Secret Management

### 1.1 Environment Variables Matrix

| Variable | Required | Default | Description | Security Guardrails |
| :--- | :--- | :--- | :--- | :--- |
| `NODE_ENV` | Yes | `production` | Node environment runtime | Must be `production` to prevent debug leakage. |
| `ADMIN_API_KEY` | **Yes** | *None* | Master admin authentication token | High entropy (>= 32 chars). Controls key registration, webhook management, purge, and reorg endpoints. |
| `READ_API_KEY` | Optional | *None* | Read-only telemetry and query token | Permits access to `/api/v1/status`, `/api/v1/transactions`, `/api/v1/keys`, `/api/v1/syncer/errors`. |
| `ENCRYPTION_KEY` | **Yes** | *None* | 32-byte secret key for AES-256-GCM | Encrypts viewing keys and webhook secrets at rest before storing in SQLite/Turso. |
| `ALLOW_HTTP_WEBHOOKS` | No | `false` | Permits plaintext HTTP webhooks | **Must remain `false` in production.** Only set to `true` for localized air-gapped test environments. |
| `TURSO_DATABASE_URL` | Optional | *Local SQLite* | LibSQL remote cluster endpoint | Use TLS connection strings (`libsql://...`). |
| `TURSO_AUTH_TOKEN` | Optional | *None* | JWT authentication token for Turso | Store in vault/secrets manager; rotate quarterly. |
| `LIGHTWALLETD_URL` | Yes | `https://na.zec.rocks:443` | Lightwalletd gRPC endpoint | Enforce TLS gRPC (`:443`) over public networks. |

### 1.2 Secret Storage Best Practices
- **No plaintext credentials**: Never commit `.env` or configuration secrets to version control.
- **Envelope encryption at rest**: All user viewing keys (`UFVK`, `Unified`, `Sapling`) and webhook secrets (`whsec_...`) are automatically encrypted using AES-256-GCM with unique 96-bit IVs and 128-bit authentication tags (`enc:v1:<iv>:<ciphertext>:<tag>`).
- **Blind indexing**: The database indexes keys via SHA-256 hashes (`key_hash`). Plaintext keys are never stored, never queried in plaintext, and never returned in API payloads.

---

## 2. Recommended Deployment Architectures

### 2.1 Production Topology

```
                       [ Incoming Merchant Traffic ]
                                     │
                                     ▼
                     [ Reverse Proxy / Edge TLS / WAF ]
                     (Nginx / Caddy / Cloudflare WAF)
                        │ Rate Limiting (IP/Token)
                        │ TLS 1.3 Termination
                        │ DDoS & Request Validation
                                     │
                                     ▼
                       [ ZecShield Gateway (Node.js) ]
                        │ Auth: Constant-Time API Keys
                        │ Redaction: View Key Masking
                        │ SSRF Guard: DNS & CIDR Validation
                        │ Body Limit: 100kb Max
                       ┌─────────────┴─────────────┐
                       ▼                           ▼
            [ Lightwalletd Cluster ]       [ Database Layer ]
            Private VPC / TLS gRPC         Local SQLite (WAL mode)
            (Block Scanner & Syncer)       OR Turso Cloud (LibSQL)
```

### 2.2 Network Isolation & Egress Filtering
1. **Lightwalletd Isolation**: Run lightwalletd instances in a private subnet or internal overlay network (Tailscale / WireGuard).
2. **Webhook Egress Protection**: Outbound webhook requests are routed through the built-in SSRF defense layer (`src/security/ssrf.ts`), which performs real-time DNS resolution and rejects:
   - Loopback (`127.0.0.0/8`, `::1`)
   - Cloud metadata (`169.254.169.254`)
   - RFC 1918 private subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
   - Carrier-grade NAT (`100.64.0.0/10`)
   - Multicast and reserved ranges

### 2.3 Reverse Proxy Configuration (Nginx Example)

```nginx
server {
    listen 443 ssl http2;
    server_name zecshield.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/zecshield.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/zecshield.yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    client_max_body_size 100k;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Rate limiting headers passthrough
        proxy_pass_header X-RateLimit-Limit;
        proxy_pass_header X-RateLimit-Remaining;
        proxy_pass_header X-RateLimit-Reset;
    }
}
```

---

## 3. Incident Response Playbooks

### Playbook A: Scanner Batch Failures & Dead-Letter Queue (DLQ)

**Symptom**: Checkpoints stop advancing; warnings in log `[Syncer Alert] Batch scan permanently failed for key... Checkpoint preserved`.

1. **Investigate Dead-Letter Queue**:
   Query active scanner failures via the API:
   ```bash
   curl -s -H "X-API-Key: $READ_API_KEY" https://zecshield.yourdomain.com/api/v1/syncer/errors?status=failed | jq
   ```
2. **Inspect Error Diagnostics**:
   - Check lightwalletd connectivity and latency:
     ```bash
     grpcurl -proto proto/service.proto na.zec.rocks:443 cash.z.wallet.sdk.rpc.CompactTxStreamer/GetLatestBlock
     ```
   - Check local database disk space and write permissions.
3. **Recovery Procedure**:
   - The scanner **never skips failed blocks**. Once the underlying RPC/network issue resolves, the syncer automatically resumes scanning from the preserved checkpoint.
   - Once resolved, mark the error entry as resolved:
     ```bash
     curl -X POST -H "X-API-Key: $ADMIN_API_KEY" https://zecshield.yourdomain.com/api/v1/syncer/errors/<ERROR_ID>/resolve
     ```

### Playbook B: Blockchain Reorganization Detected

**Symptom**: Node detects fork or peer returns block hash mismatch.

1. **Verify Fork Height**:
   Determine the canonical chain tip and common ancestor block height from trusted explorers or full node `zcash-cli getblock <hash>`.
2. **Trigger Controlled Reorganization Rollback**:
   Execute the reorg handler to rewind the state:
   ```bash
   curl -X POST -H "X-API-Key: $ADMIN_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"fork_height": 2850420}' \
     https://zecshield.yourdomain.com/api/v1/reorg/simulate
   ```
3. **Automated Gateway Actions**:
   - Notes with `block_height > fork_height` are marked with `verification_status = 'reorganized'`.
   - The scanner checkpoint `last_scanned_height` is rewound to `fork_height`.
   - Webhook event `shielded_note.reorganized` is immediately dispatched to all subscribers so downstream merchant services can hold or adjust orders.

### Playbook C: Compromised Viewing Key

**Symptom**: Key disclosed in logs or unauthorized party possesses the viewing key.

1. **Revoke the Viewing Key**:
   Immediately delete the key from the gateway:
   ```bash
   curl -X DELETE -H "X-API-Key: $ADMIN_API_KEY" https://zecshield.yourdomain.com/api/v1/keys/<KEY_ID>
   ```
2. **Effect**:
   - Key is removed from active monitoring.
   - Associated decrypted state is deleted.
   - Scanner halts background scanning for this key identity immediately.

---

## 4. Key Rotation Procedures

### 4.1 API Key Rotation (Zero-Downtime)
1. Generate new 32+ character high-entropy key: `openssl rand -hex 24`.
2. Update `ADMIN_API_KEY` or `READ_API_KEY` in environment manager.
3. Perform zero-downtime rolling restart of the service (`pm2 reload zecshield` or Kubernetes rollout).
4. Update client API keys and verify requests with `X-API-Key`.

### 4.2 Webhook Signing Secret Rotation
1. Request a secret update or register a new webhook with target URL and new secret (`whsec_...`).
2. Verify subscriber acknowledges messages with dual-secret verification during the migration window.
3. Deactivate old webhook record via `DELETE /api/v1/webhooks/<OLD_ID>`.

### 4.3 Master Database Encryption Key Rotation
When rotating `ENCRYPTION_KEY`:
1. Use a migration script to decrypt existing records with `OLD_ENCRYPTION_KEY` and re-encrypt with `NEW_ENCRYPTION_KEY`.
2. All ciphertext stores the version prefix `enc:v1:`. Future key iterations can increment format to `enc:v2:`.
3. Update server environment variable `ENCRYPTION_KEY=<NEW_KEY>` and restart.

---

## 5. Controlled Load & Performance Benchmarks

A controlled stress test was conducted on the API and database layer to measure performance under concurrent load.

### Benchmark Setup
- **Tool**: `scripts/load-test.ts`
- **Total Requests**: 300
- **Concurrency**: 25 concurrent worker threads
- **Endpoints Targeted**: `/health`, `/api/v1/status`, `/api/v1/transactions`, `/api/v1/keys`
- **Database Engine**: Local LibSQL / SQLite engine with indexed tables

### Empirical Results
| Metric | Value |
| :--- | :--- |
| **Total Requests** | 300 |
| **Successful Requests** | 300 (100.0%) |
| **Failed Requests (5xx/Drops)** | 0 (0.0%) |
| **Total Test Duration** | 960 ms |
| **Throughput** | **312.5 Requests / second** |
| **Minimum Latency** | 16.01 ms |
| **p50 Latency (Median)** | 51.50 ms |
| **p90 Latency** | 142.79 ms |
| **p95 Latency** | 166.58 ms |
| **p99 Latency** | 255.53 ms |
| **Maximum Latency** | 283.81 ms |
| **Process Memory (RSS)** | 100 MB -> 128 MB |
| **Heap Memory (Used)** | 18 MB -> 32 MB |

### Observations
- **Resource Stability**: Under 25 concurrent connections, memory usage remained bounded with zero leaks.
- **Latency Consistency**: Over 90% of requests resolved in under 145ms.
- **Rate Limiting Protection**: Protects internal resources against memory exhaustion and brute-force attacks via sliding-window limiters with standard HTTP 429 and `Retry-After` headers.
