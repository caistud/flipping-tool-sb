import { useEffect, useMemo, useState } from 'react';
import { fetchAccessoryFlips } from '../services/api';

const formatCoins = (num) => {
  if (!Number.isFinite(Number(num))) return '0';
  const value = Number(num);
  if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(2)}M`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return Math.round(value).toLocaleString();
};

const rarityOptions = ['ALL', 'COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC', 'SPECIAL', 'VERY_SPECIAL'];

export default function AccessoryFlipper() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [minProfit, setMinProfit] = useState(0);
  const [minRoi, setMinRoi] = useState(0);
  const [limit, setLimit] = useState(100);
  const [rarity, setRarity] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await fetchAccessoryFlips({
          minProfit,
          minRoi,
          limit,
          rarity,
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
  }, [minProfit, minRoi, limit, rarity, refreshTick]);

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => (
      row.name.toLowerCase().includes(query)
      || row.id.toLowerCase().includes(query)
      || row.ingredients.some((ingredient) => ingredient.name.toLowerCase().includes(query) || ingredient.id.toLowerCase().includes(query))
    ));
  }, [rows, searchQuery]);

  if (loading && rows.length === 0) {
    return <div className="loader-container"><div className="loader"></div><p>Pricing crafted accessories...</p></div>;
  }

  return (
    <div className="glass-card animate-fade-in">
      <div className="flex-between" style={{ marginBottom: '1rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2>Accessory Craft Flips</h2>
          <span className="text-muted text-sm">Craft cost from recipe ingredients compared with live lowest BIN.</span>
        </div>
        <button
          className="btn"
          onClick={() => setRefreshTick((value) => value + 1)}
          style={{ padding: '0.5rem 0.9rem', background: 'var(--accent-primary)', color: '#000', fontWeight: 'bold' }}
        >
          Refresh
        </button>
      </div>

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', background: 'var(--glass-bg)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--glass-border)', marginBottom: '1rem' }}>
        <label style={{ color: 'var(--text-muted)' }}>
          Min Profit
          <input type="number" value={minProfit} onChange={(e) => setMinProfit(Number(e.target.value) || 0)} style={{ marginLeft: 8, width: 110, background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.5rem', borderRadius: 8 }} />
        </label>
        <label style={{ color: 'var(--text-muted)' }}>
          Min ROI %
          <input type="number" value={minRoi} onChange={(e) => setMinRoi(Number(e.target.value) || 0)} style={{ marginLeft: 8, width: 90, background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.5rem', borderRadius: 8 }} />
        </label>
        <label style={{ color: 'var(--text-muted)' }}>
          Rarity
          <select value={rarity} onChange={(e) => setRarity(e.target.value)} style={{ marginLeft: 8, background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.5rem', borderRadius: 8 }}>
            {rarityOptions.map((option) => <option key={option} value={option}>{option.replace('_', ' ')}</option>)}
          </select>
        </label>
        <label style={{ color: 'var(--text-muted)' }}>
          Show
          <input type="number" min="10" max="300" value={limit} onChange={(e) => setLimit(Number(e.target.value) || 100)} style={{ marginLeft: 8, width: 80, background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.5rem', borderRadius: 8 }} />
        </label>
        <label style={{ color: 'var(--text-muted)' }}>
          Search
          <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Accessory or ingredient" style={{ marginLeft: 8, width: 190, background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.5rem', borderRadius: 8 }} />
        </label>
      </div>

      {error && <div className="glass-card text-danger" style={{ marginBottom: '1rem' }}>Error fetching accessory flips: {error}</div>}

      {meta && (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
          Showing {filteredRows.length.toLocaleString()} crafted accessories from {meta.recipesScanned?.toLocaleString() || 0} recipe candidates. Prices include a 2% sell buffer.
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Accessory</th>
              <th>Craft Cost</th>
              <th>Lowest BIN</th>
              <th>Profit</th>
              <th>ROI</th>
              <th>Ingredients</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr key={row.id} onClick={() => setExpandedId(expandedId === row.id ? null : row.id)} style={{ cursor: 'pointer' }}>
                <td>
                  <div style={{ fontWeight: 700 }}>{row.name}</div>
                  <div className="text-muted text-sm">{row.id}</div>
                </td>
                <td>{formatCoins(row.craftCost)}</td>
                <td>
                  {formatCoins(row.outputPrice)}
                  <div className="text-muted text-sm">{row.outputPriceSource}</div>
                </td>
                <td className={row.profit >= 0 ? 'text-success' : 'text-danger'}>+{formatCoins(row.profit)}</td>
                <td style={{ color: row.roi >= 10 ? 'var(--accent-success)' : 'var(--accent-warning)', fontWeight: 700 }}>{row.roi.toFixed(1)}%</td>
                <td style={{ maxWidth: 360 }}>
                  {row.ingredients.slice(0, 3).map((ingredient) => `${ingredient.qty}x ${ingredient.name}`).join(' + ')}
                  {row.ingredients.length > 3 ? ` + ${row.ingredients.length - 3} more` : ''}
                  {expandedId === row.id && (
                    <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--glass-border)', display: 'grid', gap: '0.35rem' }}>
                      {row.ingredients.map((ingredient) => (
                        <div key={ingredient.id} className="flex-between" style={{ gap: '1rem', fontSize: '0.82rem' }}>
                          <span>{ingredient.qty}x {ingredient.name}</span>
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
                <td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }}>No crafted accessory flips match the filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
