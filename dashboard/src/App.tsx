import React, { useState, useEffect } from 'react';
import {
  Shield,
  Activity,
  Key,
  Webhook,
  Play,
  FileCode,
  RefreshCw,
  Copy,
  Check,
  Zap,
  Lock,
  Server,
  Layers,
  Radio,
  Clock,
  Code,
  RotateCcw,
  Trash2
} from 'lucide-react';

interface NetworkStatus {
  status: string;
  network: string;
  lightwalletd_url: string;
  chain_tip: number;
  stats: {
    total_keys_monitored: number;
    total_notes_indexed: number;
    total_shielded_zat: number;
    total_shielded_zec: string;
  };
  timestamp: number;
}

interface ViewingKey {
  id: number;
  key_string: string;
  key_type: string;
  label: string;
  birth_height: number;
  last_scanned_height: number;
  is_active: number;
  created_at: number;
  sync_percent: number;
  is_synced: boolean;
}

interface ShieldedTransaction {
  id: number;
  key_id: number;
  txid: string;
  block_height: number;
  block_time: number;
  pool: 'Orchard' | 'Sapling' | 'Ironwood';
  amount_zat: number;
  amount_zec: number;
  transfer_type: string;
  memo_text: string;
  is_simulated: number;
  created_at: number;
}

interface WebhookRecord {
  id: number;
  target_url: string;
  secret: string;
  description: string;
  is_active: number;
  created_at: number;
}

