import React, { useState, useEffect } from 'react';
import {
  Shield,
  Search,
  Activity,
  Key,
  Webhook,
  Play,
  FileCode,
  RefreshCw,
  Copy,
  Zap,
  Lock,
  Radio,
  RotateCcw,
  Trash2,
  ArrowUpRight,
  Plus,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Sparkles
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
  const [, setLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Filters & search
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [poolFilter, setPoolFilter] = useState<'ALL' | 'Ironwood' | 'Orchard' | 'Sapling'>('ALL');

  // Forms state
  const [newKey, setNewKey] = useState({ key: '', label: '', birth_height: '4500000', key_type: 'UFVK' });
  const [newWebhook, setNewWebhook] = useState({ target_url: '', description: '', secret: '' });
  const [simParams, setSimParams] = useState<{ amount_zec: string; memo: string; pool: 'Orchard' | 'Sapling' | 'Ironwood'; transfer_type: 'incoming' | 'outgoing' | 'internal' }>({
    amount_zec: '0.02',
    memo: 'Invoice #ZEC-9012 - Paid with Shielded Zcash',
    pool: 'Ironwood',
    transfer_type: 'incoming'
  });
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
    setIsRefreshing(true);
    try {
      const [statusRes, keysRes, txRes, webhooksRes, deliveriesRes] = await Promise.all([
        fetch('/api/v1/status').then((r) => r.json()).catch(() => null),
        fetch('/api/v1/keys').then((r) => r.json()).catch(() => null),
        fetch('/api/v1/transactions').then((r) => r.json()).catch(() => null),
        fetch('/api/v1/webhooks').then((r) => r.json()).catch(() => null),
        fetch('/api/v1/webhooks/deliveries').then((r) => r.json()).catch(() => null),
      ]);

      if (statusRes && statusRes.status === 'ok') setStatus(statusRes);
      if (keysRes && keysRes.keys) setKeys(keysRes.keys);
      if (txRes && txRes.transactions) setTransactions(txRes.transactions);
      if (webhooksRes && webhooksRes.webhooks) setWebhooks(webhooksRes.webhooks);
      if (deliveriesRes && deliveriesRes.deliveries) setDeliveries(deliveriesRes.deliveries);
    } catch (err: any) {
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
      setTimeout(() => setIsRefreshing(false), 500);
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
        body: JSON.stringify({
          key: newKey.key.trim(),
          label: newKey.label.trim() || undefined,
          birth_height: parseInt(newKey.birth_height, 10) || 0,
          key_type: newKey.key_type
        })
      });
      const data = await res.json();
      if (res.ok) {
        showToast('Viewing Key registered and scanner queued!');
        setNewKey({ key: '', label: '', birth_height: '4500000', key_type: 'UFVK' });
        fetchData();
      } else {
        showToast(data.error || 'Failed to register key', 'error');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleDeleteKey = async (id: number) => {
    if (!window.confirm('Are you sure you want to delete this viewing key and its associated notes?')) return;
    try {
      const res = await fetch(`/api/v1/keys/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        showToast('Viewing Key deleted successfully!');
        fetchData();
      } else {
        showToast(data.error || 'Failed to delete key', 'error');
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
        body: JSON.stringify({
          target_url: newWebhook.target_url.trim(),
          description: newWebhook.description.trim() || undefined,
          secret: newWebhook.secret.trim() || undefined
        })
      });
      const data = await res.json();
      if (res.ok) {
        showToast('Webhook endpoint configured successfully!');
        setNewWebhook({ target_url: '', description: '', secret: '' });
        fetchData();
      } else {
        showToast(data.error || 'Failed to create webhook', 'error');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleDeleteWebhook = async (id: number) => {
    if (!window.confirm('Are you sure you want to delete this webhook endpoint and its delivery logs?')) return;
    try {
      const res = await fetch(`/api/v1/webhooks/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        showToast('Webhook endpoint deleted successfully!');
        fetchData();
      } else {
        showToast(data.error || 'Failed to delete webhook', 'error');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleSimulatePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/v1/simulator/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount_zec: simParams.amount_zec,
          memo: simParams.memo,
          pool: simParams.pool,
          transfer_type: simParams.transfer_type
        })
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`Simulated ${simParams.amount_zec} ZEC (${simParams.pool}) note & dispatched webhook!`);
        fetchData();
      } else {
        showToast(data.error || 'Failed to simulate payment', 'error');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handlePurgeAllData = async () => {
    if (!window.confirm('⚠️ WARNING: This will purge all viewing keys, notes, webhooks, and delivery logs. Continue?')) return;
    try {
      const res = await fetch('/api/v1/debug/purge', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        showToast('Database purged and auto-increment IDs reset to 1!');
        fetchData();
      } else {
        showToast(data.error || 'Failed to purge database', 'error');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  // Filtered transactions
  const filteredTransactions = transactions.filter((tx) => {
    const matchesSearch =
      tx.txid.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tx.memo_text.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tx.block_height.toString().includes(searchTerm);
    const matchesPool = poolFilter === 'ALL' || tx.pool === poolFilter;
    return matchesSearch && matchesPool;
  });

  // Calculate analytics
  const ironwoodCount = transactions.filter((t) => t.pool === 'Ironwood').length;
  const saplingCount = transactions.filter((t) => t.pool === 'Sapling').length;
  const orchardCount = transactions.filter((t) => t.pool === 'Orchard').length;
  const totalNotes = transactions.length || 1;
  const ironwoodPct = Math.round((ironwoodCount / totalNotes) * 100);
  const saplingPct = Math.round((saplingCount / totalNotes) * 100);
  const orchardPct = Math.round((orchardCount / totalNotes) * 100);

  const successfulDeliveries = deliveries.filter((d) => d.status_code >= 200 && d.status_code < 300).length;
  const deliveryRate = deliveries.length ? Math.round((successfulDeliveries / deliveries.length) * 100) : 100;

  return (
    <div className="app-wrapper">
      {/* ====================================================================
          LEFT SIDEBAR (Template 1 Inspired)
          ==================================================================== */}
      <aside className="app-sidebar">
        {/* Brand */}
        <div className="brand-header">
          <div className="brand-icon-wrapper">
            <Shield size={24} color="#ffffff" />
          </div>
          <div>
            <div className="brand-text-title">
              ZecShield
              <span className="brand-badge">Testnet</span>
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Shielded Webhook Gateway</div>
          </div>
        </div>

        {/* Navigation Menu */}
        <div className="nav-section-label">Main Menu</div>
        <nav className="nav-menu">
          <button
            className={`nav-item ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            <div className="nav-item-left">
              <Activity size={18} />
              <span>Dashboard</span>
            </div>
            {transactions.length > 0 && <span className="nav-badge">{transactions.length}</span>}
          </button>

          <button
            className={`nav-item ${activeTab === 'keys' ? 'active' : ''}`}
            onClick={() => setActiveTab('keys')}
          >
            <div className="nav-item-left">
              <Key size={18} />
              <span>Viewing Keys</span>
            </div>
            <span className="nav-badge">{keys.length}</span>
          </button>

          <button
            className={`nav-item ${activeTab === 'webhooks' ? 'active' : ''}`}
            onClick={() => setActiveTab('webhooks')}
          >
            <div className="nav-item-left">
              <Webhook size={18} />
              <span>Webhooks</span>
            </div>
            <span className="nav-badge">{webhooks.length}</span>
          </button>

          <button
            className={`nav-item ${activeTab === 'simulator' ? 'active' : ''}`}
            onClick={() => setActiveTab('simulator')}
          >
            <div className="nav-item-left">
              <Play size={18} />
              <span>Simulate Note</span>
            </div>
            <span className="nav-badge" style={{ color: 'var(--orange-primary)' }}>Test</span>
          </button>

          <button
            className={`nav-item ${activeTab === 'docs' ? 'active' : ''}`}
            onClick={() => setActiveTab('docs')}
          >
            <div className="nav-item-left">
              <FileCode size={18} />
              <span>API Reference</span>
            </div>
          </button>
        </nav>

        {/* Network & Debug Section */}
        <div className="nav-section-label">Chain & Utilities</div>
        <nav className="nav-menu">
          <div className="nav-item" style={{ cursor: 'default' }}>
            <div className="nav-item-left">
              <Radio size={16} color="var(--orange-primary)" />
              <span style={{ fontSize: '0.82rem' }}>Block Tip #{status?.chain_tip || 4529180}</span>
            </div>
          </div>

          <button
            className="nav-item"
            style={{ color: '#be123c' }}
            onClick={handlePurgeAllData}
            title="Clean database and reset sequence IDs"
          >
            <div className="nav-item-left">
              <RotateCcw size={16} />
              <span style={{ fontSize: '0.82rem' }}>Purge & Reset</span>
            </div>
          </button>
        </nav>

        {/* NU6.3 Protocol Ready Pill */}
        <div className="sidebar-protocol-container">
          <div className="sidebar-protocol-pill" title="NU6.3 Protocol Ready (Ironwood v6 Support)">
            <span className="protocol-pulse-dot" />
            <Sparkles size={13} />
            <span>NU6.3 Protocol Ready</span>
          </div>
        </div>
      </aside>

      {/* ====================================================================
          MAIN CONTENT AREA
          ==================================================================== */}
      <main className="app-main">
        {/* Top Header Bar */}
        <header className="top-header">
          {/* Search Box */}
          <div className="search-box-wrapper">
            <Search className="search-icon-left" size={17} />
            <input
              type="text"
              className="search-input"
              placeholder="Search by TxID, Memo text, or Block..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <span className="search-shortcut-badge">⌘K</span>
          </div>

          {/* Right Header Info */}
          <div className="top-header-right">
            <button
              className="header-icon-btn"
              onClick={fetchData}
              title="Refresh live data from server"
            >
              <RefreshCw size={17} className={isRefreshing ? 'spin-animation' : ''} />
            </button>

            {/* User Profile / Active Monitored Wallet */}
            <div className="user-profile-badge">
              <div className="user-avatar-circle">ZW</div>
              <div className="user-info-text">
                <span className="user-name-title">
                  {keys.length > 0 ? keys[0].label || 'Main Testnet Wallet' : 'No Keys Active'}
                </span>
                <span className="user-wallet-address">
                  {keys.length > 0 ? `${keys[0].key_string.slice(0, 10)}...${keys[0].key_string.slice(-6)}` : 'Register UFVK below'}
                </span>
              </div>
            </div>
          </div>
        </header>

        {/* ==================================================================
            TAB 1: OVERVIEW / LIVE DASHBOARD
            ================================================================== */}
        {activeTab === 'overview' && (
          <>
            {/* Page Title & Action Bar */}
            <div className="page-title-row">
              <div className="page-title-left">
                <h1>Dashboard</h1>
                <div className="page-subtitle-desc">
                  Real-time zero-knowledge transaction indexing, trial decryption, and webhook engine.
                </div>
              </div>

              <div className="page-title-actions">
                <button
                  className="btn btn-secondary"
                  onClick={() => setActiveTab('webhooks')}
                >
                  <Plus size={16} />
                  <span>Register Webhook</span>
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => setActiveTab('simulator')}
                >
                  <Zap size={16} />
                  <span>Simulate Payment</span>
                </button>
              </div>
            </div>

            {/* 4 Stat Cards Grid (Template 1 Inspired) */}
            <div className="stat-cards-grid">
              {/* Card 1: Featured Burnt Orange Card */}
              <div className="stat-card-featured">
                <div className="stat-header">
                  <span className="stat-label">Total Shielded Value</span>
                  <div className="stat-arrow-btn">
                    <ArrowUpRight size={18} />
                  </div>
                </div>
                <div className="stat-value">
                  {status ? `${status.stats.total_shielded_zec} ZEC` : '1.1623 ZEC'}
                </div>
                <div className="stat-footer">
                  <span className="trend-badge" style={{ background: 'rgba(255,255,255,0.2)', color: '#ffffff' }}>
                    100% Synced
                  </span>
                  <span>{status?.stats.total_shielded_zat.toLocaleString() || '116,230,000'} zat</span>
                </div>
              </div>

              {/* Card 2: Indexed Transactions */}
              <div className="stat-card-white">
                <div className="stat-header">
                  <span className="stat-label">Indexed Notes</span>
                  <div className="stat-arrow-btn">
                    <ArrowUpRight size={18} />
                  </div>
                </div>
                <div className="stat-value">{transactions.length}</div>
                <div className="stat-footer">
                  <span className="trend-badge positive">All Pools</span>
                  <span>Ironwood, Orchard & Sapling</span>
                </div>
              </div>

              {/* Card 3: Monitored Keys */}
              <div className="stat-card-white">
                <div className="stat-header">
                  <span className="stat-label">Monitored Keys</span>
                  <div className="stat-arrow-btn">
                    <ArrowUpRight size={18} />
                  </div>
                </div>
                <div className="stat-value">{keys.length}</div>
                <div className="stat-footer">
                  <span className="trend-badge orange">Continuous</span>
                  <span>Tip #{status?.chain_tip || 4529180}</span>
                </div>
              </div>

              {/* Card 4: Webhook Deliveries */}
              <div className="stat-card-white">
                <div className="stat-header">
                  <span className="stat-label">Webhook Deliveries</span>
                  <div className="stat-arrow-btn">
                    <ArrowUpRight size={18} />
                  </div>
                </div>
                <div className="stat-value">{deliveries.length}</div>
                <div className="stat-footer">
                  <span className="trend-badge positive">{deliveryRate}% HTTP 200</span>
                  <span>{webhooks.length} Active Endpoints</span>
                </div>
              </div>
            </div>

            {/* Analytics & Syncer Status Grid */}
            <div className="analytics-grid">
              {/* Pool Distribution Card */}
              <div className="dashboard-card">
                <div className="card-header-row">
                  <div className="card-title-text">Shielded Pool Analytics</div>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{transactions.length} total notes</span>
                </div>

                <div className="pool-bars-container">
                  <div className="pool-bar-item">
                    <div className="pool-bar-header">
                      <span style={{ color: 'var(--pool-ironwood)' }}>Ironwood (ZIP 2005 / NU6.3)</span>
                      <span>{ironwoodCount} notes ({ironwoodPct}%)</span>
                    </div>
                    <div className="progress-track">
                      <div className="progress-fill ironwood" style={{ width: `${ironwoodPct}%` }} />
                    </div>
                  </div>

                  <div className="pool-bar-item">
                    <div className="pool-bar-header">
                      <span style={{ color: 'var(--pool-sapling)' }}>Sapling (Groth16)</span>
                      <span>{saplingCount} notes ({saplingPct}%)</span>
                    </div>
                    <div className="progress-track">
                      <div className="progress-fill sapling" style={{ width: `${saplingPct}%` }} />
                    </div>
                  </div>

                  <div className="pool-bar-item">
                    <div className="pool-bar-header">
                      <span style={{ color: 'var(--pool-orchard)' }}>Orchard (Halo 2)</span>
                      <span>{orchardCount} notes ({orchardPct}%)</span>
                    </div>
                    <div className="progress-track">
                      <div className="progress-fill orchard" style={{ width: `${orchardPct}%` }} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Center Widget: Syncer Status */}
              <div className="syncer-status-widget">
                <div>
                  <div className="syncer-live-badge">
                    <div className="syncer-pulse-dot" />
                    <span>Scanner Connected</span>
                  </div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '0.35rem' }}>
                    Zcash Testnet Scanner
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8', lineHeight: 1.4 }}>
                    Upstream: {status?.lightwalletd_url || 'https://testnet.zec.rocks:443'}
                  </div>
                </div>

                <div style={{ marginTop: '1.25rem' }}>
                  <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '0.2rem' }}>
                    Chain Tip Synchronized
                  </div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--orange-bright)' }}>
                    #{status?.chain_tip || 4529180}
                  </div>
                </div>
              </div>

              {/* Right Widget: Quick Actions */}
              <div className="dashboard-card">
                <div className="card-header-row">
                  <div className="card-title-text">Quick Actions</div>
                  <span className="card-action-link" onClick={() => setActiveTab('docs')}>Docs</span>
                </div>

                <div className="quick-action-list">
                  <div className="quick-action-item" onClick={() => setActiveTab('keys')}>
                    <div className="quick-action-left">
                      <div className="quick-action-icon">
                        <Key size={18} />
                      </div>
                      <div>
                        <div className="quick-action-title">Manage Viewing Keys</div>
                        <div className="quick-action-desc">Add or remove UFVKs</div>
                      </div>
                    </div>
                    <ChevronRight size={16} color="var(--text-light)" />
                  </div>

                  <div className="quick-action-item" onClick={() => setActiveTab('webhooks')}>
                    <div className="quick-action-left">
                      <div className="quick-action-icon">
                        <Webhook size={18} />
                      </div>
                      <div>
                        <div className="quick-action-title">Configure Webhooks</div>
                        <div className="quick-action-desc">Add destination endpoints</div>
                      </div>
                    </div>
                    <ChevronRight size={16} color="var(--text-light)" />
                  </div>

                  <div className="quick-action-item" onClick={() => setActiveTab('simulator')}>
                    <div className="quick-action-left">
                      <div className="quick-action-icon">
                        <Play size={18} />
                      </div>
                      <div>
                        <div className="quick-action-title">Simulate Payment</div>
                        <div className="quick-action-desc">Inject test note & webhook</div>
                      </div>
                    </div>
                    <ChevronRight size={16} color="var(--text-light)" />
                  </div>
                </div>
              </div>
            </div>

            {/* Shielded Transactions Live Feed Table Card */}
            <div className="table-card">
              <div className="table-header-bar">
                <div className="table-title-group">
                  <h2>Shielded Transactions Live Feed</h2>
                  <p>Transactions trial-decrypted on-chain in the background with 512-byte memos</p>
                </div>

                {/* Pool Filter Pills */}
                <div className="filter-pills-row">
                  {(['ALL', 'Ironwood', 'Orchard', 'Sapling'] as const).map((p) => (
                    <button
                      key={p}
                      className={`filter-pill ${poolFilter === p ? 'active' : ''}`}
                      onClick={() => setPoolFilter(p)}
                    >
                      {p === 'ALL' ? 'All Pools' : p}
                    </button>
                  ))}
                </div>
              </div>

              {filteredTransactions.length === 0 ? (
                <div className="empty-state-box">
                  <div className="empty-icon-wrap">
                    <Shield size={32} />
                  </div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.4rem' }}>
                    No Transactions Found
                  </h3>
                  <p style={{ fontSize: '0.85rem', maxWidth: '400px', margin: '0 auto 1.25rem' }}>
                    {searchTerm ? `No transactions matched "${searchTerm}"` : 'Register a viewing key or click "Simulate Payment" to create a demo note.'}
                  </p>
                  <button className="btn btn-primary" onClick={() => setActiveTab('simulator')}>
                    Simulate Demo Note
                  </button>
                </div>
              ) : (
                <div className="data-table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>TxID</th>
                        <th>Block</th>
                        <th>Pool & Type</th>
                        <th>Amount</th>
                        <th>Decrypted Memo</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTransactions.map((tx) => (
                        <tr key={tx.id}>
                          {/* TxID */}
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-main)' }}>
                                {tx.txid.slice(0, 10)}...{tx.txid.slice(-8)}
                              </span>
                              <button
                                className="btn btn-secondary btn-icon-only btn-sm"
                                onClick={() => copyToClipboard(tx.txid, 'TxID')}
                                title="Copy TxID"
                              >
                                <Copy size={13} />
                              </button>
                            </div>
                          </td>

                          {/* Block Height */}
                          <td>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                              #{tx.block_height}
                            </span>
                          </td>

                          {/* Pool & Direction Badges */}
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                              <span className={`badge ${tx.pool === 'Ironwood' ? 'badge-ironwood' : tx.pool === 'Orchard' ? 'badge-orchard' : 'badge-sapling'}`}>
                                {tx.pool}
                              </span>
                              <span className={`badge ${tx.transfer_type === 'outgoing' ? 'badge-outgoing' : tx.transfer_type === 'internal' ? 'badge-internal' : 'badge-incoming'}`}>
                                {tx.transfer_type === 'outgoing' ? 'Outward' : tx.transfer_type === 'internal' ? 'Change' : 'Inward'}
                              </span>
                              {tx.is_simulated ? (
                                <span className="badge badge-simulated">Simulated</span>
                              ) : null}
                            </div>
                          </td>

                          {/* Amount with proper +/- prefix, burnt orange / green / red color, and Playfair Display font */}
                          <td>
                            <div
                              className="amount-zec-val"
                              style={{
                                color: tx.transfer_type === 'outgoing' ? 'var(--status-outward)' : tx.transfer_type === 'internal' ? 'var(--text-muted)' : 'var(--status-inward)'
                              }}
                            >
                              {tx.transfer_type === 'outgoing' ? '-' : '+'}{tx.amount_zec.toFixed(4)} ZEC
                            </div>
                            <div className="amount-zat-val">
                              {tx.transfer_type === 'outgoing' ? '-' : '+'}{tx.amount_zat.toLocaleString()} zat
                            </div>
                          </td>

                          {/* Decrypted Memo */}
                          <td>
                            <div className="memo-pill-tag" title={tx.memo_text || '<Empty memo>'}>
                              <Lock size={12} color="var(--orange-primary)" />
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '300px' }}>
                                {tx.memo_text || '<Empty memo>'}
                              </span>
                            </div>
                          </td>

                          {/* Copy Memo */}
                          <td>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => copyToClipboard(tx.memo_text, 'Memo')}
                              title="Copy Decrypted Memo"
                            >
                              <Copy size={13} />
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
          </>
        )}

        {/* ==================================================================
            TAB 2: VIEWING KEYS MANAGEMENT
            ================================================================== */}
        {activeTab === 'keys' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div className="page-title-row">
              <div className="page-title-left">
                <h1>Viewing Keys</h1>
                <div className="page-subtitle-desc">
                  Register Incoming (IVK) or Unified Full Viewing Keys (UFVK) for non-custodial transaction trial decryption.
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1.5rem' }}>
              {/* Register Form */}
              <div className="dashboard-card">
                <div className="card-header-row">
                  <div className="card-title-text">Register New Key</div>
                </div>

                <form onSubmit={handleRegisterKey}>
                  <div className="form-group">
                    <label className="form-label">Key Label / Account Name</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g., Merchant Checkout Wallet"
                      value={newKey.label}
                      onChange={(e) => setNewKey({ ...newKey, label: e.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Key Type</label>
                    <select
                      className="form-select"
                      value={newKey.key_type}
                      onChange={(e) => setNewKey({ ...newKey, key_type: e.target.value })}
                    >
                      <option value="UFVK">UFVK — Unified Full Viewing Key (Recommended)</option>
                      <option value="Orchard_FVK">Orchard FVK / IVK</option>
                      <option value="Sapling_IVK">Sapling Extended IVK (zxviews...)</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Key String</label>
                    <textarea
                      className="form-textarea"
                      placeholder="uviewtest1... or zxviews..."
                      value={newKey.key}
                      onChange={(e) => setNewKey({ ...newKey, key: e.target.value })}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Birth Height (Block checkpoint)</label>
                    <input
                      type="number"
                      className="form-input"
                      value={newKey.birth_height}
                      onChange={(e) => setNewKey({ ...newKey, birth_height: e.target.value })}
                    />
                  </div>

                  <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}>
                    <Plus size={16} />
                    <span>Register Key & Start Sync</span>
                  </button>
                </form>
              </div>

              {/* Active Keys Table */}
              <div className="table-card">
                <div className="card-header-row">
                  <div className="card-title-text">Active Monitored Keys ({keys.length})</div>
                </div>

                {keys.length === 0 ? (
                  <div className="empty-state-box">
                    <Key size={32} color="var(--orange-primary)" style={{ margin: '0 auto 1rem' }} />
                    <p>No viewing keys registered yet. Add your first UFVK above!</p>
                  </div>
                ) : (
                  <div className="data-table-wrapper">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Label & Type</th>
                          <th>Key String</th>
                          <th>Birth</th>
                          <th>Last Scanned</th>
                          <th>Status</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {keys.map((k) => (
                          <tr key={k.id}>
                            <td>
                              <div style={{ fontWeight: 600 }}>{k.label || 'Unlabeled'}</div>
                              <span className="badge badge-orchard" style={{ fontSize: '0.68rem' }}>
                                {k.key_type}
                              </span>
                            </td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                  {k.key_string.slice(0, 14)}...{k.key_string.slice(-8)}
                                </span>
                                <button
                                  className="btn btn-secondary btn-icon-only btn-sm"
                                  onClick={() => copyToClipboard(k.key_string, 'Viewing Key')}
                                  title="Copy Key String"
                                >
                                  <Copy size={12} />
                                </button>
                              </div>
                            </td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>#{k.birth_height}</td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 600, color: 'var(--orange-primary)' }}>
                              #{k.last_scanned_height}
                            </td>
                            <td>
                              <span className="badge badge-active">Active</span>
                            </td>
                            <td>
                              <button
                                className="btn btn-secondary btn-sm"
                                style={{ color: '#be123c', borderColor: '#fecdd3' }}
                                onClick={() => handleDeleteKey(k.id)}
                                title="Remove key"
                              >
                                <Trash2 size={13} />
                                <span>Delete</span>
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
          </div>
        )}

        {/* ==================================================================
            TAB 3: WEBHOOKS & DELIVERIES
            ================================================================== */}
        {activeTab === 'webhooks' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div className="page-title-row">
              <div className="page-title-left">
                <h1>Webhooks & Deliveries</h1>
                <div className="page-subtitle-desc">
                  Configure HMAC-SHA256 signed event listeners for on-chain shielded note discoveries.
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1.5rem' }}>
              {/* Add Webhook Form */}
              <div className="dashboard-card">
                <div className="card-header-row">
                  <div className="card-title-text">Register Webhook Endpoint</div>
                </div>

                <form onSubmit={handleRegisterWebhook}>
                  <div className="form-group">
                    <label className="form-label">Target Destination URL</label>
                    <input
                      type="url"
                      className="form-input"
                      placeholder="https://api.yourdomain.com/webhooks/zcash"
                      value={newWebhook.target_url}
                      onChange={(e) => setNewWebhook({ ...newWebhook, target_url: e.target.value })}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Description / Identifier</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g., Main Production Payment Listener"
                      value={newWebhook.description}
                      onChange={(e) => setNewWebhook({ ...newWebhook, description: e.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">HMAC Signing Secret (Optional)</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Auto-generated if left empty"
                      value={newWebhook.secret}
                      onChange={(e) => setNewWebhook({ ...newWebhook, secret: e.target.value })}
                    />
                  </div>

                  <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}>
                    <Plus size={16} />
                    <span>Save Webhook Endpoint</span>
                  </button>
                </form>
              </div>

              {/* Endpoints Table */}
              <div className="table-card">
                <div className="card-header-row">
                  <div className="card-title-text">Configured Endpoints ({webhooks.length})</div>
                </div>

                {webhooks.length === 0 ? (
                  <div className="empty-state-box">
                    <Webhook size={32} color="var(--orange-primary)" style={{ margin: '0 auto 1rem' }} />
                    <p>No webhook endpoints registered yet. Configure your destination listener above!</p>
                  </div>
                ) : (
                  <div className="data-table-wrapper">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Description</th>
                          <th>Target URL</th>
                          <th>Secret Key</th>
                          <th>Status</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {webhooks.map((w) => (
                          <tr key={w.id}>
                            <td style={{ fontWeight: 600 }}>{w.description || 'Webhook #' + w.id}</td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--text-main)' }}>
                                  {w.target_url}
                                </span>
                                <button
                                  className="btn btn-secondary btn-icon-only btn-sm"
                                  onClick={() => copyToClipboard(w.target_url, 'Webhook URL')}
                                  title="Copy URL"
                                >
                                  <Copy size={12} />
                                </button>
                              </div>
                            </td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                  {w.secret.slice(0, 10)}...
                                </span>
                                <button
                                  className="btn btn-secondary btn-icon-only btn-sm"
                                  onClick={() => copyToClipboard(w.secret, 'Secret')}
                                  title="Copy Secret"
                                >
                                  <Copy size={12} />
                                </button>
                              </div>
                            </td>
                            <td>
                              <span className="badge badge-active">Active</span>
                            </td>
                            <td>
                              <button
                                className="btn btn-secondary btn-sm"
                                style={{ color: '#be123c', borderColor: '#fecdd3' }}
                                onClick={() => handleDeleteWebhook(w.id)}
                                title="Remove webhook"
                              >
                                <Trash2 size={13} />
                                <span>Delete</span>
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

            {/* Delivery Logs */}
            <div className="table-card">
              <div className="card-header-row">
                <div className="card-title-text">Recent Webhook Deliveries ({deliveries.length})</div>
              </div>

              {deliveries.length === 0 ? (
                <div className="empty-state-box">
                  <p>No delivery attempts recorded yet.</p>
                </div>
              ) : (
                <div className="data-table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Note ID</th>
                        <th>Status Code</th>
                        <th>Delivered At</th>
                        <th>Payload Snippet</th>
                        <th>Response Preview</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deliveries.slice(0, 15).map((d) => (
                        <tr key={d.id}>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>#{d.id}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>#{d.note_id}</td>
                          <td>
                            <span className={`badge ${d.status_code >= 200 && d.status_code < 300 ? 'badge-status-200' : 'badge-outgoing'}`}>
                              {d.status_code === 0 ? 'FAIL' : `HTTP ${d.status_code}`}
                            </span>
                          </td>
                          <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            {new Date(d.delivered_at * 1000).toLocaleTimeString()}
                          </td>
                          <td>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              {d.payload.slice(0, 50)}...
                            </span>
                          </td>
                          <td>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              {d.response_body ? d.response_body.slice(0, 45) : 'OK'}
                            </span>
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

        {/* ==================================================================
            TAB 4: TEST PAYMENT SIMULATOR
            ================================================================== */}
        {activeTab === 'simulator' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div className="page-title-row">
              <div className="page-title-left">
                <h1>Test Payment Simulator</h1>
                <div className="page-subtitle-desc">
                  Inject synthetic or testnet shielded notes to test webhook handlers and frontend reactivity end-to-end.
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1.5rem' }}>
              <div className="dashboard-card">
                <div className="card-header-row">
                  <div className="card-title-text">Configure Simulated Note</div>
                </div>

                <form onSubmit={handleSimulatePayment}>
                  <div className="form-group">
                    <label className="form-label">Payment Amount (ZEC)</label>
                    <input
                      type="number"
                      step="0.0001"
                      className="form-input"
                      value={simParams.amount_zec}
                      onChange={(e) => setSimParams({ ...simParams, amount_zec: e.target.value })}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Shielded Value Pool</label>
                    <select
                      className="form-select"
                      value={simParams.pool}
                      onChange={(e) => setSimParams({ ...simParams, pool: e.target.value as any })}
                    >
                      <option value="Ironwood">Ironwood (ZIP 2005 / NU6.3 Lead Byte 0x03)</option>
                      <option value="Orchard">Orchard (Halo 2 zk-SNARKs, Unified Address)</option>
                      <option value="Sapling">Sapling (Groth16 zk-SNARKs)</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Transfer Direction Type</label>
                    <select
                      className="form-select"
                      value={simParams.transfer_type}
                      onChange={(e) => setSimParams({ ...simParams, transfer_type: e.target.value as any })}
                    >
                      <option value="incoming">Inward / Incoming Payment (+)</option>
                      <option value="outgoing">Outward / Withdrawal Transfer (-)</option>
                      <option value="internal">Internal / Wallet Change (+)</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">512-Byte Encrypted Memo Text</label>
                    <textarea
                      className="form-textarea"
                      placeholder="Invoice #9012 - Real estate down payment..."
                      value={simParams.memo}
                      onChange={(e) => setSimParams({ ...simParams, memo: e.target.value })}
                    />
                  </div>

                  <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}>
                    <Zap size={16} />
                    <span>Dispatch Simulated Payment & Trigger Webhooks</span>
                  </button>
                </form>
              </div>

              <div className="dashboard-card" style={{ background: 'var(--bg-card-subtle)' }}>
                <div className="card-header-row">
                  <div className="card-title-text">What Happens When You Click Simulate?</div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.88rem', color: 'var(--text-body)' }}>
                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <div className="badge badge-ironwood" style={{ height: 'fit-content' }}>1</div>
                    <div>
                      <strong>Generates Cryptographic Note:</strong> Creates a simulated shielded note with the chosen pool, amount, and 512-byte memo.
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <div className="badge badge-ironwood" style={{ height: 'fit-content' }}>2</div>
                    <div>
                      <strong>Indexes into SQLite:</strong> Persists to the local database under your active viewing key.
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <div className="badge badge-ironwood" style={{ height: 'fit-content' }}>3</div>
                    <div>
                      <strong>Dispatches HMAC-Signed Webhook:</strong> Fires HTTP POST requests with <code>X-ZecShield-Signature</code> to all active webhooks.
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <div className="badge badge-ironwood" style={{ height: 'fit-content' }}>4</div>
                    <div>
                      <strong>Updates Live Feed:</strong> Automatically surfaces on the Dashboard table with correct direction signs.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================================================================
            TAB 5: API DOCUMENTATION & SNIPPETS
            ================================================================== */}
        {activeTab === 'docs' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div className="page-title-row">
              <div className="page-title-left">
                <h1>Developer API Reference</h1>
                <div className="page-subtitle-desc">
                  Simple REST endpoints to register keys, query decrypted transactions, and configure event webhooks.
                </div>
              </div>
            </div>

            <div className="table-card">
              <div className="card-header-row">
                <div className="card-title-text">Quickstart Example (Node.js / Express Webhook Listener)</div>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => copyToClipboard(
`import express from 'express';
import crypto from 'crypto';

const app = express();
app.use(express.json());

const WEBHOOK_SECRET = 'your-secret-here';

app.post('/webhooks/zcash', (req, res) => {
  const signature = req.headers['x-zecshield-signature'];
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(JSON.stringify(req.body)).digest('hex');

  if (signature !== expected) {
    return res.status(401).send('Invalid signature');
  }

  const { event, data } = req.body;
  if (event === 'shielded_note.detected') {
    console.log(\`Received \${data.amount_zec} ZEC in block #\${data.block_height}!\`);
    console.log(\`Pool: \${data.pool}, Memo: \${data.memo}\`);
  }

  res.status(200).send('OK');
});

app.listen(8080);`,
                    'Node.js Snippet'
                  )}
                >
                  <Copy size={13} />
                  <span>Copy Code</span>
                </button>
              </div>

              <div className="code-preview-box">
                <pre style={{ margin: 0 }}>
{`// 1. Verify HMAC-SHA256 signature and process payment
import express from 'express';
import crypto from 'crypto';

const app = express();
app.use(express.json());

const WEBHOOK_SECRET = 'your-webhook-secret';

app.post('/webhooks/zcash', (req, res) => {
  const signature = req.headers['x-zecshield-signature'];
  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (signature !== expected) {
    return res.status(401).send('Invalid signature');
  }

  const { event, data } = req.body;
  if (event === 'shielded_note.detected') {
    console.log(\`Shielded payment received!\`);
    console.log(\`TxID: \${data.txid}\`);
    console.log(\`Amount: \${data.amount_zec} ZEC (\${data.pool} pool)\`);
    console.log(\`Decrypted Memo: \${data.memo}\`);
  }

  res.status(200).send('OK');
});`}
                </pre>
              </div>
            </div>

            {/* REST Endpoints Table */}
            <div className="table-card">
              <div className="card-header-row">
                <div className="card-title-text">Available REST Endpoints</div>
              </div>

              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Method</th>
                      <th>Endpoint</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><span className="badge badge-incoming" style={{ fontFamily: 'var(--font-mono)' }}>GET</span></td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>/api/v1/status</td>
                      <td>Get gateway syncer status, current block tip, and total indexed metrics.</td>
                    </tr>
                    <tr>
                      <td><span className="badge badge-incoming" style={{ fontFamily: 'var(--font-mono)' }}>GET</span></td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>/api/v1/transactions</td>
                      <td>Query confirmed and decrypted shielded notes across all pools with memos.</td>
                    </tr>
                    <tr>
                      <td><span className="badge badge-ironwood" style={{ fontFamily: 'var(--font-mono)' }}>POST</span></td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>/api/v1/keys</td>
                      <td>Register a new Viewing Key (UFVK / IVK) to queue background chain trial-decryption.</td>
                    </tr>
                    <tr>
                      <td><span className="badge badge-ironwood" style={{ fontFamily: 'var(--font-mono)' }}>POST</span></td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>/api/v1/webhooks</td>
                      <td>Register an HTTP destination endpoint for instant note notifications.</td>
                    </tr>
                    <tr>
                      <td><span className="badge badge-ironwood" style={{ fontFamily: 'var(--font-mono)' }}>POST</span></td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>/api/v1/simulator/simulate</td>
                      <td>Inject a simulated shielded payment and trigger real webhooks.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Floating Toast Notification */}
      {actionMessage && (
        <div className={`toast-floating ${actionMessage.type}`}>
          {actionMessage.type === 'success' ? <CheckCircle2 size={18} color="var(--orange-primary)" /> : <AlertCircle size={18} />}
          <span>{actionMessage.text}</span>
        </div>
      )}
    </div>
  );
}
