import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { fetchMagicPower, fetchPlayerAccessories } from '../services/api';

const rarityOptions = ['ALL', 'COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC', 'SPECIAL', 'VERY_SPECIAL'];
const acquisitionOptions = [
  { value: 'all', label: 'All Priced' },
  { value: 'best-craft', label: 'Best Route: Craft' },
  { value: 'best-auction', label: 'Best Route: Auction' },
  { value: 'recomb', label: 'Recomb Upgrades' },
  { value: 'craftable', label: 'Craftable' },
  { value: 'auction', label: 'Auction House' },
  { value: 'obtainable', label: 'Direct Obtainable' },
];

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

const matchesAcquisitionFilter = (row, filter) => {
  const hasCraft = Number(row.craftCost || 0) > 0;
  const hasDirect = Number(row.directCost || 0) > 0;
  switch (filter) {
    case 'best-craft':
      return row.bestMethod === 'craft';
    case 'best-auction':
      return row.bestMethod === 'buy';
    case 'recomb':
      return row.bestMethod === 'recomb';
    case 'craftable':
      return hasCraft;
    case 'auction':
      return hasDirect;
    case 'obtainable':
      return hasDirect && !hasCraft;
    default:
      return true;
  }
};

const betterBudgetPlan = (candidate, current) => {
  if (!current) return candidate;
  if (candidate.totalMagicPower !== current.totalMagicPower) return candidate.totalMagicPower > current.totalMagicPower ? candidate : current;
  if (candidate.totalCost !== current.totalCost) return candidate.totalCost < current.totalCost ? candidate : current;
  return candidate.rows.length < current.rows.length ? candidate : current;
};

const betterTargetPlan = (candidate, current, targetMp) => {
  if (!current) return candidate;
  const candidateComplete = candidate.totalMagicPower >= targetMp;
  const currentComplete = current.totalMagicPower >= targetMp;
  if (candidateComplete !== currentComplete) return candidateComplete ? candidate : current;
  if (candidateComplete && candidate.totalCost !== current.totalCost) return candidate.totalCost < current.totalCost ? candidate : current;
  if (!candidateComplete && candidate.totalMagicPower !== current.totalMagicPower) return candidate.totalMagicPower > current.totalMagicPower ? candidate : current;
  if (candidate.totalCost !== current.totalCost) return candidate.totalCost < current.totalCost ? candidate : current;
  return candidate.rows.length < current.rows.length ? candidate : current;
};

const optimizeForBudget = (candidates, budget) => {
  const states = new Map([[0, { rows: [], totalCost: 0, totalMagicPower: 0 }]]);
  let best = states.get(0);

  for (const row of candidates) {
    const cost = Math.ceil(Number(row.bestCost) || 0);
    const mp = Number(row.magicPower) || 0;
    if (cost <= 0 || mp <= 0 || cost > budget) continue;

    const snapshot = Array.from(states.values());
    for (const state of snapshot) {
      const nextCost = state.totalCost + cost;
      if (nextCost > budget) continue;
      const next = {
        rows: [...state.rows, row],
        totalCost: nextCost,
        totalMagicPower: state.totalMagicPower + mp,
      };
      const currentAtCost = states.get(nextCost);
      states.set(nextCost, betterBudgetPlan(next, currentAtCost));
      best = betterBudgetPlan(next, best);
    }
  }

  return best || { rows: [], totalCost: 0, totalMagicPower: 0 };
};

const optimizeForTarget = (candidates, targetMp) => {
  const maxMp = targetMp + Math.max(0, ...candidates.map((row) => Number(row.magicPower) || 0));
  const states = new Map([[0, { rows: [], totalCost: 0, totalMagicPower: 0 }]]);
  let best = null;

  for (const row of candidates) {
    const cost = Math.ceil(Number(row.bestCost) || 0);
    const mp = Number(row.magicPower) || 0;
    if (cost <= 0 || mp <= 0) continue;

    const snapshot = Array.from(states.values());
    for (const state of snapshot) {
      const nextMp = Math.min(maxMp, state.totalMagicPower + mp);
      const next = {
        rows: [...state.rows, row],
        totalCost: state.totalCost + cost,
        totalMagicPower: state.totalMagicPower + mp,
      };
      const currentAtMp = states.get(nextMp);
      states.set(nextMp, betterTargetPlan(next, currentAtMp, targetMp));
      best = betterTargetPlan(next, best, targetMp);
    }
  }

  return best || { rows: [], totalCost: 0, totalMagicPower: 0 };
};

