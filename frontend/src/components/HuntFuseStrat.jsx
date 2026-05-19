import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { RefreshCw } from 'lucide-react';
import { API_URL } from '../services/api';

const formatCoins = (num) => {
  const value = Number(num || 0);
  if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(2)}M`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return Math.round(value).toLocaleString();
};

export default function HuntFuseStrat() {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [outMode, setOutMode] = useState('insta-sell');
  const [minProfit, setMinProfit] = useState(0);
  const [query, setQuery] = useState('');
  const [selectedHuntedIds, setSelectedHuntedIds] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ outMode, minProfit, limit: 150 });
        if (selectedHuntedIds.length > 0) params.set('huntedShardIds', selectedHuntedIds.join(','));
        const res = await axios.get(`${API_URL}/hunt-fuse?${params.toString()}`, { timeout: 15000 });
        if (active) setPayload(res.data);
      } catch (err) {
        if (active) setError(err.response?.data?.details || err.message);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [outMode, minProfit, selectedHuntedIds, refreshKey]);

  const guideOptions = payload?.guideOptions || [];
  const selectedHuntedSet = useMemo(() => new Set(selectedHuntedIds), [selectedHuntedIds]);

  const toggleHuntedShard = (shardId) => {
    setSelectedHuntedIds((current) => (
      current.includes(shardId)
        ? current.filter((id) => id !== shardId)
        : [...current, shardId]
    ));
  };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const source = payload?.rows || [];
    if (!q) return source;
    return source.filter((row) => (
      row.huntedShardName.toLowerCase().includes(q)
      || row.outputName.toLowerCase().includes(q)
      || row.guideLocation.toLowerCase().includes(q)
    ));
  }, [payload, query]);

  return (
    <div className="glass-card animate-fade-in">
      <div className="flex-between" style={{ marginBottom: '1rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2>Hunt + Fuse Strat</h2>
          <span className="text-muted text-sm">Ranks saved hunting-guide shards by the extra value they can create through shard fusion.</span>
        </div>
        <button className="btn" onClick={() => setRefreshKey((value) => value + 1)} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--accent-primary)', color: '#000', fontWeight: 800 }}>
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: 12, padding: '1rem', marginBottom: '1rem' }}>
        <label style={{ color: 'var(--text-muted)' }}>
          Sell Method
          <select value={outMode} onChange={(event) => setOutMode(event.target.value)} style={{ marginLeft: 8, background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.5rem', borderRadius: 8 }}>
            <option value="insta-sell">Insta-sell output</option>
            <option value="sell-order">Sell order output</option>
          </select>
        </label>
        <label style={{ color: 'var(--text-muted)' }}>
          Min Value / Hunted Shard
          <input type="number" value={minProfit} onChange={(event) => setMinProfit(Number(event.target.value) || 0)} style={{ marginLeft: 8, width: 120, background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.5rem', borderRadius: 8 }} />
        </label>
        <label style={{ color: 'var(--text-muted)' }}>
          Search
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Shard, output, location" style={{ marginLeft: 8, width: 190, background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.5rem', borderRadius: 8 }} />
        </label>
      </div>

      {guideOptions.length > 0 && (
        <div style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: 12, padding: '1rem', marginBottom: '1rem', display: 'grid', gap: '0.75rem' }}>
          <div className="flex-between" style={{ gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <div style={{ color: 'var(--text-primary)', fontWeight: 800 }}>Hunting Shards</div>
              <div className="text-muted text-sm">
                {selectedHuntedIds.length === 0
                  ? `Using all ${guideOptions.length} saved guide shard${guideOptions.length === 1 ? '' : 's'}.`
                  : `Using ${selectedHuntedIds.length} selected shard${selectedHuntedIds.length === 1 ? '' : 's'}.`}
              </div>
            </div>
            <button type="button" className="btn" onClick={() => setSelectedHuntedIds([])} style={{ padding: '0.45rem 0.75rem' }}>
              All Shards
            </button>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {guideOptions.map((guide) => {
              const selected = selectedHuntedSet.has(guide.shardId);
              return (
                <button
                  key={guide.shardId}
                  type="button"
                  className="btn"
                  onClick={() => toggleHuntedShard(guide.shardId)}
                  style={{
                    padding: '0.45rem 0.7rem',
                    borderColor: selected ? 'var(--accent-primary)' : 'var(--glass-border)',
                    background: selected ? 'rgba(88,101,242,0.24)' : 'rgba(255,255,255,0.03)',
                    color: selected ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}
                  title={guide.location || guide.shardId}
                >
                  {guide.shardName}
                  {guide.userShardsPerHour > 0 && <span className="text-muted text-sm"> {Number(guide.userShardsPerHour).toLocaleString()}/hr</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {error && <div className="text-danger" style={{ marginBottom: '1rem' }}>Failed to load Hunt+Fuse: {error}</div>}
      {loading && !payload && <div className="loader-container"><div className="loader"></div><p>Matching hunting guides to fusions...</p></div>}

      {payload && (
        <div className="text-muted text-sm" style={{ marginBottom: '0.75rem' }}>
          Found {rows.length.toLocaleString()} opportunities from {payload.guideCount} saved hunting guide shard{payload.guideCount === 1 ? '' : 's'}.
          {rows.some((row) => row.userShardsPerHour > 0) ? ' Rows with saved shard rates are sorted by profit per hour.' : ' Add shard rates in Hunting Guide to unlock profit per hour.'}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Hunt</th>
              <th>Fuse Into</th>
              <th>Recipe</th>
              <th>Buy Inputs</th>
              <th>Revenue</th>
              <th>Value / Hunted</th>
              <th>Profit / Hour</th>
              <th>Liquidity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.huntedShardId}-${row.outputId}-${index}`}>
                <td>
                  <div style={{ fontWeight: 800 }}>{row.huntedShardName}</div>
                  <div className="text-muted text-sm">{row.guideLocation || 'Saved guide'}</div>
                </td>
                <td>
                  <div style={{ fontWeight: 800 }}>{row.outputName}</div>
                  <div className="text-muted text-sm">{row.outputQty}x output</div>
                </td>
                <td style={{ minWidth: 260 }}>
                  {row.recipeInputs.map((input) => (
                    <span key={input.id} style={{ color: input.hunted ? 'var(--accent-warning)' : 'var(--text-secondary)', fontWeight: input.hunted ? 800 : 500 }}>
                      {input.qty}x {input.name}{' '}
                    </span>
                  ))}
                </td>
                <td>{formatCoins(row.paidInputCost)}</td>
                <td>{formatCoins(row.revenue)}</td>
                <td className={row.valuePerHuntedShard >= 0 ? 'text-success' : 'text-danger'} style={{ fontWeight: 800 }}>
                  {formatCoins(row.valuePerHuntedShard)}
                  <div className="text-muted text-sm">{formatCoins(row.profitPerCraft)} / craft</div>
                </td>
                <td className={row.profitPerHour >= 0 ? 'text-success' : 'text-danger'} style={{ fontWeight: 800 }}>
                  {row.userShardsPerHour > 0 ? formatCoins(row.profitPerHour) : <span className="text-muted">Add rate</span>}
                  {row.userShardsPerHour > 0 && <div className="text-muted text-sm">{Number(row.userShardsPerHour).toLocaleString()} shards/hr</div>}
                  {row.baseShardsPerHour > 0 && <div className="text-muted text-sm">Base: {formatCoins(row.baseProfitPerHour)}/hr</div>}
                </td>
                <td>
                  {Math.floor(row.volumePerHour)}/hr
                  <div className="text-muted text-sm">{row.safeSellable} safe sellable</div>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  No Hunt+Fuse matches yet. Add hunting guides for shards first, then this page can match them to fusion routes.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
