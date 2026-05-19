import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import axios from 'axios';
import { RefreshCw, ChevronDown, ChevronRight, Settings, ShoppingCart, Copy, Check, Package } from 'lucide-react';
import CustomRecipeManager from './CustomRecipeManager';
import { API_URL } from '../services/api';

const formatCoins = (num) => {
  if (!num && num !== 0) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
  return Math.round(num).toLocaleString();
};

const formatCoinsShort = (num) => {
  if (!num && num !== 0) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(0) + 'k';
  return Math.round(num).toString();
};

const buildRecipeTreeFromRow = (row) => {
  const children = (row.inputs || []).map((input) => {
    const qty = Number(input.qty) || 0;
    const totalCost = Number(input.cost) || 0;

    return {
      id: input.id,
      name: input.name || input.id?.replace('SHARD_', '').replace(/_/g, ' ') || 'Unknown',
      qty,
      qtyNeeded: qty,
      action: input.action || 'BUY',
      unitPrice: qty > 0 ? totalCost / qty : 0,
      totalCost,
      children: [],
    };
  });

  return {
    id: row.id,
    name: row.name || row.id?.replace('SHARD_', '').replace(/_/g, ' ') || 'Unknown',
    qty: row.yieldsPerCraft || 1,
    qtyNeeded: row.yieldsPerCraft || 1,
    action: 'CRAFT',
    runsNeeded: 1,
    unitPrice: row.inputCost && row.yieldsPerCraft ? row.inputCost / row.yieldsPerCraft : 0,
    totalCost: row.inputCost || children.reduce((sum, child) => sum + child.totalCost, 0),
    children,
  };
};