export default function MagicPowerOptimizer() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rarity, setRarity] = useState('ALL');
  const [limit, setLimit] = useState(150);
  const [maxCoinsPerMp, setMaxCoinsPerMp] = useState(0);
  const [includeCraft, setIncludeCraft] = useState(true);
  const [includeRecomb, setIncludeRecomb] = useState(true);
  const [includeSoulbound, setIncludeSoulbound] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [acquisitionFilter, setAcquisitionFilter] = useState('all');
  const [planMode, setPlanMode] = useState('budget');
  const [budgetInput, setBudgetInput] = useState('');
  const [targetMpInput, setTargetMpInput] = useState('');
  const [excludedText, setExcludedText] = useState(() => localStorage.getItem('skyblock_mp_excluded_ids') || '');
  const [recombobulatedText, setRecombobulatedText] = useState(() => localStorage.getItem('skyblock_mp_recombobulated_ids') || '');
  const [skycryptMissingIds, setSkycryptMissingIds] = useState(() => (
    localStorage.getItem('skyblock_mp_skycrypt_missing_ids') || ''
  ));
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('skyblock_mp_player') || '');
  const [profileName, setProfileName] = useState(() => localStorage.getItem('skyblock_mp_profile') || '');
  const [profileLoadState, setProfileLoadState] = useState({ loading: false, message: '', error: '' });
  const [expandedId, setExpandedId] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const excludedIds = useMemo(() => parseExcludedIds(excludedText), [excludedText]);
  const recombobulatedIds = useMemo(() => parseExcludedIds(recombobulatedText), [recombobulatedText]);
  const missingIds = useMemo(() => parseExcludedIds(skycryptMissingIds), [skycryptMissingIds]);

  useEffect(() => {
    localStorage.setItem('skyblock_mp_excluded_ids', excludedText);
  }, [excludedText]);

  useEffect(() => {
    localStorage.setItem('skyblock_mp_recombobulated_ids', recombobulatedText);
  }, [recombobulatedText]);

  useEffect(() => {
    localStorage.setItem('skyblock_mp_skycrypt_missing_ids', skycryptMissingIds);
  }, [skycryptMissingIds]);

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
          includeRecomb,
          includeSoulbound,
          excludeIds: excludedIds.join(','),
          recombobulatedIds: recombobulatedIds.join(','),
          includeIds: missingIds.join(','),
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
  }, [rarity, limit, maxCoinsPerMp, includeCraft, includeRecomb, includeSoulbound, excludedIds.join(','), recombobulatedIds.join(','), missingIds.join(','), refreshTick]);

  const acquisitionRows = useMemo(() => (
    rows.filter((row) => matchesAcquisitionFilter(row, acquisitionFilter))
  ), [rows, acquisitionFilter]);

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return acquisitionRows;
    return acquisitionRows.filter((row) => (
      row.name.toLowerCase().includes(query)
      || row.id.toLowerCase().includes(query)
      || row.rarity.toLowerCase().includes(query)
    ));
  }, [acquisitionRows, searchQuery]);

  const parseCoinInput = (raw) => {
    const value = String(raw || '').trim().toLowerCase().replace(/,/g, '');
    if (!value) return 0;
    if (value.endsWith('b')) return Number(value.slice(0, -1)) * 1_000_000_000;
    if (value.endsWith('m')) return Number(value.slice(0, -1)) * 1_000_000;
    if (value.endsWith('k')) return Number(value.slice(0, -1)) * 1_000;
    return Number(value) || 0;
  };

  const purchasePlan = useMemo(() => {
    const candidates = acquisitionRows
      .filter((row) => Number(row.bestCost) > 0 && Number(row.magicPower) > 0)
      .sort((a, b) => a.coinsPerMagicPower - b.coinsPerMagicPower || a.bestCost - b.bestCost);

    const budget = parseCoinInput(budgetInput);
    const targetMp = Number(targetMpInput) || 0;

    if (planMode === 'budget') {
      if (budget <= 0) return { rows: [], totalCost: 0, totalMagicPower: 0, remainingBudget: 0, complete: false };
      const best = optimizeForBudget(candidates, Math.floor(budget));
      return {
        rows: best.rows.sort((a, b) => a.coinsPerMagicPower - b.coinsPerMagicPower || a.bestCost - b.bestCost),
        totalCost: best.totalCost,
        totalMagicPower: best.totalMagicPower,
        remainingBudget: Math.max(0, budget - best.totalCost),
        complete: best.rows.length > 0,
      };
    }

    if (targetMp <= 0) return { rows: [], totalCost: 0, totalMagicPower: 0, remainingBudget: 0, complete: false };
    const best = optimizeForTarget(candidates, Math.ceil(targetMp));
    return {
      rows: best.rows.sort((a, b) => a.coinsPerMagicPower - b.coinsPerMagicPower || a.bestCost - b.bestCost),
      totalCost: best.totalCost,
      totalMagicPower: best.totalMagicPower,
      remainingBudget: 0,
      complete: best.totalMagicPower >= targetMp,
    };
  }, [acquisitionRows, budgetInput, targetMpInput, planMode]);

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
      const recombedIds = data.recombobulatedAccessoryIds || [];
      const skycryptIds = data.skycryptMissingIds || [];
      setExcludedText(ids.join('\n'));
      setRecombobulatedText(recombedIds.join('\n'));
      setSkycryptMissingIds(skycryptIds.join('\n'));
      setRefreshTick((value) => value + 1);
      setProfileLoadState({
        loading: false,
        message: `Loaded ${ids.length.toLocaleString()} owned accessories, ${recombedIds.length.toLocaleString()} recombobulated, and ${skycryptIds.length.toLocaleString()} SkyCrypt missing accessories from ${data.profileName || 'selected profile'}.`,
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
        <label style={{ color: 'var(--text-muted)' }}>
          Get Method
          <select value={acquisitionFilter} onChange={(event) => setAcquisitionFilter(event.target.value)} style={{ display: 'block', marginTop: 6, width: '100%', background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.55rem', borderRadius: 8 }}>
            {acquisitionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={includeCraft} onChange={(event) => setIncludeCraft(event.target.checked)} />
          Include craft path
        </label>
        <label style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={includeRecomb} onChange={(event) => setIncludeRecomb(event.target.checked)} />
          Include recombs
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
        {missingIds.length > 0 && (
          <div className="text-muted text-sm" style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
            <span>SkyCrypt missing filter active: {missingIds.length.toLocaleString()} accessories.</span>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setSkycryptMissingIds('');
                setRefreshTick((value) => value + 1);
              }}
              style={{ padding: '0.35rem 0.65rem' }}
            >
              Show all missing by owned IDs
            </button>
          </div>
        )}
        {recombobulatedIds.length > 0 && (
          <div className="text-muted text-sm" style={{ gridColumn: '1 / -1' }}>
            Already recombobulated filter active: {recombobulatedIds.length.toLocaleString()} owned accessories.
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

      <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid var(--glass-border)', borderRadius: 12, padding: '1rem', marginBottom: '1rem' }}>
        <div className="flex-between" style={{ gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
          <div>
            <h3 style={{ margin: 0 }}>Purchase Plan</h3>
            <div className="text-muted text-sm">Uses the current missing-accessory list and solves for the best budget or target-MP plan.</div>
          </div>
          <select value={planMode} onChange={(event) => setPlanMode(event.target.value)} style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.55rem', borderRadius: 8 }}>
            <option value="budget">Maximize Budget</option>
            <option value="target">Reach Target MP</option>
          </select>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'end', marginBottom: purchasePlan.rows.length > 0 ? '1rem' : 0 }}>
          {planMode === 'budget' ? (
            <label style={{ color: 'var(--text-muted)' }}>
              Budget
              <input value={budgetInput} onChange={(event) => setBudgetInput(event.target.value)} placeholder="e.g. 50M" style={{ display: 'block', marginTop: 6, width: 180, background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.55rem', borderRadius: 8 }} />
            </label>
          ) : (
            <label style={{ color: 'var(--text-muted)' }}>
              Target MP Gain
              <input type="number" value={targetMpInput} onChange={(event) => setTargetMpInput(event.target.value)} placeholder="e.g. 100" style={{ display: 'block', marginTop: 6, width: 180, background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.55rem', borderRadius: 8 }} />
            </label>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(120px, 1fr))', gap: '0.75rem', flex: 1, minWidth: 300 }}>
            <div>
              <div className="text-muted text-sm">Items</div>
              <div style={{ fontWeight: 800 }}>{purchasePlan.rows.length.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-muted text-sm">Total Cost</div>
              <div style={{ fontWeight: 800, color: 'var(--accent-warning)' }}>{formatCoins(purchasePlan.totalCost)}</div>
            </div>
            <div>
              <div className="text-muted text-sm">MP Gain</div>
              <div style={{ fontWeight: 800, color: 'var(--accent-success)' }}>+{purchasePlan.totalMagicPower.toLocaleString()}</div>
            </div>
          </div>
        </div>

        {planMode === 'budget' && purchasePlan.rows.length > 0 && (
          <div className="text-muted text-sm" style={{ marginBottom: '0.75rem' }}>
            Remaining budget: {formatCoins(purchasePlan.remainingBudget)}
          </div>
        )}
        {planMode === 'target' && Number(targetMpInput) > 0 && !purchasePlan.complete && (
          <div className="text-warning text-sm" style={{ marginBottom: '0.75rem' }}>
            Current filters do not have enough missing accessories to reach that target.
          </div>
        )}

        {purchasePlan.rows.length > 0 && (
          <div style={{ maxHeight: 260, overflowY: 'auto', borderTop: '1px solid var(--glass-border)', paddingTop: '0.75rem' }}>
            {purchasePlan.rows.map((row, index) => (
              <div key={row.id} className="flex-between" style={{ gap: '1rem', padding: '0.45rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <span style={{ fontWeight: 700 }}>{index + 1}. {row.name}</span>
                <span className="text-muted text-sm">
                  {row.nextRarity ? `${row.rarity.replace('_', ' ')} → ${row.nextRarity.replace('_', ' ')}` : row.rarity.replace('_', ' ')}
                  {' '}· +{row.magicPower} MP · {formatCoins(row.bestCost)} · {formatCoins(row.coinsPerMagicPower)}/MP
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <div className="glass-card text-danger" style={{ marginBottom: '1rem' }}>Error fetching magic power data: {error}</div>}

      {meta && (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
          Showing {filteredRows.length.toLocaleString()} accessories from {meta.accessoriesScanned?.toLocaleString() || 0} scanned candidates. Excluding {(meta.excludedWithPredecessorsCount ?? excludedIds.length).toLocaleString()} owned/predecessor IDs.
          {meta.skycryptMissingFilterCount > 0 && ` SkyCrypt missing filter: ${meta.skycryptMissingFilterCount.toLocaleString()} IDs.`}
          {meta.recombobulatedOwnedCount > 0 && ` Already recombobulated: ${meta.recombobulatedOwnedCount.toLocaleString()}.`}
          {meta.recombUpgradeCount > 0 && ` Recomb upgrades: ${meta.recombUpgradeCount.toLocaleString()} at ${formatCoins(meta.recombPrice)} each.`}
          {acquisitionFilter !== 'all' && ` Method filter: ${acquisitionOptions.find((option) => option.value === acquisitionFilter)?.label}.`}
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
                <td>{row.nextRarity ? `${row.rarity.replace('_', ' ')} → ${row.nextRarity.replace('_', ' ')}` : row.rarity.replace('_', ' ')}</td>
                <td style={{ fontWeight: 700 }}>{row.magicPower}</td>
                <td>{formatCoins(row.bestCost)}</td>
                <td style={{ color: 'var(--accent-success)', fontWeight: 700 }}>{formatCoins(row.coinsPerMagicPower)}</td>
                <td>
                  {row.bestMethod === 'craft' ? 'Craft' : row.bestMethod === 'recomb' ? 'Recomb' : 'Buy'}
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
