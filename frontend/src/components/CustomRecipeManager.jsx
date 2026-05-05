import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Search, Plus, Trash2, Save, X, CheckCircle, AlertCircle, Pencil } from 'lucide-react';

const FAMILIES = ['NONE', 'REPTILE'];

// ─── Live Mini Tree Preview ─────────────────────────────────────────────────
// Shows a visual crafting tree while building / when displaying saved recipes
function CraftingTree({ outputShard, outputName, qtyYielded, family, inputs, compact = false }) {
  const validInputs = inputs.filter(i => i.shard || i.name);

  const inputName = (i) => i.shard?.name ?? i.name ?? '?';
  const inputQty  = (i) => i.qty || i.shard?.fuseAmount || '?';

  const nodeBase = {
    borderRadius: compact ? '10px' : '12px',
    padding: compact ? '8px 12px' : '10px 16px',
    textAlign: 'center',
    minWidth: compact ? '80px' : '100px',
    maxWidth: compact ? '130px' : '160px',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, padding: compact ? '8px' : '16px' }}>

      {/* ── Output (top goal) ──────────────────────────────────── */}
      <div style={{
        ...nodeBase,
        background: 'linear-gradient(135deg, rgba(252,203,11,0.18), rgba(255,140,0,0.1))',
        border: '1.5px solid rgba(252,203,11,0.55)',
        boxShadow: '0 4px 20px rgba(252,203,11,0.12)',
      }}>
        <div style={{ fontSize: compact ? '0.7rem' : '0.72rem', color: 'rgba(252,203,11,0.6)', marginBottom: 2, letterSpacing: '0.06em' }}>OUTPUT</div>
        <div style={{ fontWeight: 'bold', color: '#fccb0b', fontSize: compact ? '0.82rem' : '0.9rem', lineHeight: 1.2 }}>
          {outputName || outputShard?.name || <span style={{ color: 'rgba(255,255,255,0.2)', fontStyle: 'italic' }}>pick shard…</span>}
        </div>
        <div style={{ color: 'rgba(252,203,11,0.5)', fontSize: '0.7rem', marginTop: 3 }}>
          → {qtyYielded}× per craft
          {family && family !== 'NONE' && <span style={{ marginLeft: 5, opacity: 0.7 }}>· {family}</span>}
        </div>
      </div>

      {/* ── Arrow down ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, marginTop: -2 }}>
        <div style={{ width: 2, height: compact ? 12 : 16, background: 'linear-gradient(to bottom, rgba(252,203,11,0.5), rgba(88,101,242,0.5))' }} />
        <svg width="12" height="8" viewBox="0 0 12 8" style={{ transform: 'rotate(180deg)' }}>
          <polyline points="0,0 6,7 12,0" fill="none" stroke="rgba(252,203,11,0.5)" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </div>

      {/* ── FUSE badge ─────────────────────────────────────────── */}
      <div style={{
        background: 'rgba(88,101,242,0.15)', border: '1px solid rgba(88,101,242,0.4)',
        borderRadius: '20px', padding: compact ? '3px 10px' : '4px 14px',
        fontSize: compact ? '0.68rem' : '0.72rem', color: '#a0a8f0', fontWeight: 700, letterSpacing: '0.1em',
        display: 'flex', alignItems: 'center', gap: 5,
      }}>
        <span>⚗️</span> FUSE
      </div>

      {/* ── Arrow up ───────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, marginBottom: -2 }}>
        <svg width="12" height="8" viewBox="0 0 12 8">
          <polyline points="0,0 6,7 12,0" fill="none" stroke="rgba(88,101,242,0.5)" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
        <div style={{ width: 2, height: compact ? 12 : 16, background: 'linear-gradient(to bottom, rgba(88,101,242,0.5), rgba(88,101,242,0.2))' }} />
      </div>

      {/* ── Connector bar bridging inputs ──────────────────────── */}
      {validInputs.length > 1 && (
        <div style={{
          position: 'relative', width: '100%', display: 'flex', justifyContent: 'center',
          marginBottom: -2,
        }}>
          {/* Horizontal bar */}
          <div style={{
            position: 'absolute', top: '50%', left: '15%', right: '15%',
            height: 2, background: 'rgba(88,101,242,0.3)', transform: 'translateY(-50%)',
          }} />
        </div>
      )}

      {/* ── Input nodes ────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: compact ? '6px' : '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
        {validInputs.length === 0 ? (
          <div style={{ ...nodeBase, background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.15)' }}>
            <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.78rem', fontStyle: 'italic' }}>input…</div>
          </div>
        ) : validInputs.map((inp, i) => (
          <React.Fragment key={i}>
            {i > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', color: '#5865F2', fontSize: compact ? '0.9rem' : '1rem', fontWeight: 'bold', paddingTop: compact ? '16px' : '20px' }}>+</div>
            )}
            <div style={{
              ...nodeBase,
              background: 'rgba(88,101,242,0.1)',
              border: '1px solid rgba(88,101,242,0.35)',
              position: 'relative',
            }}>
              {/* Upward connector tick */}
              <div style={{ position: 'absolute', top: -( compact ? 13 : 17), left: '50%', transform: 'translateX(-50%)', width: 2, height: compact ? 13 : 17, background: 'rgba(88,101,242,0.3)' }} />
              <div style={{ color: '#7289da', fontSize: compact ? '0.95rem' : '1rem', fontWeight: 800, lineHeight: 1 }}>{inputQty(inp)}×</div>
              <div style={{ color: '#c9cff8', fontSize: compact ? '0.72rem' : '0.8rem', marginTop: 3, lineHeight: 1.2, wordBreak: 'break-word' }}>{inputName(inp)}</div>
            </div>
          </React.Fragment>
        ))}
      </div>

    </div>
  );
}

