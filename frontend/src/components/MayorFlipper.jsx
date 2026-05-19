import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { RefreshCw, TrendingUp, Crown, Search, ExternalLink } from 'lucide-react';
import { API_URL } from '../services/api';

const formatCoins = (num) => {
  const value = Number(num || 0);
  if (value >= 1000000000) return `${(value / 1000000000).toFixed(2)}B`;
  if (value >= 1000000) return `${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return value.toFixed(1);
};

const formatNumber = (num) => {
  const value = Number(num || 0);
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return Math.round(value).toLocaleString();
};

const formatDateTime = (timestamp) => {
  if (!timestamp) return 'Now';
  return new Date(timestamp).toLocaleString();
};

const formatShortDate = (timestamp) => {
  if (!timestamp) return '--';
  return new Date(timestamp).toLocaleDateString();
};

export default function MayorFlipper() {
  const [selectedMayor, setSelectedMayor] = useState('all');
  const [sortBy, setSortBy] = useState('movement');
  const [minMovement, setMinMovement] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    const loadMayorFlips = async () => {
      try {
        setLoading(true);
        setError('');
        const params = new URLSearchParams({
          mayor: selectedMayor,
          sortBy,
          minMovement: String(minMovement || 0),
        });
        const res = await axios.get(`${API_URL}/mayor-flips?${params.toString()}`, { timeout: 30000 });
        if (active) setPayload(res.data);
      } catch (err) {
        if (active) setError(err.response?.data?.details || err.message || 'Failed to load mayor flips');
      } finally {
        if (active) setLoading(false);
      }
    };

    loadMayorFlips();
    const interval = setInterval(loadMayorFlips, 30000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [selectedMayor, sortBy, minMovement, refreshKey]);

  const rows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return (payload?.rows || []).filter((row) => {
      if (!query) return true;
      return row.name.toLowerCase().includes(query)
        || row.id.toLowerCase().includes(query)
        || row.mayor.toLowerCase().includes(query);
    });
  }, [payload, searchQuery]);

  const selectedMayorInfo = payload?.mayors?.find((entry) => entry.mayor.toLowerCase() === selectedMayor);
  const totalMovement = rows.reduce((sum, row) => sum + (row.movementPerHour || 0), 0);
  const bestScore = rows[0]?.watchScore || 0;
  const baselineReadyCount = rows.filter((row) => row.normalPrice).length;

  if (loading && !payload) {
    return (
      <div className="loader-container">
        <div className="loader"></div>
        <p>Loading mayor market watchlist...</p>
      </div>
    );
  }

  if (error && !payload) {
    return <div className="glass-card text-danger">Error fetching mayor flips: {error}</div>;
  }

  return (
    <div className="glass-card animate-fade-in">
      <div className="flex-between" style={{ gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ marginBottom: '0.35rem' }}>Mayor Flipping</h2>
          <div className="text-muted text-sm">
            Track bazaar items that usually move when specific mayors are elected.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', color: 'var(--accent-warning)', fontWeight: 700 }}>
            <Crown size={18} />
            Current: {payload?.currentMayor || 'Unknown'}
          </div>
          <button
            className="btn"
            onClick={() => setRefreshKey((value) => value + 1)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', background: 'var(--accent-primary)', color: '#fff', padding: '0.55rem 0.85rem', fontWeight: 700 }}
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
        {[
          { label: 'Tracked Items', value: rows.length.toLocaleString(), color: 'var(--text-primary)' },
          { label: 'Movement / Hour', value: formatNumber(totalMovement), color: 'var(--accent-secondary)' },
          { label: 'Top Watch Score', value: bestScore.toLocaleString(), color: 'var(--accent-success)' },
          { label: 'Normal Baselines', value: `${baselineReadyCount}/${rows.length}`, color: 'var(--accent-warning)' },
        ].map((stat) => (
          <div key={stat.label} style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid var(--glass-border)', borderRadius: 8, padding: '0.85rem' }}>
            <div className="text-muted" style={{ fontSize: '0.75rem', marginBottom: '0.35rem' }}>{stat.label}</div>
            <div style={{ color: stat.color, fontSize: '1.25rem', fontWeight: 800, fontFamily: 'var(--font-heading)' }}>{stat.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1rem', background: 'var(--glass-bg)', padding: '1rem', borderRadius: 8, border: '1px solid var(--glass-border)', flexWrap: 'wrap' }}>
        <div>
          <label style={{ marginRight: '0.5rem', color: 'var(--text-muted)' }}>Mayor:</label>
          <select
            value={selectedMayor}
            onChange={(e) => setSelectedMayor(e.target.value)}
            style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.5rem', borderRadius: 8, outline: 'none', cursor: 'pointer' }}
          >
            <option value="all">All Mayors</option>
            {(payload?.mayors || []).map((entry) => (
              <option key={entry.mayor} value={entry.mayor.toLowerCase()}>{entry.mayor} - {entry.theme}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ marginRight: '0.5rem', color: 'var(--text-muted)' }}>Sort By:</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.5rem', borderRadius: 8, outline: 'none', cursor: 'pointer' }}
          >
            <option value="movement">Most Movement</option>
            <option value="score">Watch Score</option>
            <option value="margin">Highest Spread %</option>
            <option value="spread">Highest Coin Spread</option>
            <option value="buyPrice">Highest Price</option>
          </select>
        </div>

        <div>
          <label style={{ marginRight: '0.5rem', color: 'var(--text-muted)' }}>Min Move / Hour:</label>
          <input
            type="number"
            min="0"
            value={minMovement}
            onChange={(e) => setMinMovement(e.target.value === '' ? '' : Number(e.target.value))}
            style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.5rem', borderRadius: 8, width: 105, outline: 'none' }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginLeft: 'auto' }}>
          <Search size={16} color="var(--text-muted)" />
          <input
            type="text"
            placeholder="Search item or mayor..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.5rem', borderRadius: 8, width: 190, outline: 'none' }}
          />
        </div>
      </div>

      {selectedMayorInfo && (
        <div style={{ border: '1px solid rgba(59, 130, 246, 0.3)', background: 'rgba(59, 130, 246, 0.08)', padding: '0.85rem 1rem', borderRadius: 8, marginBottom: '1rem', color: 'var(--text-secondary)' }}>
          <strong style={{ color: 'var(--text-primary)' }}>{selectedMayorInfo.mayor}:</strong> {selectedMayorInfo.strategy}
        </div>
      )}

      <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '0.75rem' }}>
        Normal price uses a {payload?.baselineDays || 30}-day median from saved snapshots, excluding snapshots taken while that item's mayor is active when enough samples exist.
        Snapshots save every {payload?.snapshotIntervalMinutes || 30} minutes.
      </div>

      {(payload?.recentMayorPrices || []).length > 0 && (
        <div style={{ marginBottom: '1rem', border: '1px solid var(--glass-border)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.04)', color: 'var(--text-primary)', fontWeight: 800 }}>
            Recent Mayor Price Samples
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            {payload.recentMayorPrices.map((entry) => (
              <div key={`${entry.mayor}-${entry.electionYear}-${entry.startedAt}`} style={{ padding: '0.85rem 1rem', borderTop: '1px solid var(--glass-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <strong style={{ color: entry.mayor === payload.currentMayor ? 'var(--accent-warning)' : 'var(--text-primary)' }}>
                    {entry.mayor}
                  </strong>
                  <span className="text-muted" style={{ fontSize: '0.75rem' }}>Year {entry.electionYear || '?'}</span>
                </div>
                <div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: '0.5rem' }}>
                  {formatDateTime(entry.startedAt)} - {formatDateTime(entry.endedAt)}
                </div>
                {entry.items.slice(0, 3).map((item) => (
                  <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.8rem', marginTop: '0.3rem' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>{item.name}</span>
                    <span style={{ color: 'var(--accent-secondary)', fontFamily: 'monospace' }}>
                      {formatCoins(item.medianInstabuy)}
                    </span>
                  </div>
                ))}
                {entry.items.length === 0 && (
                  <div className="text-muted" style={{ fontSize: '0.8rem' }}>Collecting price samples...</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div style={{ color: 'var(--accent-warning)', marginBottom: '1rem', fontSize: '0.9rem' }}>
          Last refresh failed: {error}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Mayor</th>
              <th>Instabuy</th>
              <th>Max Buy</th>
              <th>At Source</th>
              <th>Normal</th>
              <th>Vs Normal</th>
              <th>Instasell</th>
              <th>Spread</th>
              <th>Move / Hour</th>
              <th>Score</th>
              <th>Why It Moves</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.mayor}-${row.id}`}>
                <td className="item-name">
                  <span>{row.name}</span>
                  <a
                    href={`https://sky.coflnet.com/item/${row.id}`}
                    target="_blank"
                    rel="noreferrer"
                    title="View on Coflnet"
                    style={{ color: 'var(--accent-primary)', display: 'inline-flex', alignItems: 'center' }}
                  >
                    <ExternalLink size={14} />
                  </a>
                </td>
                <td>
                  <span style={{ color: row.isCurrentMayor ? 'var(--accent-warning)' : 'var(--text-secondary)', fontWeight: row.isCurrentMayor ? 800 : 600 }}>
                    {row.mayor}
                  </span>
                </td>
                <td>
                  {formatCoins(row.buyPrice)}
                  {row.maxBuy && (
                    <div className={row.isBelowTarget ? 'text-success' : 'text-danger'} style={{ fontSize: '0.72rem', fontWeight: 700 }}>
                      {row.isBelowTarget ? 'under target' : 'above target'}
                    </div>
                  )}
                </td>
                <td>{row.maxBuy ? formatCoins(row.maxBuy) : <span className="text-muted">--</span>}</td>
                <td title={row.sourceSnapshotAt ? `Snapshot: ${formatDateTime(row.sourceSnapshotAt)}` : row.sourcePriceError || undefined}>
                  {row.sourceBuyPrice ? (
                    <div>
                      <div>{formatCoins(row.sourceBuyPrice)}</div>
                      <div className={row.sourceBuyDelta >= 0 ? 'text-success' : 'text-danger'} style={{ fontSize: '0.72rem', fontWeight: 700 }}>
                        {row.sourceBuyDelta >= 0 ? '+' : ''}{formatCoins(row.sourceBuyDelta)} ({row.sourceBuyDeltaPercent >= 0 ? '+' : ''}{row.sourceBuyDeltaPercent.toFixed(1)}%)
                      </div>
                      <div className="text-muted" style={{ fontSize: '0.68rem' }}>{formatShortDate(row.sourceSnapshotAt || row.sourceDate)}</div>
                    </div>
                  ) : (
                    <span className="text-muted">{row.marketType === 'auction' && row.sourceDate ? 'AH item' : row.sourceDate ? 'Loading' : '--'}</span>
                  )}
                </td>
                <td title={`${row.baselineSampleCount || 0} samples · ${row.baselineType || 'collecting'}`}>
                  {row.normalPrice ? formatCoins(row.normalPrice) : 'Collecting'}
                </td>
                <td>
                  {row.priceDeltaPercent === null || row.priceDeltaPercent === undefined ? (
                    <span className="text-muted">--</span>
                  ) : (
                    <span className={row.priceDelta >= 0 ? 'text-success' : 'text-danger'}>
                      {row.priceDelta >= 0 ? '+' : ''}{formatCoins(row.priceDelta)} ({row.priceDeltaPercent >= 0 ? '+' : ''}{row.priceDeltaPercent.toFixed(1)}%)
                    </span>
                  )}
                </td>
                <td>{formatCoins(row.sellPrice)}</td>
                <td>
                  <span className={row.spread > 0 ? 'text-success' : 'text-danger'}>
                    {formatCoins(row.spread)} ({Number(row.margin || 0).toFixed(1)}%)
                  </span>
                </td>
                <td style={{ color: 'var(--accent-secondary)', fontWeight: 700 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                    <TrendingUp size={15} />
                    {formatNumber(row.movementPerHour)}
                  </span>
                </td>
                <td>
                  <span style={{ color: row.watchScore >= 70 ? 'var(--accent-success)' : 'var(--text-secondary)', fontWeight: 800 }}>
                    {row.watchScore}
                  </span>
                </td>
                <td style={{ color: 'var(--text-secondary)', minWidth: 280 }}>
                  <div>{row.reason}</div>
                  {row.currentPriceSource && <div className="text-muted text-sm" style={{ marginTop: 4 }}>Current price source: {row.currentPriceSource}</div>}
                  {row.targetReturnPrice && <div className="text-muted text-sm" style={{ marginTop: 4 }}>Target rebound: {formatCoins(row.targetReturnPrice)}</div>}
                  {row.holdTime && <div className="text-muted text-sm" style={{ marginTop: 4 }}>Hold: {row.holdTime}</div>}
                  {row.risk && <div className="text-muted text-sm" style={{ marginTop: 4 }}>Risk: {row.risk}</div>}
                  {row.expectedReturn && <div className="text-muted text-sm" style={{ marginTop: 4 }}>{row.expectedReturn}</div>}
                  {row.sourceNote && <div className="text-muted text-sm" style={{ marginTop: 4 }}>Source: {row.sourceNote}</div>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan="12" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  No mayor-flip items match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