// Recursive craft tree node
function CraftTreeNode({ node, depth = 0 }) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children && node.children.length > 0;
  const indent = depth * 24;
  const isCraft = node.action === 'CRAFT';

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: `6px 8px 6px ${indent + 8}px`,
          background: depth % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
          borderLeft: depth > 0 ? '2px solid rgba(88,101,242,0.3)' : 'none',
          cursor: hasChildren ? 'pointer' : 'default',
          transition: 'background 0.15s',
        }}
        onClick={() => hasChildren && setOpen(!open)}
        onMouseEnter={e => { if (hasChildren) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = depth % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent'; }}
      >
        {hasChildren ? (
          open ? <ChevronDown size={14} style={{ color: '#5865F2', flexShrink: 0 }} /> : <ChevronRight size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        ) : (
          <span style={{ width: 14, flexShrink: 0 }} />
        )}
        <span style={{
          fontSize: '0.65rem', fontWeight: 'bold', padding: '1px 6px', borderRadius: '4px',
          background: isCraft ? 'rgba(252,203,11,0.15)' : 'rgba(35,165,89,0.15)',
          color: isCraft ? '#fccb0b' : '#23a559',
          border: `1px solid ${isCraft ? 'rgba(252,203,11,0.3)' : 'rgba(35,165,89,0.3)'}`,
          flexShrink: 0,
        }}>
          {isCraft ? 'CRAFT' : 'BUY'}
        </span>
        {node.acquisitionHint === 'DIRECT_BUY_CHEAPER' && (
          <span title="This recipe is expanded for visibility, but buying this ingredient is currently cheaper." style={{
            fontSize: '0.62rem',
            fontWeight: 'bold',
            padding: '1px 5px',
            borderRadius: '4px',
            background: 'rgba(255,184,108,0.12)',
            color: '#ffb86c',
            border: '1px solid rgba(255,184,108,0.35)',
            flexShrink: 0,
          }}>
            BUY CHEAPER
          </span>
        )}
        <span style={{ fontWeight: depth === 0 ? 'bold' : 'normal', color: 'var(--text-primary)', flex: 1 }}>
          {Math.ceil(node.qty)}x <span style={{ color: isCraft ? '#fccb0b' : '#fff' }}>{node.name}</span>
        </span>
        <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)', fontSize: '0.85rem', flexShrink: 0 }}>
          @ {formatCoins(node.unitPrice)} ea
        </span>
        <span style={{ fontFamily: 'monospace', fontWeight: 'bold', color: '#fff', fontSize: '0.85rem', minWidth: '80px', textAlign: 'right', flexShrink: 0 }}>
          {formatCoins(node.totalCost)}
        </span>
      </div>
      {open && hasChildren && node.children.map((child, i) => (
        <CraftTreeNode key={`${child.id}_${i}`} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

// ── Budget Optimizer Panel ──────────────────────────────────────────────────
const BUDGET_PRESETS = [
  { label: '1M',   value: 1_000_000 },
  { label: '5M',   value: 5_000_000 },
  { label: '10M',  value: 10_000_000 },
  { label: '50M',  value: 50_000_000 },
  { label: '100M', value: 100_000_000 },
  { label: '500M', value: 500_000_000 },
];

function BudgetOptimizer({ buffs, tradeMode, liquidityTier, uncapVolume, filterManipulated }) {
  const [budget, setBudget] = useState('');
  const [budgetInput, setBudgetInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [expandedRow, setExpandedRow] = useState(null);
  const [showShoppingList, setShowShoppingList] = useState(false);
  const [copied, setCopied] = useState(false);

  const parseBudget = (raw) => {
    const s = raw.trim().toLowerCase().replace(/,/g, '');
    if (!s) return 0;
    if (s.endsWith('b')) return parseFloat(s) * 1e9;
    if (s.endsWith('m')) return parseFloat(s) * 1e6;
    if (s.endsWith('k')) return parseFloat(s) * 1e3;
    return parseFloat(s) || 0;
  };

  const handleOptimize = async () => {
    const b = parseBudget(budgetInput);
    if (b <= 0) { setError('Enter a valid budget (e.g. 10M or 50000000)'); return; }
    setError('');
    setLoading(true);
    setResult(null);
    setExpandedRow(null);
    setShowShoppingList(false);
    try {
      const params = new URLSearchParams({
        budget: b,
        croc: buffs.crocodile,
        sea: buffs.sea_serpent,
        tia: buffs.tiamat,
        salesTier: liquidityTier,
        tradeMode,
        uncapped: uncapVolume,
        filterManipulated,
      });
      const res = await axios.get(`${API_URL}/batch-optimize?${params}`);
      setResult(res.data);
    } catch(e) {
      setError('Failed to run optimizer: ' + (e.response?.data?.error || e.message));
    }
    setLoading(false);
  };

  const handleCopyShoppingList = () => {
    if (!result?.shoppingList) return;
    const text = result.shoppingList
      .map(m => `${Math.ceil(m.totalQty)}x ${m.name}  (${formatCoins(m.totalCost)} coins)`)
      .join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const s = result?.summary;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* ── Budget Input Card ── */}
      <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--glass-border)', borderRadius: '14px', padding: '1.5rem' }}>
        <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', color: 'var(--text-warning)' }}>💼 Set Your Coin Budget</h3>

        {/* Preset chips */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          {BUDGET_PRESETS.map(p => (
            <button
              key={p.label}
              onClick={() => { setBudgetInput(p.label); setBudget(p.value); }}
              style={{
                background: parseBudget(budgetInput) === p.value ? 'rgba(88,101,242,0.35)' : 'rgba(255,255,255,0.06)',
                border: parseBudget(budgetInput) === p.value ? '1px solid #5865F2' : '1px solid var(--glass-border)',
                color: parseBudget(budgetInput) === p.value ? '#fff' : 'var(--text-muted)',
                padding: '5px 14px', borderRadius: '20px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 'bold',
                transition: 'all 0.15s',
              }}
            >{p.label}</button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="e.g. 50M or 50000000"
            value={budgetInput}
            onChange={e => setBudgetInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleOptimize()}
            style={{
              background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)',
              border: '1px solid var(--glass-border)', padding: '0.6rem 1rem',
              borderRadius: '8px', fontSize: '1rem', width: '220px', outline: 'none',
            }}
          />
          <button
            onClick={handleOptimize}
            disabled={loading}
            style={{
              background: 'linear-gradient(135deg, #5865F2, #7289da)',
              color: 'white', border: 'none', padding: '0.6rem 1.6rem',
              borderRadius: '8px', cursor: loading ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              fontWeight: 'bold', fontSize: '0.95rem', opacity: loading ? 0.7 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            {loading ? <RefreshCw size={15} className="spin" /> : <Package size={15} />}
            {loading ? 'Optimizing...' : 'Optimize'}
          </button>
          {error && <span style={{ color: 'var(--text-danger)', fontSize: '0.85rem' }}>{error}</span>}
        </div>
        {parseBudget(budgetInput) > 0 && (
          <p style={{ margin: '0.6rem 0 0', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            Budget: <strong style={{ color: '#fff' }}>{formatCoins(parseBudget(budgetInput))}</strong> coins
          </p>
        )}
      </div>

      {/* ── Summary Bar ── */}
      {s && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '1rem', background: 'rgba(0,0,0,0.3)',
          border: '1px solid rgba(88,101,242,0.3)', borderRadius: '14px', padding: '1.25rem',
        }}>
          {[
            { label: 'Fusions Allocated', value: s.fusionCount, color: '#a0a8f0' },
            { label: 'Total Investment',  value: formatCoins(s.totalInvestment), color: '#fccb0b' },
            { label: 'Expected Profit',   value: '+' + formatCoins(s.totalProfit), color: '#23a559' },
            { label: 'Effective ROI',     value: s.effectiveROI + '%', color: s.effectiveROI >= 10 ? '#23a559' : '#fccb0b' },
            { label: 'Leftover Budget',   value: formatCoins(s.remainingBudget), color: 'var(--text-muted)' },
          ].map(stat => (
            <div key={stat.label} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 'bold', fontFamily: 'monospace', color: stat.color }}>
                {stat.value}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Allocation Table ── */}
      {result?.allocation?.length > 0 && (
        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--glass-border)', borderRadius: '14px', overflow: 'hidden' }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 'bold', color: '#5865F2' }}>📋 Craft Plan — {result.allocation.length} fusions</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Click a row to see its materials</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Fusion Output</th>
                  <th># Crafts</th>
                  <th>Output</th>
                  <th>Investment</th>
                  <th>Profit</th>
                  <th>ROI</th>
                  <th>Vol/Hr</th>
                </tr>
              </thead>
              <tbody>
                {result.allocation.map((row, i) => (
                  <React.Fragment key={row.id}>
                    <tr
                      onClick={() => setExpandedRow(expandedRow === row.id ? null : row.id)}
                      style={{ cursor: 'pointer', background: expandedRow === row.id ? 'rgba(88,101,242,0.08)' : undefined, transition: 'background 0.15s' }}
                    >
                      <td className="item-name">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          {expandedRow === row.id
                            ? <ChevronDown size={13} style={{ color: '#5865F2', flexShrink: 0 }} />
                            : <ChevronRight size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
                          <div>
                            <div style={{ fontWeight: 'bold' }}>{row.name.replace(/_/g, ' ')}</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                              {row.rawMaterials.map(m => `${Math.ceil(m.qty)}x ${m.name}`).join(' + ')}
                              <span style={{ marginLeft: 6, color: '#5865F2' }}>→ {row.yieldsPerCraft}× per craft</span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 'bold' }}>{row.crafts}</td>
                      <td style={{ textAlign: 'center', color: '#a0a8f0' }}>{row.totalYield.toLocaleString()}x</td>
                      <td style={{ color: '#fccb0b', fontFamily: 'monospace' }}>{formatCoins(row.investment)}</td>
                      <td className="text-success" style={{ fontFamily: 'monospace' }}>+{formatCoins(row.profit)}</td>
                      <td style={{ color: row.roiPerCraft >= 10 ? '#23a559' : '#fccb0b', fontWeight: 'bold' }}>{row.roiPerCraft}%</td>
                      <td className="text-muted" style={{ fontSize: '0.85rem' }}>
                        {Math.floor(row.salesPerHour)}
                        <span style={{ marginLeft: 5, borderRadius: '50%', width: 7, height: 7, display: 'inline-block', background: row.salesPerHour < 20 ? '#da373c' : row.salesPerHour < 50 ? '#fccb0b' : '#23a559' }} />
                      </td>
                    </tr>
                    {expandedRow === row.id && (
                      <tr>
                        <td colSpan={7} style={{ padding: 0, border: 'none' }}>
                          <div style={{ background: 'rgba(0,0,0,0.3)', borderLeft: '3px solid #5865F2', margin: '0 0 4px 0', padding: '0.75rem 1.25rem' }}>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                              Materials for {row.crafts} craft run{row.crafts !== 1 ? 's' : ''}
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                              {row.rawMaterials.map(m => (
                                <div key={m.id} style={{
                                  background: 'rgba(255,255,255,0.04)', border: '1px solid var(--glass-border)',
                                  borderRadius: '8px', padding: '6px 12px', fontSize: '0.82rem',
                                }}>
                                  <span style={{ fontWeight: 'bold', color: '#fff' }}>{Math.ceil(m.totalQty)}x</span>
                                  <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>{m.name}</span>
                                  <span style={{ color: '#fccb0b', fontFamily: 'monospace', fontSize: '0.75rem' }}>({formatCoins(m.totalCost)})</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Consolidated Shopping List ── */}
      {result?.shoppingList?.length > 0 && (
        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--glass-border)', borderRadius: '14px', overflow: 'hidden' }}>
          <div
            style={{ padding: '1rem 1.25rem', borderBottom: showShoppingList ? '1px solid var(--glass-border)' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
            onClick={() => setShowShoppingList(!showShoppingList)}
          >
            <span style={{ fontWeight: 'bold', color: '#23a559', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <ShoppingCart size={16} />
              Shopping List — {result.shoppingList.length} items
              {showShoppingList ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
            <button
              onClick={e => { e.stopPropagation(); handleCopyShoppingList(); }}
              style={{
                background: copied ? 'rgba(35,165,89,0.2)' : 'rgba(255,255,255,0.06)',
                border: copied ? '1px solid #23a559' : '1px solid var(--glass-border)',
                color: copied ? '#23a559' : 'var(--text-muted)',
                padding: '4px 12px', borderRadius: '6px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.8rem',
                transition: 'all 0.2s',
              }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          {showShoppingList && (
            <div style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '360px', overflowY: 'auto' }}>
              {result.shoppingList.map((m, i) => {
                const pct = result.summary.totalInvestment > 0 ? (m.totalCost / result.summary.totalInvestment) * 100 : 0;
                return (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                    <span style={{ width: 20, textAlign: 'right', color: 'var(--text-muted)', fontSize: '0.75rem', flexShrink: 0 }}>#{i + 1}</span>
                    <div style={{ flex: 1, background: 'rgba(255,255,255,0.03)', borderRadius: '6px', overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${Math.max(pct, 0.5)}%`,
                          height: '100%',
                          position: 'absolute',
                          background: 'rgba(88,101,242,0.12)',
                          borderRadius: '6px',
                        }}
                      />
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', position: 'relative' }}>
                        <span>
                          <span style={{ fontWeight: 'bold', color: '#fff', marginRight: 6 }}>{Math.ceil(m.totalQty)}x</span>
                          <span style={{ color: 'var(--text-primary)' }}>{m.name}</span>
                        </span>
                        <span style={{ fontFamily: 'monospace', color: '#fccb0b', fontSize: '0.85rem', flexShrink: 0 }}>
                          {formatCoins(m.totalCost)}
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginLeft: 4 }}>({pct.toFixed(1)}%)</span>
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {result?.allocation?.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.02)', borderRadius: '14px', border: '1px solid var(--glass-border)' }}>
          No profitable fusions found for current filters. Try increasing your budget or adjusting filters.
        </div>
      )}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────
export default function ShardFusionFlipper() {
  const [buffs, setBuffs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('skyblock_fusion_buffs')) || {crocodile: 0, sea_serpent: 0, tiamat: 0}; }
    catch { return {crocodile: 0, sea_serpent: 0, tiamat: 0}; }
  });

  const [tradeMode, setTradeMode] = useState('insta-buy_buy-order');
  const [liquidityTier, setLiquidityTier] = useState('medium');
  const [viewMode, setViewMode] = useState('absolute');  // 'absolute' | 'total' | 'optimizer'
  const [rankBy, setRankBy] = useState('profit'); // 'profit' | 'volume'
  const [searchQuery, setSearchQuery] = useState('');
  const [uncapVolume, setUncapVolume] = useState(false);
  const [filterManipulated, setFilterManipulated] = useState(true);

  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState('');

  // Craft tree
  const [expandedRowId, setExpandedRowId] = useState(null);
  const [craftTree, setCraftTree] = useState(null);
  const [craftAlternatives, setCraftAlternatives] = useState([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeMeta, setTreeMeta] = useState(null);
  const [showRecipeManager, setShowRecipeManager] = useState(false);

  const saveBuffs = (newBuffs) => {
    setBuffs(newBuffs);
    localStorage.setItem('skyblock_fusion_buffs', JSON.stringify(newBuffs));
  };

  const abortRef = useRef(null);
  const requestSeqRef = useRef(0);
  const lastRequestKeyRef = useRef('');

  const displayedLeaderboard = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return leaderboard;
    return leaderboard.filter(f =>
      f.name.toLowerCase().includes(query) ||
      f.id.toLowerCase().includes(query)
    );
  }, [leaderboard, searchQuery]);

  const fetchLeaderboard = useCallback(async () => {
    // Cancel any in-flight request before starting a new one
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;

    setLoading(true);
    setLeaderboardError('');
    try {
      const params = new URLSearchParams({
        croc: buffs.crocodile,
        sea: buffs.sea_serpent,
        tia: buffs.tiamat,
        salesTier: liquidityTier,
        tradeMode,
        sortMode: rankBy === 'volume' ? 'volume' : (viewMode === 'optimizer' ? 'absolute' : viewMode),
        uncapped: uncapVolume,
        filterManipulated,
      });
      const requestKey = params.toString();
      if (requestKey !== lastRequestKeyRef.current) {
        lastRequestKeyRef.current = requestKey;
        setLeaderboard([]);
        setExpandedRowId(null);
        setCraftTree(null);
        setCraftAlternatives([]);
        setTreeMeta(null);
      }
      const res = await axios.get(`${API_URL}/best-fusions?${params.toString()}`, {
        signal: controller.signal,
        timeout: 30000,
      });
      if (requestSeqRef.current === requestId) {
        setLeaderboard(Array.isArray(res.data) ? res.data : []);
      }
    } catch(e) {
      if (axios.isCancel(e) || e.name === 'CanceledError') return; // Silently ignore cancelled requests
      console.error('Failed to fetch best fusions', e);
      if (requestSeqRef.current === requestId) {
        setLeaderboardError(e.response?.data?.error || e.message || 'Failed to fetch leaderboard');
      }
    } finally {
      if (requestSeqRef.current === requestId) {
        setLoading(false);
        if (abortRef.current === controller) abortRef.current = null;
      }
    }
  }, [buffs, liquidityTier, tradeMode, viewMode, rankBy, filterManipulated, uncapVolume]);

  useEffect(() => {
    if (viewMode !== 'optimizer') {
      fetchLeaderboard();
    }
    const interval = viewMode !== 'optimizer' ? setInterval(fetchLeaderboard, 60000) : null;
    return () => {
      if (interval) clearInterval(interval);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [fetchLeaderboard, viewMode]);

  const handleRowClick = async (row) => {
    if (expandedRowId === row.id) {
      setExpandedRowId(null);
      setCraftTree(null);
      setCraftAlternatives([]);
      setTreeMeta(null);
      return;
    }
    setExpandedRowId(row.id);
    setCraftTree(buildRecipeTreeFromRow(row));
    setCraftAlternatives([]);
    setTreeMeta(null);
    setTreeLoading(true);

    try {
      const inMode = tradeMode.split('_')[0];
      const params = new URLSearchParams({
        qty: row.yieldsPerCraft,
        inMode,
        depth: 6,
        alternatives: 6,
      });
      if (row.recipeKey) params.set('recipeKey', row.recipeKey);
      const res = await axios.get(`${API_URL}/craft-tree/${row.id}?${params.toString()}`, {
        timeout: 5000,
      });
      setCraftTree(res.data.tree);
      setCraftAlternatives(res.data.alternatives || []);
      setTreeMeta({
        savings: res.data.savings,
        savingsPercent: res.data.savingsPercent,
        directBuy: res.data.directBuyCost,
        fullRecipeCost: res.data.fullRecipeCost,
        cheapestCost: res.data.cheapestCost,
      });
    } catch(e) {
      console.error('Failed to fetch expanded craft tree', e);
    }

    setTreeLoading(false);
  };

  const selectCraftAlternative = (alternative) => {
    setCraftTree(alternative.tree);
    setCraftAlternatives(prev => prev.map(alt => ({
      ...alt,
      selected: alt.recipeKey === alternative.recipeKey,
    })));
    setTreeMeta({
      savings: alternative.savings,
      savingsPercent: alternative.savingsPercent,
      directBuy: treeMeta?.directBuy,
      fullRecipeCost: alternative.totalCost,
      cheapestCost: alternative.cheapestTotalCost,
    });
  };

  const colCount = viewMode === 'absolute' ? 7 : 5;

  return (
    <div className="glass-card animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* Header */}
      <div className="flex-between">
        <h2>Shard Fusions</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {viewMode !== 'optimizer' && (
            <span className="text-muted text-sm">Click any row to view the priced fusion recipe</span>
          )}
          <button
            onClick={() => setShowRecipeManager(true)}
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)', color: 'var(--text-muted)', padding: '6px 12px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}
          >
            <Settings size={14} /> Custom Recipes
          </button>
        </div>
      </div>

      {showRecipeManager && <CustomRecipeManager onClose={() => { setShowRecipeManager(false); fetchLeaderboard(); }} />}

      {/* Fossil Buffs + Scan */}
      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
        <div style={{ flex: 1, minWidth: '350px' }}>
          <h3 style={{ marginTop: 0, color: 'var(--text-warning)', marginBottom: '0.5rem', fontSize: '1rem' }}>Fossil Yield Multipliers</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(80px, 1fr) minmax(80px, 1fr) minmax(80px, 1fr)', gap: '1rem' }}>
            <div>
              <label className="text-muted text-sm" style={{ display: 'block', marginBottom: '0.25rem' }}>🐊 Crocodile</label>
              <input type="number" min="0" max="10" value={buffs.crocodile} onChange={(e) => saveBuffs({...buffs, crocodile: Number(e.target.value) || 0})} style={{ background: 'var(--glass-bg)', color: 'white', border: '1px solid var(--glass-border)', padding: '0.5rem', borderRadius: '6px', width: '100%', outline: 'none' }} />
            </div>
            <div>
              <label className="text-muted text-sm" style={{ display: 'block', marginBottom: '0.25rem' }}>🐍 S. Serpent</label>
              <input type="number" min="0" max="10" value={buffs.sea_serpent} onChange={(e) => saveBuffs({...buffs, sea_serpent: Number(e.target.value) || 0})} style={{ background: 'var(--glass-bg)', color: 'white', border: '1px solid var(--glass-border)', padding: '0.5rem', borderRadius: '6px', width: '100%', outline: 'none' }} />
            </div>
            <div>
              <label className="text-muted text-sm" style={{ display: 'block', marginBottom: '0.25rem' }}>🐉 Tiamat</label>
              <input type="number" min="0" max="10" value={buffs.tiamat} onChange={(e) => saveBuffs({...buffs, tiamat: Number(e.target.value) || 0})} style={{ background: 'var(--glass-bg)', color: 'white', border: '1px solid var(--glass-border)', padding: '0.5rem', borderRadius: '6px', width: '100%', outline: 'none' }} />
            </div>
          </div>
        </div>
        {viewMode !== 'optimizer' && (
          <button onClick={fetchLeaderboard} disabled={loading} style={{ background: 'var(--accent-primary)', color: 'white', border: 'none', padding: '0.8rem 1.5rem', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 'bold' }}>
            <RefreshCw className={loading ? 'spin' : ''} size={16} /> Scan
          </button>
        )}
      </div>

      {/* Controls Row */}
      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap', background: 'var(--glass-bg)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
        <div>
          <label style={{ marginRight: '0.5rem', color: 'var(--text-muted)' }}>Pricing Model:</label>
          <select value={tradeMode} onChange={(e) => setTradeMode(e.target.value)} style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.5rem', borderRadius: '8px', outline: 'none', cursor: 'pointer' }}>
            <option value="buy-order_insta-sell">Buy Order → Insta-sell</option>
            <option value="buy-order_sell-offer">Buy Order → Sell offer</option>
            <option value="insta-buy_insta-sell">Insta-buy → Insta-sell</option>
            <option value="insta-buy_buy-order">Insta-buy → Sell offer (Bot)</option>
            <option value="insta-buy_sell-offer">Insta-buy → Sell offer</option>
          </select>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '0.35rem' }}>
            Inputs priced as {tradeMode.startsWith('insta-buy') ? 'instabuy from sell offers' : 'buy orders'}.
          </div>
        </div>
        <div>
          <label style={{ marginRight: '0.5rem', color: 'var(--text-muted)' }}>Volume Filter:</label>
          <select value={liquidityTier} onChange={(e) => setLiquidityTier(e.target.value)} style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.5rem', borderRadius: '8px', outline: 'none', cursor: 'pointer' }}>
            <option value="all">All</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        {viewMode !== 'optimizer' && (
          <div>
            <label style={{ marginRight: '0.5rem', color: 'var(--text-muted)' }}>Sort By:</label>
            <select value={rankBy} onChange={(e) => setRankBy(e.target.value)} style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.5rem', borderRadius: '8px', outline: 'none', cursor: 'pointer' }}>
              <option value="profit">Profit</option>
              <option value="volume">Volume</option>
            </select>
          </div>
        )}
        {viewMode !== 'optimizer' && (
          <div>
            <label style={{ marginRight: '0.5rem', color: 'var(--text-muted)' }}>Search:</label>
            <input type="text" placeholder="Shard name..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.5rem', borderRadius: '8px', width: '140px', outline: 'none' }} />
          </div>
        )}

        {/* VIEW MODE TOGGLE */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem', justifyContent: 'space-between', alignItems: 'center', flex: 1 }}>
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            {[
              { key: 'absolute', label: '📦 Flip Rankings' },
              { key: 'total',    label: '💰 Max Achievable Profits' },
              { key: 'optimizer',label: '💼 Budget Optimizer' },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => {
                  setViewMode(tab.key);
                  // Auto-match bot's trade mode when entering Max Profit view
                  if (tab.key === 'total') setTradeMode('insta-buy_buy-order');
                }}
                style={{
                  background: 'none', border: 'none', padding: '0.5rem 1rem',
                  fontSize: '0.95rem', fontWeight: 'bold',
                  color: viewMode === tab.key ? '#fff' : 'var(--text-muted)',
                  borderBottom: viewMode === tab.key ? '2px solid #5865F2' : '2px solid transparent',
                  cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'var(--text-danger)', fontWeight: 'bold', marginRight: '1rem' }}>
              <input type="checkbox" checked={filterManipulated} onChange={(e) => setFilterManipulated(e.target.checked)} style={{ accentColor: 'var(--text-danger)', transform: 'scale(1.2)' }} />
              🛡️ Anti-Manipulation
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'var(--text-warning)', fontWeight: 'bold' }}>
              <input type="checkbox" checked={uncapVolume} onChange={(e) => setUncapVolume(e.target.checked)} style={{ accentColor: 'var(--text-warning)', transform: 'scale(1.2)' }} />
              Uncap 200 Batch Limit
            </label>
          </div>
        </div>
      </div>

      {/* ── Budget Optimizer Tab Content ── */}
      {viewMode === 'optimizer' && (
        <BudgetOptimizer
          buffs={buffs}
          tradeMode={tradeMode}
          liquidityTier={liquidityTier}
          uncapVolume={uncapVolume}
          filterManipulated={filterManipulated}
        />
      )}

      {/* ── Leaderboard Table ── */}
      {viewMode !== 'optimizer' && (
        <div style={{ overflowX: 'auto' }}>
          <div style={{ margin: '0 0 0.75rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Showing {displayedLeaderboard.length.toLocaleString()} profitable shard{displayedLeaderboard.length === 1 ? '' : 's'}
            {rankBy === 'volume' ? ' sorted by volume' : ' sorted by profit'}
            {searchQuery.trim() && leaderboard.length !== displayedLeaderboard.length && ` (${leaderboard.length.toLocaleString()} before search)`}
          </div>
          {leaderboardError && (
            <div style={{ margin: '0 0 0.75rem', color: 'var(--text-danger)', fontSize: '0.85rem' }}>
              Failed to update leaderboard: {leaderboardError}
            </div>
          )}
          <table>
            <thead>
              <tr>
                <th>Output Name</th>
                {viewMode === 'absolute' ? (
                  <>
                    <th>Input Cost</th>
                    <th>Sell Price / Shard</th>
                    <th>Profit / Craft</th>
                    <th>ROI</th>
                    <th>Total Profit</th>
                    <th>Buy Orders/Hr</th>
                  </>
                ) : (
                  <>
                    <th>💰 Profit / Shard</th>
                    <th>× Yield Volume</th>
                    <th>= Total Profit</th>
                    <th>📊 Volume</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {displayedLeaderboard.length === 0 && loading && (
                <tr>
                  <td colSpan={colCount} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    Updating leaderboard...
                  </td>
                </tr>
              )}
              {displayedLeaderboard.map((row, index) => (
                <React.Fragment key={`${row.id}_${index}`}>
                  <tr
                    onClick={() => handleRowClick(row)}
                    style={{ cursor: 'pointer', transition: 'background 0.15s', background: expandedRowId === row.id ? 'rgba(88,101,242,0.1)' : undefined }}
                  >
                    <td className="item-name">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {expandedRowId === row.id ? <ChevronDown size={14} style={{ color: '#5865F2' }} /> : <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />}
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontWeight: 'bold' }}>{row.name.replace(/_/g, ' ')}</span>
                            <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: '4px', background: 'rgba(88,101,242,0.15)', border: '1px solid rgba(88,101,242,0.3)', color: '#a0a8f0', whiteSpace: 'nowrap' }}>
                              → {row.yieldsPerCraft}x
                            </span>
                            <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: '4px', background: row.roiPerCraft >= 10 ? 'rgba(35,165,89,0.15)' : 'rgba(252,203,11,0.15)', border: `1px solid ${row.roiPerCraft >= 10 ? 'rgba(35,165,89,0.3)' : 'rgba(252,203,11,0.3)'}`, color: row.roiPerCraft >= 10 ? '#23a559' : '#fccb0b', whiteSpace: 'nowrap' }}>
                              {row.roiPerCraft}% ROI
                            </span>
                            {row.isTargetCrafted && <span style={{ color: '#fccb0b', fontWeight: 'bold', border: '1px solid #fccb0b', padding: '1px 4px', borderRadius: '4px', fontSize: '0.65rem' }}>🎯 Recursive</span>}
                            {row.manipulationWarning && (
                              <span title={`Sell-order price is ${Number(row.sellOrderPremium || 0).toFixed(1)}x the instant-sell price.`} style={{ color: '#ffb86c', fontWeight: 'bold', border: '1px solid rgba(255,184,108,0.45)', background: 'rgba(255,184,108,0.12)', padding: '1px 4px', borderRadius: '4px', fontSize: '0.65rem' }}>
                                Spread {Number(row.sellOrderPremium || 0).toFixed(1)}x
                              </span>
                            )}
                          </div>
                          {/* BUG FIX: use qty (not perCraftQty) — these are already the correct per-craft-run quantities */}
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                            {(row.recipeInputs || row.inputs).map(i => `${Math.ceil(i.qty)}x ${i.name.replace(/_/g, ' ')}`).join(' + ')}
                            <span style={{ marginLeft: 8, color: '#5865F2', fontSize: '0.72rem' }}>→ {row.yieldsPerCraft}× per craft</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    {viewMode === 'absolute' ? (
                      <>
                        <td>{formatCoins(row.inputCost)}</td>
                        <td title={!tradeMode.includes('insta-sell') && row.marketSell ? `Instant-sell is ${formatCoins(row.marketSell)}. Sell-order premium: ${Number(row.sellOrderPremium || 0).toFixed(1)}x.` : undefined}>
                          {formatCoins(tradeMode.includes('insta-sell') ? row.marketSell : row.marketBuy)}
                        </td>
                        <td className="text-success">+{formatCoins(Math.max(0, row.absoluteProfit))}</td>
                        <td style={{ color: row.roiPerCraft >= 10 ? '#23a559' : '#fccb0b', fontWeight: 'bold' }}>{row.roiPerCraft}%</td>
                        <td className="text-success" title={`${formatCoins(row.absoluteProfit)} × ${row.maxVolume} shards`}>+{formatCoins(Math.max(0, row.totalProfit))}</td>
                        <td className="text-muted">
                          {Math.floor(row.salesPerHour)}
                          <span style={{ marginLeft: '6px', borderRadius: '50%', width: '8px', height: '8px', display: 'inline-block', background: row.salesPerHour < 20 ? '#da373c' : (row.salesPerHour < 50 ? '#fccb0b' : '#23a559') }} />
                        </td>
                      </>
                    ) : (
                      // ── Discord Bot Format: 💰 grossProfit × volume = totalProfit ──
                      <>
                        <td style={{ fontFamily: 'monospace', fontWeight: 'bold', fontSize: '1rem' }}>
                          <span style={{ color: '#fccb0b' }}>💰 {formatCoinsShort(row.grossProfitPerShard)}</span>
                        </td>
                        <td style={{ fontFamily: 'monospace', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                          ×&nbsp;<span style={{ color: '#fff', fontWeight: 'bold' }}>{row.maxVolume}</span>
                          {row.maxVolume < 200 && <span style={{ fontSize: '0.7rem', color: '#da373c', marginLeft: 4 }}>vol cap</span>}
                          {row.maxVolume >= 200 && <span style={{ fontSize: '0.7rem', color: '#23a559', marginLeft: 4 }}>200 cap</span>}
                        </td>
                        <td className="text-success" style={{ fontFamily: 'monospace', fontWeight: 'bold', fontSize: '1rem' }}>
                          = +{formatCoinsShort(row.totalProfit)}
                        </td>
                        <td style={{ fontFamily: 'monospace', color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center' }}>
                          {Math.floor(row.salesPerHour)}/hr
                          <span style={{ marginLeft: 5, borderRadius: '50%', width: 7, height: 7, display: 'inline-block', background: row.salesPerHour < 20 ? '#da373c' : row.salesPerHour < 50 ? '#fccb0b' : '#23a559' }} />
                        </td>
                      </>
                    )}
                  </tr>

                  {/* Expanded Craft Tree */}
                  {expandedRowId === row.id && (
                    <tr>
                      <td colSpan={colCount} style={{ padding: 0, border: 'none' }}>
                        <div style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(88,101,242,0.3)', borderTop: '2px solid #5865F2', borderRadius: '0 0 12px 12px', margin: '0 0 8px 0', overflow: 'hidden' }}>
                          <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 'bold', color: '#5865F2', fontSize: '0.95rem' }}>
                              🌳 Priced Fusion Recipe — {row.name.replace(/_/g, ' ')}
                            </span>
                            {treeMeta && treeMeta.savings > 0 && (
                              <span style={{ background: 'rgba(35,165,89,0.15)', border: '1px solid rgba(35,165,89,0.3)', color: '#23a559', padding: '3px 10px', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 'bold' }}>
                                Save {formatCoins(treeMeta.savings)} ({treeMeta.savingsPercent}%) vs direct buy
                              </span>
                            )}
                          </div>
                          {treeMeta && Number.isFinite(treeMeta.fullRecipeCost) && Number.isFinite(treeMeta.cheapestCost) && (
                            <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexWrap: 'wrap', gap: '0.75rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                              <span>Full recipe tree: <strong style={{ color: '#fccb0b', fontFamily: 'monospace' }}>{formatCoins(treeMeta.fullRecipeCost)}</strong></span>
                              <span>Cheapest buy/craft path: <strong style={{ color: '#23a559', fontFamily: 'monospace' }}>{formatCoins(treeMeta.cheapestCost)}</strong></span>
                            </div>
                          )}
                          {treeLoading && (
                            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                              Computing optimal crafting path...
                            </div>
                          )}
                          {craftAlternatives.length > 0 && !treeLoading && (
                            <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                              <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                                Recipe Options
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                {craftAlternatives.map((alternative, altIndex) => (
                                  <button
                                    key={alternative.recipeKey || altIndex}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      selectCraftAlternative(alternative);
                                    }}
                                    style={{
                                      background: alternative.selected ? 'rgba(88,101,242,0.22)' : 'rgba(255,255,255,0.04)',
                                      border: `1px solid ${alternative.selected ? 'rgba(88,101,242,0.7)' : 'var(--glass-border)'}`,
                                      color: 'var(--text-primary)',
                                      borderRadius: '8px',
                                      padding: '0.55rem 0.7rem',
                                      cursor: 'pointer',
                                      textAlign: 'left',
                                      minWidth: '220px',
                                      maxWidth: '360px',
                                    }}
                                  >
                                    <div style={{ fontSize: '0.78rem', color: alternative.selected ? '#a0a8f0' : 'var(--text-muted)', marginBottom: '0.25rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      {alternative.recipeInputs.map(input => `${Math.ceil(input.qty)}x ${input.name.replace(/_/g, ' ')}`).join(' + ')}
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontFamily: 'monospace', fontSize: '0.82rem' }}>
                                      <span>{formatCoins(alternative.unitPrice)} ea</span>
                                      <span style={{ color: '#23a559', fontWeight: 'bold' }}>{formatCoins(alternative.totalCost)}</span>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          {craftTree && !treeLoading && (
                            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                              <CraftTreeNode node={craftTree} depth={0} />
                            </div>
                          )}
                          {!craftTree && !treeLoading && (
                            <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                              No crafting path available for this shard.
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {displayedLeaderboard.length === 0 && !loading && (
                <tr>
                  <td colSpan={colCount} style={{ textAlign: 'center', padding: '2rem' }}>
                    {leaderboardError ? 'Leaderboard update failed.' : 'No fusions found matching criteria.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Market Summary (bot-style footer) ── */}
      {viewMode === 'total' && displayedLeaderboard.length > 0 && (
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem',
          marginTop: '1.5rem', padding: '1.25rem 1.5rem',
          background: 'rgba(255,255,255,0.02)', border: '1px solid var(--glass-border)',
          borderRadius: '14px',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: 4 }}>📊 Total Market Opportunity</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: '#fccb0b', fontFamily: 'monospace' }}>
              {formatCoins(displayedLeaderboard.reduce((s, r) => s + (r.totalProfit || 0), 0))}
            </div>
          </div>
          <div style={{ textAlign: 'center', borderLeft: '1px solid var(--glass-border)', borderRight: '1px solid var(--glass-border)' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: 4 }}>✅ Profitable Recipes</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: '#23a559', fontFamily: 'monospace' }}>
              {displayedLeaderboard.length}
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: 4 }}>🏆 Best Opportunity</div>
            <div style={{ fontSize: '1rem', fontWeight: 'bold', color: '#fff' }}>
              {displayedLeaderboard[0]?.name} · {formatCoinsShort(displayedLeaderboard[0]?.totalProfit)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