// ─── Searchable shard picker ─────────────────────────────────────────────────
function ShardPicker({ value, onChange, shards, placeholder }) {
  const [query, setQuery] = useState(value?.name || '');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    setQuery(value?.name || '');
  }, [value]);

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const filtered = query.length === 0
    ? shards.slice(0, 60)
    : shards.filter(s => s.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(query.toLowerCase().replace(/[^a-z0-9]/g, ''))).slice(0, 60);

  const select = (s) => { onChange(s); setQuery(s.name); setOpen(false); };

  return (
    <div ref={ref} style={{ position: 'relative', flex: 1 }}>
      <div style={{ position: 'relative' }}>
        <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); onChange(null); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'rgba(255,255,255,0.05)', color: '#fff',
            border: `1px solid ${value ? 'rgba(88,101,242,0.7)' : 'rgba(255,255,255,0.1)'}`,
            padding: '8px 8px 8px 30px', borderRadius: '8px', outline: 'none', fontSize: '0.85rem',
          }}
        />
        {value && (
          <button onMouseDown={() => { onChange(null); setQuery(''); }} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}>
            <X size={11} />
          </button>
        )}
      </div>
      {open && filtered.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 9999,
          background: '#1a1b2e', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '10px', maxHeight: '200px', overflowY: 'auto',
          boxShadow: '0 16px 48px rgba(0,0,0,0.7)',
        }}>
          {filtered.map(s => (
            <div key={s.internalId} onMouseDown={() => select(s)}
              style={{ padding: '8px 14px', cursor: 'pointer', fontSize: '0.83rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.03)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(88,101,242,0.18)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ color: '#fff', fontWeight: 500 }}>{s.name}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>×{s.fuseAmount}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Recipe tree card (saved recipe display) ─────────────────────────────────
function RecipeTreeCard({ recipe, index, onDelete, onEdit }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.025)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '16px', overflow: 'hidden',
      transition: 'border-color 0.2s',
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(88,101,242,0.4)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'}
    >
      {/* Card actions bar */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', padding: '8px 10px 0', background: 'rgba(0,0,0,0.1)' }}>
        <button onClick={() => onEdit(recipe, index)} style={{
          background: 'rgba(88,101,242,0.12)', border: '1px solid rgba(88,101,242,0.25)', color: '#a0a8f0',
          padding: '3px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <Pencil size={10} /> Edit
        </button>
        <button onClick={() => onDelete(index)} style={{
          background: 'rgba(218,55,60,0.1)', border: '1px solid rgba(218,55,60,0.25)', color: '#da373c',
          padding: '3px 8px', borderRadius: '6px', cursor: 'pointer',
        }}>
          <Trash2 size={11} />
        </button>
      </div>

      {/* Visual tree */}
      <CraftingTree
        outputName={recipe.outputName}
        qtyYielded={recipe.qtyYielded}
        family={recipe.family}
        inputs={recipe.inputs.map(i => ({ name: i.name, qty: i.qty }))}
        compact
      />
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function CustomRecipeManager({ onClose }) {
  const [shards,    setShards]    = useState([]);
  const [recipes,   setRecipes]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [toast,     setToast]     = useState(null);
  const [filter,    setFilter]    = useState('');
  const [editIndex, setEditIndex] = useState(null);

  // Form state
  const [outputShard, setOutputShard] = useState(null);
  const [qtyYielded,  setQtyYielded]  = useState(2);
  const [inputs,      setInputs]      = useState([
    { shard: null, qty: '' },
    { shard: null, qty: '' },
  ]);

  const flash = (type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    Promise.all([
      axios.get('http://localhost:3000/api/shard-list'),
      axios.get('http://localhost:3000/api/custom-recipes'),
    ]).then(([sl, cr]) => { setShards(sl.data); setRecipes(cr.data); setLoading(false); })
      .catch(() => { flash('error', 'Failed to load data.'); setLoading(false); });
  }, []);

  const refetch = async () => {
    const cr = await axios.get('http://localhost:3000/api/custom-recipes');
    setRecipes(cr.data);
  };

  const resetForm = () => {
    setOutputShard(null); setQtyYielded(2);
    setInputs([{ shard: null, qty: '' }, { shard: null, qty: '' }]);
    setEditIndex(null);
  };

  const handleEdit = (recipe, index) => {
    const outS = shards.find(s => s.internalId === recipe.outputInternalId)
      || { name: recipe.outputName, internalId: recipe.outputInternalId, fuseAmount: 1 };
    setOutputShard(outS);
    setQtyYielded(recipe.qtyYielded);
    setInputs(recipe.inputs.map(inp => ({
      shard: shards.find(s => s.internalId === inp.id)
        || { name: inp.name, internalId: inp.id, fuseAmount: inp.qty },
      qty: String(inp.qty),
    })));
    setEditIndex(index);
    // scroll to top of builder
    document.getElementById('recipe-builder-top')?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSave = async () => {
    if (!outputShard) return flash('error', 'Select an output shard.');
    const validInputs = inputs.filter(i => i.shard && parseInt(i.qty) >= 1);
    if (validInputs.length === 0) return flash('error', 'Add at least one input shard with qty ≥ 1.');

    setSaving(true);
    try {
      if (editIndex !== null) await axios.delete(`http://localhost:3000/api/custom-recipes/${editIndex}`);
      await axios.post('http://localhost:3000/api/custom-recipes', {
        outputInternalId: outputShard.internalId,
        outputName: outputShard.name,
        qtyYielded: parseInt(qtyYielded) || 2,
        family: outputShard.family || 'NONE',
        inputs: validInputs.map(i => ({ id: i.shard.internalId, name: i.shard.name, qty: parseInt(i.qty) })),
      });
      await refetch();
      flash('success', `${editIndex !== null ? 'Updated' : 'Saved'}: ${outputShard.name}`);
      resetForm();
    } catch (e) {
      flash('error', e.response?.data?.error || 'Save failed.');
    }
    setSaving(false);
  };

  const handleDelete = async (index) => {
    try {
      await axios.delete(`http://localhost:3000/api/custom-recipes/${index}`);
      await refetch();
      flash('success', 'Recipe deleted.');
      if (editIndex === index) resetForm();
    } catch { flash('error', 'Delete failed.'); }
  };

  const updateInputShard = (i, val) =>
    setInputs(p => p.map((inp, idx) => idx === i ? { ...inp, shard: val, qty: inp.qty || String(val?.fuseAmount || '') } : inp));
  const updateInputQty = (i, val) =>
    setInputs(p => p.map((inp, idx) => idx === i ? { ...inp, qty: val } : inp));

  const filtered = filter
    ? recipes.filter(r => r.outputName.toLowerCase().includes(filter.toLowerCase())
        || r.inputs.some(i => i.name.toLowerCase().includes(filter.toLowerCase())))
    : recipes;

  // Live preview inputs for CraftingTree
  const previewInputs = inputs.map(i => ({ shard: i.shard, qty: i.qty }));
  const derivedFamily = outputShard?.family || 'NONE';

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'stretch', justifyContent: 'flex-end', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}>
      <div style={{ flex: 1 }} onClick={onClose} />

      <div style={{
        width: '100%', maxWidth: '1100px', height: '100%', display: 'flex', flexDirection: 'column',
        background: '#0f1023', borderLeft: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '-20px 0 80px rgba(0,0,0,0.6)',
        animation: 'slideIn 0.25s ease',
      }}>

        {/* Toast */}
        {toast && (
          <div style={{
            padding: '0.7rem 1.5rem', fontSize: '0.875rem', fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: 8,
            background: toast.type === 'success' ? 'rgba(35,165,89,0.15)' : 'rgba(218,55,60,0.15)',
            borderBottom: `1px solid ${toast.type === 'success' ? 'rgba(35,165,89,0.3)' : 'rgba(218,55,60,0.3)'}`,
            color: toast.type === 'success' ? '#23a559' : '#da373c',
          }}>
            {toast.type === 'success' ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
            {toast.msg}
          </div>
        )}

        {/* Header */}
        <div style={{ padding: '1.25rem 1.75rem', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: 8 }}>
              ⚗️ <span>Recipe Manager</span>
              <span style={{ marginLeft: 6, background: 'rgba(88,101,242,0.15)', border: '1px solid rgba(88,101,242,0.3)', color: '#a0a8f0', padding: '2px 9px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 'normal' }}>
                {recipes.length} recipes
              </span>
            </h2>
            <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '0.8rem' }}>Build crafting trees manually. Only saved recipes are scanned for profit.</p>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted)', padding: '6px', borderRadius: '8px', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        {/* Main split */}
        <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', flex: 1, overflow: 'hidden' }}>

          {/* ── LEFT: Builder ───────────────────────────────────── */}
          <div style={{ borderRight: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
            <div id="recipe-builder-top" style={{ padding: '1.25rem 1.5rem', flex: 1 }}>
              <h3 style={{ margin: '0 0 1.2rem', fontSize: '0.88rem', color: editIndex !== null ? '#fccb0b' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>
                {editIndex !== null ? '✏️ Editing Recipe' : '➕ New Recipe'}
              </h3>

              {/* Output */}
              <div style={{ marginBottom: '1rem' }}>
                <label style={labelStyle}>Output Shard (what you craft)</label>
                <ShardPicker 
                  value={outputShard} 
                  onChange={(s) => {
                    if (!s) {
                      resetForm();
                      return;
                    }
                    setOutputShard(s);
                  }} 
                  shards={shards} 
                  placeholder="Search output shard..." 
                />
              </div>

              {/* Yield */}
              <div style={{ marginBottom: '1rem' }}>
                <label style={labelStyle}>Shards per Craft</label>
                <input type="number" min="1" max="10" value={qtyYielded}
                  onChange={e => setQtyYielded(Math.max(1, parseInt(e.target.value) || 1))}
                  style={inputStyle} />
              </div>

              {/* Input rows */}
              <label style={labelStyle}>Input Shards (what you put in)</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem', marginBottom: '0.75rem' }}>
                {inputs.map((inp, i) => (
                  <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <ShardPicker value={inp.shard} onChange={v => updateInputShard(i, v)} shards={shards} placeholder={`Input shard ${i + 1}…`} />
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', flexShrink: 0 }}>×</span>
                    <input type="number" min="1" max="999" value={inp.qty}
                      onChange={e => updateInputQty(i, e.target.value)}
                      placeholder="qty"
                      style={{ width: '60px', flexShrink: 0, background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', padding: '8px 6px', borderRadius: '8px', outline: 'none', fontSize: '0.85rem', textAlign: 'center' }} />
                    <button onClick={() => setInputs(p => p.filter((_, idx) => idx !== i))} disabled={inputs.length <= 1}
                      style={{ background: 'none', border: 'none', cursor: inputs.length > 1 ? 'pointer' : 'not-allowed', color: inputs.length > 1 ? '#da373c' : 'rgba(255,255,255,0.1)', padding: 4, flexShrink: 0 }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1.25rem' }}>
                <button onClick={() => setInputs(p => [...p, { shard: null, qty: '' }])} style={{ background: 'none', border: '1px dashed rgba(255,255,255,0.18)', color: 'var(--text-muted)', padding: '6px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Plus size={12} /> Add Input
                </button>
                {editIndex !== null && (
                  <button onClick={resetForm} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.82rem', textDecoration: 'underline' }}>
                    Cancel
                  </button>
                )}
              </div>

              <button onClick={handleSave} disabled={saving || !outputShard} style={{
                width: '100%', background: !outputShard ? 'rgba(88,101,242,0.25)' : 'var(--accent-primary)',
                color: 'white', border: 'none', padding: '10px', borderRadius: '10px',
                cursor: !outputShard ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: '0.9rem',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, transition: 'background 0.2s',
              }}>
                <Save size={15} /> {saving ? 'Saving…' : editIndex !== null ? 'Update Recipe' : 'Save Recipe'}
              </button>
            </div>

            {/* Live Preview */}
            {(outputShard || inputs.some(i => i.shard)) && (
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', background: 'rgba(0,0,0,0.2)', padding: '0.75rem 1rem 1rem' }}>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Live Preview</div>
                <CraftingTree
                  outputShard={outputShard}
                  qtyYielded={qtyYielded}
                  family={derivedFamily}
                  inputs={previewInputs}
                  compact
                />
              </div>
            )}
          </div>

          {/* ── RIGHT: Saved Recipes Grid ────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Filter bar */}
            <div style={{ padding: '1rem 1.5rem 0.75rem', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
              <div style={{ position: 'relative' }}>
                <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="text" placeholder="Filter recipes by shard name…" value={filter}
                  onChange={e => setFilter(e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.04)', color: '#fff', border: '1px solid rgba(255,255,255,0.09)', padding: '8px 12px 8px 30px', borderRadius: '8px', outline: 'none', fontSize: '0.85rem' }}
                />
              </div>
            </div>

            {/* Cards grid */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem' }}>
              {loading && <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '4rem' }}>Loading…</p>}

              {!loading && recipes.length === 0 && (
                <div style={{ textAlign: 'center', paddingTop: '5rem', color: 'var(--text-muted)' }}>
                  <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚗️</div>
                  <div style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.5rem', color: '#fff' }}>No recipes saved yet</div>
                  <div style={{ fontSize: '0.83rem' }}>Use the builder on the left to add your first crafting recipe.</div>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1rem' }}>
                {filtered.map((rec, idx) => {
                  const realIdx = recipes.indexOf(rec);
                  return (
                    <RecipeTreeCard key={realIdx} recipe={rec} index={realIdx} onDelete={handleDelete} onEdit={handleEdit} />
                  );
                })}
              </div>

              {filter && filtered.length === 0 && (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '3rem', fontSize: '0.85rem' }}>
                  No recipes match "{filter}"
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(50px); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}

const labelStyle = {
  display: 'block', color: 'rgba(255,255,255,0.45)', fontSize: '0.74rem',
  marginBottom: 5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
};

const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  background: 'rgba(255,255,255,0.05)', color: '#fff',
  border: '1px solid rgba(255,255,255,0.1)', padding: '8px 12px',
  borderRadius: '8px', outline: 'none', fontSize: '0.875rem',
};
