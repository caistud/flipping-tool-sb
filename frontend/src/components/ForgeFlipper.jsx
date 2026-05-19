import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { fetchForgeFlips } from '../services/api';

const formatCoins = (num) => {
  if (!Number.isFinite(Number(num))) return '0';
  const value = Number(num);
  if (Math.abs(value) >= 1000000000) return `${(value / 1000000000).toFixed(2)}B`;
  if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(2)}M`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return Math.round(value).toLocaleString();
};

const formatDuration = (seconds) => {
  const total = Number(seconds || 0);
  if (total < 60) return `${Math.round(total)}s`;
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  if (hours <= 0) return `${minutes}m`;
  if (minutes <= 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
};

export default function ForgeFlipper() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [outMode, setOutMode] = useState('sell-order');
  const [minProfit, setMinProfit] = useState(0);
  const [minRoi, setMinRoi] = useState(0);
  const [minCoinsPerHour, setMinCoinsPerHour] = useState(0);
  const [maxHours, setMaxHours] = useState(0);
  const [limit, setLimit] = useState(100);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await fetchForgeFlips({
          outMode,
          minProfit,
          minRoi,
          minCoinsPerHour,
          maxHours,
          limit,
          feeRate: 0.02,
          inMode: 'insta-buy',
        });
        if (!active) return;
        setRows(data.rows || []);
        setMeta(data);
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    };

    load();
    return () => { active = false; };
  }, [outMode, minProfit, minRoi, minCoinsPerHour, maxHours, limit, refreshTick]);

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => (
      row.name.toLowerCase().includes(query)
      || row.outputId.toLowerCase().includes(query)
      || row.ingredients.some((ingredient) => ingredient.name.toLowerCase().includes(query) || ingredient.id.toLowerCase().includes(query))
    ));
  }, [rows, searchQuery]);

  if (loading && rows.length === 0) {
    return <div className="loader-container"><div className="loader"></div><p>Pricing forge recipes...</p></div>;
  }

  return (
    <div className="glass-card animate-fade-in">
      <div className="flex-between" style={{ marginBottom: '1rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2>Forge Profit Flips</h2>
          <span className="text-muted text-sm">Ranks Forge recipes by direct ingredient cost, output value, and coins per forge-hour.</span>
        </div>
        <button
          className="btn"
          onClick={() => setRefreshTick((value) => value + 1)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.5rem 0.9rem', background: 'var(--accent-primary)', color: '#000', fontWeight: 'bold' }}
        >
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', background: 'var(--glass-bg)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--glass-border)', marginBottom: '1rem' }}>
        <label style={{ color: 'var(--text-muted)' }}>
          Sell Method
          <select value={outMode} onChange={(e) => setOutMode(e.target.value)} style={{ marginLeft: 8, background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.5rem', borderRadius: 8 }}>
            <option value="sell-order">Sell Order / LBIN</option>
            <option value="insta-sell">Insta-sell Bazaar</option>
          </select>
        </label>
        <label style={{ color: 'var(--text-muted)' }}>
          Min Profit
          <input type="number" value={minProfit} onChange={(e) => setMinProfit(Number(e.target.value) || 0)} style={{ marginLeft: 8, width: 110, background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.5rem', borderRadius: 8 }} />
        </label>
        <label style={{ color: 'var(--text-muted)' }}>
          Min ROI %
          <input type="number" value={minRoi} onChange={(e) => setMinRoi(Number(e.target.value) || 0)} style={{ marginLeft: 8, width: 90, background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.5rem', borderRadius: 8 }} />
        </label>
        <label style={{ color: 'var(--text-muted)' }}>
          Min / Hour
          <input type="number" value={minCoinsPerHour} onChange={(e) => setMinCoinsPerHour(Number(e.target.value) || 0)} style={{ marginLeft: 8, width: 120, background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.5rem', borderRadius: 8 }} />
        </label>
        <label style={{ color: 'var(--text-muted)' }}>
          Max Hours
          <input type="number" min="0" value={maxHours} onChange={(e) => setMaxHours(Number(e.target.value) || 0)} style={{ marginLeft: 8, width: 90, background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.5rem', borderRadius: 8 }} />
        </label>
        <label style={{ color: 'var(--text-muted)' }}>
          Show
          <input type="number" min="10" max="300" value={limit} onChange={(e) => setLimit(Number(e.target.value) || 100)} style={{ marginLeft: 8, width: 80, background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.5rem', borderRadius: 8 }} />
        </label>
        <label style={{ color: 'var(--text-muted)' }}>
          Search
          <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Output or ingredient" style={{ marginLeft: 8, width: 190, background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.5rem', borderRadius: 8 }} />
        </label>
      </div>

      {error && <div className="glass-card text-danger" style={{ marginBottom: '1rem' }}>Error fetching forge flips: {error}</div>}

      {meta && (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
          Showing {filteredRows.length.toLocaleString()} forge flips from {meta.recipesScanned?.toLocaleString() || 0} forge recipes. Prices include a 2% sell buffer.
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Forge</th>
              <th>Time</th>
              <th>Craft Cost</th>
              <th>Sell Value</th>
              <th>Profit</th>
              <th>Coins / Hour</th>
              <th>ROI</th>
              <th>Inputs</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr key={row.id} onClick={() => setExpandedId(expandedId === row.id ? null : row.id)} style={{ cursor: 'pointer' }}>
                <td>
                  <div style={{ fontWeight: 800 }}>{row.name}</div>
                  <div className="text-muted text-sm">{row.outputId}{row.requirement ? ` - ${row.requirement}` : ''}</div>
                </td>
                <td>{formatDuration(row.durationSeconds)}</td>
                <td>{formatCoins(row.craftCost)}</td>
                <td>
                  {formatCoins(row.grossRevenue)}
                  <div className="text-muted text-sm">{row.outputPriceSource}</div>
                </td>
                <td className={row.profit >= 0 ? 'text-success' : 'text-danger'} style={{ fontWeight: 800 }}>{row.profit >= 0 ? '+' : ''}{formatCoins(row.profit)}</td>
                <td className={row.coinsPerHour >= 0 ? 'text-success' : 'text-danger'} style={{ fontWeight: 800 }}>{formatCoins(row.coinsPerHour)}</td>
                <td style={{ color: row.roi >= 10 ? 'var(--accent-success)' : 'var(--accent-warning)', fontWeight: 700 }}>{row.roi.toFixed(1)}%</td>
                <td style={{ maxWidth: 380 }}>
                  {row.ingredients.slice(0, 3).map((ingredient) => `${ingredient.qty}x ${ingredient.name}`).join(' + ')}
                  {row.ingredients.length > 3 ? ` + ${row.ingredients.length - 3} more` : ''}
                  {expandedId === row.id && (
                    <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--glass-border)', display: 'grid', gap: '0.35rem' }}>
                      {row.ingredients.map((ingredient) => (
                        <div key={ingredient.id} className="flex-between" style={{ gap: '1rem', fontSize: '0.82rem' }}>
                          <span>{ingredient.qty.toLocaleString()}x {ingredient.name}</span>
                          <span className="text-muted">{ingredient.source} - {formatCoins(ingredient.totalCost)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {!loading && filteredRows.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No forge flips match the filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