interface WebhookDelivery {
  id: number;
  webhook_id: number;
  note_id: number;
  payload: string;
  status_code: number;
  response_body: string;
  delivered_at: number;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'overview' | 'keys' | 'webhooks' | 'simulator' | 'docs'>('overview');
  const [status, setStatus] = useState<NetworkStatus | null>(null);
  const [keys, setKeys] = useState<ViewingKey[]>([]);
  const [transactions, setTransactions] = useState<ShieldedTransaction[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookRecord[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Forms state
  const [newKey, setNewKey] = useState({ key: '', label: '', birth_height: '4500000', key_type: 'UFVK' });
  const [newWebhook, setNewWebhook] = useState({ target_url: '', description: '', secret: '' });
  const [simParams, setSimParams] = useState<{ amount_zec: string; memo: string; pool: 'Orchard' | 'Sapling' | 'Ironwood' }>({ amount_zec: '1.25', memo: 'Invoice #ZEC-9012 - Paid with Shielded Zcash', pool: 'Ironwood' });
  const [actionMessage, setActionMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setActionMessage({ text, type });
    setTimeout(() => setActionMessage(null), 4000);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    showToast(`Copied ${label} to clipboard!`);
  };

  const fetchData = async () => {
    try {
      const [statusRes, keysRes, txRes, webhooksRes, deliveriesRes] = await Promise.all([
        fetch('/api/v1/status').then((r) => r.json()),
        fetch('/api/v1/keys').then((r) => r.json()),
        fetch('/api/v1/transactions').then((r) => r.json()),
        fetch('/api/v1/webhooks').then((r) => r.json()),
        fetch('/api/v1/webhooks/deliveries').then((r) => r.json()),
      ]);

      if (statusRes.status === 'ok') setStatus(statusRes);
      if (keysRes.keys) setKeys(keysRes.keys);
      if (txRes.transactions) setTransactions(txRes.transactions);
      if (webhooksRes.webhooks) setWebhooks(webhooksRes.webhooks);
      if (deliveriesRes.deliveries) setDeliveries(deliveriesRes.deliveries);
    } catch (err: any) {
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 6000);
    return () => clearInterval(interval);
  }, []);

  const handleRegisterKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKey.key.trim()) return;
    try {
      const res = await fetch('/api/v1/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newKey),
      });
      const data = await res.json();
      if (res.ok) {
        showToast('Viewing Key registered successfully!');
        setNewKey({ key: '', label: '', birth_height: '4500000', key_type: 'UFVK' });
        fetchData();
      } else {
        showToast(data.error || 'Failed to register key', 'error');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleRegisterWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWebhook.target_url.trim()) return;
    try {
      const res = await fetch('/api/v1/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newWebhook),
      });
      const data = await res.json();
      if (res.ok) {
        showToast('Webhook registered successfully!');
        setNewWebhook({ target_url: '', description: '', secret: '' });
        fetchData();
      } else {
        showToast(data.error || 'Failed to register webhook', 'error');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleSimulatePayment = async () => {
    try {
      const res = await fetch('/api/v1/simulator/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(simParams),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`Simulated ${simParams.amount_zec} ZEC payment & dispatched webhook!`);
        fetchData();
      } else {
        showToast(data.error || 'Simulation failed', 'error');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleResetData = async (keepKeys: boolean = false) => {
    const confirmed = window.confirm(
      keepKeys
        ? 'Clear all transaction history and webhook delivery logs?'
        : 'Wipe all database records (transactions, webhooks, and keys) to start completely clean?'
    );
    if (!confirmed) return;

    try {
      const res = await fetch('/api/v1/system/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keep_keys: keepKeys }),
      });
      const data = await res.json();
      showToast(data.message || 'Database reset successfully!');
      fetchData();
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleDeleteKey = async (id: number, label: string) => {
    const confirmed = window.confirm(`Remove viewing key "${label}" (#${id}) and its indexed notes?`);
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/v1/keys/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        showToast('Viewing key removed successfully!');
        fetchData();
      } else {
        showToast(data.error || 'Failed to remove key', 'error');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleDeleteWebhook = async (id: number, url: string) => {
    const confirmed = window.confirm(`Remove webhook endpoint "${url}" (#${id})?`);
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/v1/webhooks/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        showToast('Webhook removed successfully!');
        fetchData();
      } else {
        showToast(data.error || 'Failed to remove webhook', 'error');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  return (
    <div className="app-container">
      {/* Toast Notification */}
      {actionMessage && (
        <div
          style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            padding: '0.85rem 1.4rem',
            background: actionMessage.type === 'success' ? '#10b981' : '#ef4444',
            color: '#fff',
            borderRadius: '8px',
            fontWeight: 600,
            boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            animation: 'fadeIn 0.2s ease',
          }}
        >
          {actionMessage.type === 'success' ? <Check size={18} /> : <Activity size={18} />}
          {actionMessage.text}
        </div>
      )}

      {/* Header */}
      <header className="header">
        <div className="brand">
          <div className="brand-icon">
            <Shield size={26} strokeWidth={2.5} />
          </div>
          <div>
            <div className="brand-title">ZECSHIELD GATEWAY</div>
            <div className="brand-subtitle">Shielded Zcash Indexer & Webhook Engine</div>
          </div>
        </div>

        <div className="header-status">
          <div className="status-badge">
            <div className="live-indicator"></div>
            <span>{status?.network.toUpperCase() || 'TESTNET'}</span>
          </div>

          <div className="tip-badge">
            <Server size={14} />
            <span>Block #{status?.chain_tip || '4518562'}</span>
          </div>

          <button
            id="refresh-btn"
            className="btn btn-secondary btn-sm"
            onClick={fetchData}
            title="Refresh chain state"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Sync</span>
          </button>

          <button
            id="reset-db-btn"
            className="btn btn-secondary btn-sm"
            onClick={() => handleResetData(false)}
            title="Wipe database and reset to clean state"
            style={{ color: '#f87171', borderColor: 'rgba(239, 68, 68, 0.3)' }}
          >
            <RotateCcw size={14} />
            <span>Reset Data</span>
          </button>

          <button
            id="quick-simulate-btn"
            className="btn btn-primary btn-sm"
            onClick={handleSimulatePayment}
          >
            <Zap size={14} />
            <span>Simulate Note</span>
          </button>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="tabs-nav">
        <button
          id="tab-overview"
          className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          <Activity size={17} />
          <span>Overview & Live Feed</span>
        </button>

        <button
          id="tab-keys"
          className={`tab-btn ${activeTab === 'keys' ? 'active' : ''}`}
          onClick={() => setActiveTab('keys')}
        >
          <Key size={17} />
          <span>Viewing Keys ({keys.length})</span>
        </button>

        <button
          id="tab-webhooks"
          className={`tab-btn ${activeTab === 'webhooks' ? 'active' : ''}`}
          onClick={() => setActiveTab('webhooks')}
        >
          <Webhook size={17} />
          <span>Webhooks & Deliveries ({webhooks.length})</span>
        </button>

        <button
          id="tab-simulator"
          className={`tab-btn ${activeTab === 'simulator' ? 'active' : ''}`}
          onClick={() => setActiveTab('simulator')}
        >
          <Play size={17} />
          <span>Pitch Simulator</span>
        </button>

        <button
          id="tab-docs"
          className={`tab-btn ${activeTab === 'docs' ? 'active' : ''}`}
          onClick={() => setActiveTab('docs')}
        >
          <FileCode size={17} />
          <span>API Docs & Snippets</span>
        </button>
      </nav>

      {/* Metric Cards */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-header">
            <span>MONITORED KEYS</span>
            <div className="metric-icon-box" style={{ color: 'var(--zec-gold)' }}>
              <Key size={18} />
            </div>
          </div>
          <div className="metric-value">{status?.stats.total_keys_monitored || keys.length}</div>
          <div className="metric-sub">Active UFVKs running trial-decryption</div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <span>SHIELDED NOTES DETECTED</span>
            <div className="metric-icon-box" style={{ color: 'var(--zec-green)' }}>
              <Shield size={18} />
            </div>
          </div>
          <div className="metric-value">{status?.stats.total_notes_indexed || transactions.length}</div>
          <div className="metric-sub">Decrypted payments confirmed on-chain</div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <span>TOTAL SHIELDED VOLUME</span>
            <div className="metric-icon-box" style={{ color: 'var(--orchard-purple)' }}>
              <Layers size={18} />
            </div>
          </div>
          <div className="metric-value" style={{ color: 'var(--zec-gold)' }}>
            {status?.stats.total_shielded_zec || '0.0000'} <span style={{ fontSize: '1rem', color: '#fff' }}>ZEC</span>
          </div>
          <div className="metric-sub">Confidential shielded value indexed</div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <span>ACTIVE WEBHOOKS</span>
            <div className="metric-icon-box" style={{ color: 'var(--cyan-accent)' }}>
              <Radio size={18} />
            </div>
          </div>
          <div className="metric-value">{webhooks.length}</div>
          <div className="metric-sub">{deliveries.length} total event deliveries dispatched</div>
        </div>
      </div>

      {/* TAB 1: OVERVIEW & LIVE FEED */}
      {activeTab === 'overview' && (
        <div className="animate-fade-in">
          <div className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">
                  <Shield size={20} color="var(--zec-green)" />
                  <span>Real-Time Shielded Note Stream</span>
                </div>
                <div className="panel-desc">
                  Incoming Zcash transactions decrypted in the background via Viewing Keys with 512-byte memos.
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <span className="badge badge-ironwood">NU6.3 (Ironwood)</span>
                <span className="badge badge-orchard">Halo 2 (Orchard)</span>
                <span className="badge badge-sapling">Groth16 (Sapling)</span>
              </div>
            </div>

            {transactions.length === 0 ? (
              <div className="empty-state">
                <Shield size={48} className="empty-icon" />
                <p style={{ fontWeight: 600, fontSize: '1.1rem', marginBottom: '0.5rem' }}>No Shielded Notes Detected Yet</p>
                <p style={{ fontSize: '0.85rem' }}>
                  Register a viewing key or click <strong>"Simulate Note"</strong> to inject a live demo transaction.
                </p>
                <button
                  className="btn btn-primary"
                  style={{ marginTop: '1.25rem' }}
                  onClick={handleSimulatePayment}
                >
                  <Zap size={16} />
                  <span>Generate Demo Note</span>
                </button>
              </div>
            ) : (
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>TxID</th>
                      <th>Block</th>
                      <th>Pool</th>
                      <th>Amount</th>
                      <th>Decrypted Memo</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((tx) => (
                      <tr key={tx.id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                              {tx.txid.slice(0, 10)}...{tx.txid.slice(-8)}
                            </span>
                            <button
                              className="btn btn-secondary btn-sm"
                              style={{ padding: '0.2rem 0.4rem' }}
                              onClick={() => copyToClipboard(tx.txid, 'TxID')}
                              title="Copy TxID"
                            >
                              <Copy size={12} />
                            </button>
                          </div>
                        </td>
                        <td>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
                            #{tx.block_height}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                            <span className={`badge ${tx.pool === 'Ironwood' ? 'badge-ironwood' : tx.pool === 'Orchard' ? 'badge-orchard' : 'badge-sapling'}`}>
                              {tx.pool}
                            </span>
                            <span className={`badge ${tx.transfer_type === 'outgoing' ? 'badge-outgoing' : tx.transfer_type === 'internal' ? 'badge-internal' : 'badge-incoming'}`} style={{ fontSize: '0.65rem' }}>
                              {tx.transfer_type === 'outgoing' ? 'Outward' : tx.transfer_type === 'internal' ? 'Change' : 'Inward'}
                            </span>
                            {tx.is_simulated ? (
                              <span className="badge badge-simulated" style={{ fontSize: '0.65rem' }}>
                                Simulated
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          <div style={{ 
                            fontWeight: 700, 
                            fontSize: '0.95rem', 
                            color: tx.transfer_type === 'outgoing' ? '#fb7185' : tx.transfer_type === 'internal' ? 'var(--text-muted)' : 'var(--zec-green)' 
                          }}>
                            {tx.transfer_type === 'outgoing' ? '-' : '+'}{tx.amount_zec.toFixed(4)} ZEC
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                            {tx.transfer_type === 'outgoing' ? '-' : '+'}{tx.amount_zat.toLocaleString()} zat
                          </div>
                        </td>
                        <td>
                          <div className="memo-tag" title={tx.memo_text}>
                            <Lock size={12} color="var(--zec-gold)" />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '380px' }}>
                              {tx.memo_text || '<Empty memo>'}
                            </span>
                          </div>
                        </td>
                        <td>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => copyToClipboard(tx.memo_text, 'Memo')}
                            title="Copy Decrypted Memo"
                          >
                            <Copy size={12} />
                            <span>Copy Memo</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: VIEWING KEYS MANAGER */}
      {activeTab === 'keys' && (
        <div className="animate-fade-in">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '2rem' }}>
            {/* Registration Form */}
            <div className="panel">
              <div className="panel-title" style={{ marginBottom: '1rem' }}>
                <Key size={20} color="var(--zec-gold)" />
                <span>Register Viewing Key</span>
              </div>
              <p className="panel-desc" style={{ marginBottom: '1.25rem' }}>
                Add an <strong>Incoming Viewing Key</strong> or <strong>Unified Full Viewing Key (UFVK)</strong>. No spending authority is granted.
              </p>

              <form onSubmit={handleRegisterKey}>
                <div className="form-group">
                  <label className="form-label">Key Label / Merchant Name</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g., E-commerce Checkout Store"
                    value={newKey.label}
                    onChange={(e) => setNewKey({ ...newKey, label: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Viewing Key String (uview...)</label>
                  <textarea
                    className="form-textarea"
                    placeholder="uviewtest1qqqq... or uview1..."
                    required
                    value={newKey.key}
                    onChange={(e) => setNewKey({ ...newKey, key: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Birthday Height (Scan start)</label>
                  <input
                    type="number"
                    className="form-input"
                    value={newKey.birth_height}
                    onChange={(e) => setNewKey({ ...newKey, birth_height: e.target.value })}
                  />
                  <small style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>
                    Block height when address was created (skips past history).
                  </small>
                </div>

                <button id="submit-key-btn" type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                  <Key size={16} />
                  <span>Register & Begin Syncing</span>
                </button>
              </form>
            </div>

            {/* Keys Table */}
            <div className="panel">
              <div className="panel-title" style={{ marginBottom: '1rem' }}>
                <Activity size={20} color="var(--zec-green)" />
                <span>Active Monitored Keys</span>
              </div>

              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Label & Type</th>
                      <th>Key Preview</th>
                      <th>Birthday</th>
                      <th>Scanned Height</th>
                      <th>Sync Status</th>
                      <th style={{ textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((k) => (
                      <tr key={k.id}>
                        <td>
                          <div style={{ fontWeight: 700 }}>{k.label}</div>
                          <span className="badge badge-orchard" style={{ fontSize: '0.65rem' }}>
                            {k.key_type}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            {k.key_string.slice(0, 16)}...{k.key_string.slice(-10)}
                          </div>
                        </td>
                        <td>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
                            #{k.birth_height}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--zec-gold)' }}>
                            #{k.last_scanned_height}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div
                              style={{
                                width: '60px',
                                height: '6px',
                                background: 'rgba(255,255,255,0.1)',
                                borderRadius: '4px',
                                overflow: 'hidden',
                              }}
                            >
                              <div
                                style={{
                                  width: `${k.sync_percent}%`,
                                  height: '100%',
                                  background: 'var(--zec-green)',
                                }}
                              ></div>
                            </div>
                            <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{k.sync_percent}%</span>
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="btn btn-secondary"
                            style={{
                              padding: '0.3rem 0.65rem',
                              fontSize: '0.75rem',
                              color: '#ff6b6b',
                              borderColor: 'rgba(255, 107, 107, 0.3)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.35rem',
                              cursor: 'pointer',
                            }}
                            onClick={() => handleDeleteKey(k.id, k.label)}
                            title="Remove viewing key"
                          >
                            <Trash2 size={13} /> Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: WEBHOOKS & DELIVERIES */}
      {activeTab === 'webhooks' && (
        <div className="animate-fade-in">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '2rem' }}>
            {/* Webhook Form */}
            <div className="panel">
              <div className="panel-title" style={{ marginBottom: '1rem' }}>
                <Webhook size={20} color="var(--cyan-accent)" />
                <span>Add Webhook Endpoint</span>
              </div>
              <p className="panel-desc" style={{ marginBottom: '1.25rem' }}>
                Receive instant cryptographically signed HTTP POST payloads whenever a shielded note matches.
              </p>

              <form onSubmit={handleRegisterWebhook}>
                <div className="form-group">
                  <label className="form-label">Endpoint URL</label>
                  <input
                    type="url"
                    className="form-input"
                    placeholder="https://api.yourstore.com/webhooks/zcash"
                    required
                    value={newWebhook.target_url}
                    onChange={(e) => setNewWebhook({ ...newWebhook, target_url: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Description</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Payment Notification Dispatcher"
                    value={newWebhook.description}
                    onChange={(e) => setNewWebhook({ ...newWebhook, description: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">HMAC Secret (Optional)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Leave empty to auto-generate secret"
                    value={newWebhook.secret}
                    onChange={(e) => setNewWebhook({ ...newWebhook, secret: e.target.value })}
                  />
                  <small style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>
                    Used to sign <code>X-ZecShield-Signature</code> header.
                  </small>
                </div>

                <button id="submit-webhook-btn" type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                  <Webhook size={16} />
                  <span>Register Webhook</span>
                </button>
              </form>
            </div>

            {/* Deliveries & Active Webhooks */}
            <div>
              <div className="panel" style={{ marginBottom: '1.5rem' }}>
                <div className="panel-title" style={{ marginBottom: '1rem' }}>
                  <Radio size={20} color="var(--cyan-accent)" />
                  <span>Configured Webhook Endpoints</span>
                </div>

                {webhooks.length === 0 ? (
                  <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>No webhooks registered.</p>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>URL</th>
                        <th>Secret</th>
                        <th>Status</th>
                        <th style={{ textAlign: 'right' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {webhooks.map((w) => (
                        <tr key={w.id}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{w.target_url}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{w.description}</div>
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                {w.secret.slice(0, 8)}...
                              </span>
                              <button
                                className="btn btn-secondary btn-sm"
                                style={{ padding: '0.15rem 0.35rem' }}
                                onClick={() => copyToClipboard(w.secret, 'Webhook Secret')}
                              >
                                <Copy size={11} />
                              </button>
                            </div>
                          </td>
                          <td>
                            <span className="badge badge-sapling">Active</span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              className="btn btn-secondary"
                              style={{
                                padding: '0.3rem 0.65rem',
                                fontSize: '0.75rem',
                                color: '#ff6b6b',
                                borderColor: 'rgba(255, 107, 107, 0.3)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.35rem',
                                cursor: 'pointer',
                              }}
                              onClick={() => handleDeleteWebhook(w.id, w.target_url)}
                              title="Remove webhook"
                            >
                              <Trash2 size={13} /> Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Delivery Logs */}
              <div className="panel">
                <div className="panel-title" style={{ marginBottom: '1rem' }}>
                  <Clock size={20} color="var(--zec-gold)" />
                  <span>Live Delivery Logs</span>
                </div>

                {deliveries.length === 0 ? (
                  <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>No deliveries logged yet.</p>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Note ID</th>
                        <th>Status</th>
                        <th>Response Body</th>
                        <th>Delivered At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deliveries.map((d) => (
                        <tr key={d.id}>
                          <td>
                            <span style={{ fontFamily: 'var(--font-mono)' }}>#{d.note_id}</span>
                          </td>
                          <td>
                            <span
                              className="badge"
                              style={{
                                background: d.status_code === 200 ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                                color: d.status_code === 200 ? '#10b981' : '#ef4444',
                              }}
                            >
                              HTTP {d.status_code || 'ERR'}
                            </span>
                          </td>
                          <td>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                              {d.response_body ? d.response_body.slice(0, 60) : '<empty>'}
                            </div>
                          </td>
                          <td>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                              {new Date(d.delivered_at * 1000).toLocaleTimeString()}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: PITCH SIMULATOR */}
      {activeTab === 'simulator' && (
        <div className="animate-fade-in">
          <div className="simulator-box">
            <div className="panel-title" style={{ marginBottom: '0.5rem', color: 'var(--zec-gold)' }}>
              <Zap size={22} />
              <span>Interactive Shielded Note Simulator (Pitch Presentation Tool)</span>
            </div>
            <p className="panel-desc" style={{ marginBottom: '1.5rem' }}>
              Because waiting ~75 seconds for a real Zcash block to mine during a live pitch presentation is impractical,
              this tool instantly generates a valid shielded note, records it in SQLite, and dispatches the signed HMAC webhook.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
              <div className="form-group">
                <label className="form-label">Payment Amount (ZEC)</label>
                <input
                  type="number"
                  step="0.01"
                  className="form-input"
                  value={simParams.amount_zec}
                  onChange={(e) => setSimParams({ ...simParams, amount_zec: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Shielded Value Pool</label>
                <select
                  className="form-select"
                  value={simParams.pool}
                  onChange={(e) => setSimParams({ ...simParams, pool: e.target.value as 'Orchard' | 'Sapling' | 'Ironwood' })}
                >
                  <option value="Ironwood">Ironwood (ZIP 2005 / NU6.3 Lead Byte 0x03)</option>
                  <option value="Orchard">Orchard (Halo 2 zk-SNARKs, Unified Address)</option>
                  <option value="Sapling">Sapling (Groth16 zk-SNARKs)</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Encrypted 512-byte Memo Text</label>
              <textarea
                className="form-textarea"
                value={simParams.memo}
                onChange={(e) => setSimParams({ ...simParams, memo: e.target.value })}
                placeholder="Enter confidential order reference, invoice number, or encrypted message..."
              />
            </div>

            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <button
                id="run-simulator-btn"
                className="btn btn-primary"
                onClick={handleSimulatePayment}
              >
                <Zap size={18} />
                <span>Simulate Shielded Payment & Dispatch Webhook</span>
              </button>

              <button
                className="btn btn-secondary"
                onClick={() => setActiveTab('overview')}
              >
                <span>View in Live Stream</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: API DOCS & SDK SNIPPETS */}
      {activeTab === 'docs' && (
        <div className="animate-fade-in">
          <div className="panel">
            <div className="panel-title" style={{ marginBottom: '1rem' }}>
              <Code size={20} color="var(--cyan-accent)" />
              <span>Interactive Developer API Documentation</span>
            </div>
            <p className="panel-desc" style={{ marginBottom: '1.5rem' }}>
              Integrate ZecShield directly into your e-commerce platform, mobile wallet, or bot.
            </p>

            {/* Snippet 1 */}
            <div style={{ marginBottom: '2rem' }}>
              <h4 style={{ fontSize: '1rem', marginBottom: '0.5rem', color: 'var(--zec-gold)' }}>
                1. Register a Viewing Key (cURL)
              </h4>
              <div className="code-block">
                <button
                  className="copy-btn"
                  onClick={() =>
                    copyToClipboard(
                      `curl -X POST http://localhost:3001/api/v1/keys \\
  -H "Content-Type: application/json" \\
  -d '{"key": "uviewtest1...", "label": "My Store", "birth_height": 4500000}'`,
                      'cURL Snippet'
                    )
                  }
                >
                  Copy
                </button>
                <pre>{`curl -X POST http://localhost:3001/api/v1/keys \\
  -H "Content-Type: application/json" \\
  -d '{"key": "uviewtest1...", "label": "My Store", "birth_height": 4500000}'`}</pre>
              </div>
            </div>

            {/* Snippet 2 */}
            <div style={{ marginBottom: '2rem' }}>
              <h4 style={{ fontSize: '1rem', marginBottom: '0.5rem', color: 'var(--zec-green)' }}>
                2. Query Confirmed Shielded Payments & Decrypted Memos (Node.js / TypeScript)
              </h4>
              <div className="code-block">
                <button
                  className="copy-btn"
                  onClick={() =>
                    copyToClipboard(
                      `const res = await fetch('http://localhost:3001/api/v1/transactions');
const { transactions } = await res.json();

transactions.forEach((tx) => {
  console.log(\`Received \${tx.amount_zec} ZEC in block #\${tx.block_height}\`);
  console.log(\`Decrypted Memo: \${tx.memo_text}\`);
});`,
                      'TypeScript Snippet'
                    )
                  }
                >
                  Copy
                </button>
                <pre>{`const res = await fetch('http://localhost:3001/api/v1/transactions');
const { transactions } = await res.json();

transactions.forEach((tx) => {
  console.log(\`Received \${tx.amount_zec} ZEC in block #\${tx.block_height}\`);
  console.log(\`Decrypted Memo: \${tx.memo_text}\`);
});`}</pre>
              </div>
            </div>

            {/* Snippet 3 */}
            <div>
              <h4 style={{ fontSize: '1rem', marginBottom: '0.5rem', color: 'var(--orchard-purple)' }}>
                3. Verify Incoming Webhook HMAC-SHA256 Signature (Node.js Express)
              </h4>
              <div className="code-block">
                <button
                  className="copy-btn"
                  onClick={() =>
                    copyToClipboard(
                      `import crypto from 'crypto';

app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-zecshield-signature'];
  const expected = crypto.createHmac('sha256', process.env.WEBHOOK_SECRET)
                         .update(req.body)
                         .digest('hex');

  if (signature !== expected) {
    return res.status(401).send('Invalid signature');
  }

  const payload = JSON.parse(req.body);
  console.log('Payment verified! Memo:', payload.data.memo);
  res.status(200).send('OK');
});`,
                      'HMAC Webhook Snippet'
                    )
                  }
                >
                  Copy
                </button>
                <pre>{`import crypto from 'crypto';

app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-zecshield-signature'];
  const expected = crypto.createHmac('sha256', process.env.WEBHOOK_SECRET)
                         .update(req.body)
                         .digest('hex');

  if (signature !== expected) {
    return res.status(401).send('Invalid signature');
  }

  const payload = JSON.parse(req.body);
  console.log('Payment verified! Memo:', payload.data.memo);
  res.status(200).send('OK');
});`}</pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
