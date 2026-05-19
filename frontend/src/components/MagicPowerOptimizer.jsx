import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { fetchMagicPower, fetchPlayerAccessories } from '../services/api';

const rarityOptions = ['ALL', 'COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC', 'SPECIAL', 'VERY_SPECIAL'];

const formatCoins = (num) => {
  const value = Number(num || 0);
  if (Math.abs(value) >= 1000000000) return `${(value / 1000000000).toFixed(2)}B`;
  if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(2)}M`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return Math.round(value).toLocaleString();
};

const parseExcludedIds = (raw) => raw
  .split(/[\s,]+/)
  .map((value) => value.trim().toUpperCase())
  .filter(Boolean);

export default function MagicPowerOptimizer() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rarity, setRarity] = useState('ALL');
  const [limit, setLimit] = useState(150);
  const [maxCoinsPerMp, setMaxCoinsPerMp] = useState(0);
  const [includeCraft, setIncludeCraft] = useState(true);
  const [includeSoulbound, setIncludeSoulbound] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [excludedText, setExcludedText] = useState(() => localStorage.getItem('skyblock_mp_excluded_ids') || '');
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('skyblock_mp_player') || '');
  const [profileName, setProfileName] = useState(() => localStorage.getItem('skyblock_mp_profile') || '');
  const [profileLoadState, setProfileLoadState] = useState({ loading: false, message: '', error: '' });
  const [expandedId, setExpandedId] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const excludedIds = useMemo(() => parseExcludedIds(excludedText), [excludedText]);

  useEffect(() => {
    localStorage.setItem('skyblock_mp_excluded_ids', excludedText);
  }, [excludedText]);

  useEffect(() => {
    localStorage.setItem('skyblock_mp_player', playerName);
  }, [playerName]);

  useEffect(() => {
    localStorage.setItem('skyblock_mp_profile', profileName);
  }, [profileName]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await fetchMagicPower({
          rarity,
          limit,
          maxCoinsPerMp,
          includeCraft,
          includeSoulbound,
          excludeIds: excludedIds.join(','),
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
  }, [rarity, limit, maxCoinsPerMp, includeCraft, includeSoulbound, excludedIds.join(','), refreshTick]);

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => (
      row.name.toLowerCase().includes(query)
      || row.id.toLowerCase().includes(query)
      || row.rarity.toLowerCase().includes(query)
    ));
  }, [rows, searchQuery]);

  const handleLoadProfile = async () => {
    const player = playerName.trim();
    if (!player) {
      setProfileLoadState({ loading: false, message: '', error: 'Enter a Minecraft username or UUID.' });
      return;
    }

    setProfileLoadState({ loading: true, message: 'Loading Hypixel accessories...', error: '' });
    try {
      const data = await fetchPlayerAccessories({
        player,
        profile: profileName.trim(),
      });
      const ids = data.accessoryIds || [];
      setExcludedText(ids.join('\n'));
      setRefreshTick((value) => value + 1);
      setProfileLoadState({
        loading: false,
        message: `Loaded ${ids.length.toLocaleString()} accessories from ${data.profileName || 'selected profile'}.`,
        error: '',
      });
    } catch (err) {
      setProfileLoadState({ loading: false, message: '', error: err.message });
    }
  };

  if (loading && rows.length === 0) {
    return <div className="loader-container"><div className="loader"></div><p>Finding cheapest magic power...</p></div>;
  }

  return (
    <div className="glass-card animate-fade-in">
      <div className="flex-between" style={{ marginBottom: '1rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2>Magic Power Optimizer</h2>
          <span className="text-muted text-sm">Ranks accessories by cheapest coins per magic power gained.</span>
        </div>
        <button
          className="btn"
          onClick={() => setRefreshTick((value) => value + 1)}
          style={{ padding: '0.5rem 0.9rem', background: 'var(--accent-primary)', color: '#000', fontWeight: 'bold', display: 'flex', gap: 8, alignItems: 'center' }}
        >
          <RefreshCw size={15} className={loading ? 'spin' : ''} />
          Refresh
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '1rem', background: 'var(--glass-bg)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--glass-border)', marginBottom: '1rem' }}>
        <label style={{ color: 'var(--text-muted)' }}>
          Rarity
          <select value={rarity} onChange={(event) => setRarity(event.target.value)} style={{ display: 'block', marginTop: 6, width: '100%', background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.55rem', borderRadius: 8 }}>
            {rarityOptions.map((option) => <option key={option} value={option}>{option.replace('_', ' ')}</option>)}
          </select>
        </label>
        <label style={{ color: 'var(--text-muted)' }}>
          Max Coins / MP
          <input type="number" value={maxCoinsPerMp} onChange={(event) => setMaxCoinsPerMp(Number(event.target.value) || 0)} style={{ display: 'block', marginTop: 6, width: '100%', background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.55rem', borderRadius: 8 }} />
        </label>
        <label style={{ color: 'var(--text-muted)' }}>
          Show
          <input type="number" min="10" max="500" value={limit} onChange={(event) => setLimit(Number(event.target.value) || 150)} style={{ display: 'block', marginTop: 6, width: '100%', background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.55rem', borderRadius: 8 }} />
        </label>
        <label style={{ color: 'var(--text-muted)' }}>
          Search
          <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Accessory name or id" style={{ display: 'block', marginTop: 6, width: '100%', background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.55rem', borderRadius: 8 }} />
        </label>
        <label style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={includeCraft} onChange={(event) => setIncludeCraft(event.target.checked)} />
          Include craft path
        </label>
        <label style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={includeSoulbound} onChange={(event) => setIncludeSoulbound(event.target.checked)} />
          Include soulbound
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(160px, 0.7fr) auto', gap: '0.75rem', alignItems: 'end', background: 'rgba(255,255,255,0.025)', border: '1px solid var(--glass-border)', borderRadius: 12, padding: '1rem', marginBottom: '1rem' }}>
        <label style={{ color: 'var(--text-muted)' }}>
          Minecraft Username / UUID
          <input value={playerName} onChange={(event) => setPlayerName(event.target.value)} placeholder="e.g. ThirtyVirus" style={{ display: 'block', marginTop: 6, width: '100%', background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.55rem', borderRadius: 8 }} />
        </label>
        <label style={{ color: 'var(--text-muted)' }}>
          Profile Name
          <input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Optional" style={{ display: 'block', marginTop: 6, width: '100%', background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.55rem', borderRadius: 8 }} />
        </label>
        <button
          className="btn"
          onClick={handleLoadProfile}
          disabled={profileLoadState.loading}
          style={{ padding: '0.65rem 1rem', background: 'var(--accent-primary)', color: '#000', fontWeight: 'bold', minWidth: 150 }}
        >
          {profileLoadState.loading ? 'Loading...' : 'Load Owned'}
        </button>
        {(profileLoadState.message || profileLoadState.error) && (
          <div style={{ gridColumn: '1 / -1', color: profileLoadState.error ? 'var(--text-danger)' : 'var(--accent-success)', fontSize: '0.85rem' }}>
            {profileLoadState.error || profileLoadState.message}
          </div>
        )}
      </div>

      <label style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '1rem' }}>
        Owned / Excluded Item IDs
        <textarea
          value={excludedText}
          onChange={(event) => setExcludedText(event.target.value)}
          placeholder="Paste item IDs separated by commas or new lines, e.g. WOLF_TALISMAN, DAY_CRYSTAL"
          rows={3}
          style={{ display: 'block', marginTop: 6, width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.65rem', borderRadius: 8, resize: 'vertical' }}
        />
      </label>

      {error && <div className="glass-card text-danger" style={{ marginBottom: '1rem' }}>Error fetching magic power data: {error}</div>}

      {meta && (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
          Showing {filteredRows.length.toLocaleString()} accessories from {meta.accessoriesScanned?.toLocaleString() || 0} scanned candidates. Excluding {excludedIds.length.toLocaleString()} owned IDs.
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Accessory</th>
              <th>Rarity</th>
              <th>Magic Power</th>
              <th>Best Cost</th>
              <th>Coins / MP</th>
              <th>Method</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr key={row.id} onClick={() => setExpandedId(expandedId === row.id ? null : row.id)} style={{ cursor: 'pointer' }}>
                <td>
                  <div style={{ fontWeight: 700 }}>{row.name}</div>
                  <div className="text-muted text-sm">{row.id}</div>
                  {expandedId === row.id && (
                    <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--glass-border)', display: 'grid', gap: '0.35rem' }}>
                      <div className="text-muted text-sm">Direct buy: {row.directCost ? `${formatCoins(row.directCost)} (${row.directSource})` : 'not priced'}</div>
                      <div className="text-muted text-sm">Craft cost: {row.craftCost ? formatCoins(row.craftCost) : 'not available'}</div>
                      {row.ingredients?.map((ingredient) => (
                        <div key={ingredient.id} className="flex-between" style={{ gap: '1rem', fontSize: '0.82rem' }}>
                          <span>{ingredient.qty}x {ingredient.name}</span>
                          <span className="text-muted">{ingredient.source} - {formatCoins(ingredient.totalCost)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </td>
                <td>{row.rarity.replace('_', ' ')}</td>
                <td style={{ fontWeight: 700 }}>{row.magicPower}</td>
                <td>{formatCoins(row.bestCost)}</td>
                <td style={{ color: 'var(--accent-success)', fontWeight: 700 }}>{formatCoins(row.coinsPerMagicPower)}</td>
                <td>
                  {row.bestMethod === 'craft' ? 'Craft' : 'Buy'}
                  {row.soulbound && <div className="text-warning text-sm">Soulbound</div>}
                </td>
              </tr>
            ))}
            {!loading && filteredRows.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }}>No accessories match the current filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
