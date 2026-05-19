import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { ChevronDown, ChevronRight, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { API_URL } from '../services/api';

const fieldStyle = {
  background: 'rgba(255,255,255,0.05)',
  color: 'var(--text-primary)',
  border: '1px solid var(--glass-border)',
  padding: '0.65rem',
  borderRadius: '8px',
  outline: 'none',
  width: '100%',
};

const emptyForm = {
  id: '',
  title: '',
  category: 'General Investing',
  summary: '',
  rulesText: '',
  examples: '',
  risk: '',
  source: '',
  tagsText: '',
};

export default function InvestmentStrategies() {
  const [strategies, setStrategies] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [openId, setOpenId] = useState('cyclical_investing_strategy');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    try {
      setError('');
      const res = await axios.get(`${API_URL}/investment-strategies`);
      setStrategies(res.data || []);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return strategies;
    return strategies.filter((strategy) => (
      strategy.title?.toLowerCase().includes(q)
      || strategy.category?.toLowerCase().includes(q)
      || strategy.tags?.some((tag) => tag.toLowerCase().includes(q))
    ));
  }, [strategies, query]);

  const reset = () => setForm(emptyForm);

  const save = async (event) => {
    event.preventDefault();
    const payload = {
      title: form.title,
      category: form.category,
      summary: form.summary,
      rules: form.rulesText.split('\n').map((line) => line.trim()).filter(Boolean),
      examples: form.examples,
      risk: form.risk,
      source: form.source,
      tags: form.tagsText.split(',').map((tag) => tag.trim()).filter(Boolean),
    };
    try {
      if (form.id) await axios.put(`${API_URL}/investment-strategies/${form.id}`, payload);
      else await axios.post(`${API_URL}/investment-strategies`, payload);
      reset();
      await load();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const edit = (strategy) => {
    setForm({
      id: strategy.id,
      title: strategy.title || '',
      category: strategy.category || 'General Investing',
      summary: strategy.summary || '',
      rulesText: (strategy.rules || []).join('\n'),
      examples: strategy.examples || '',
      risk: strategy.risk || '',
      source: strategy.source || '',
      tagsText: (strategy.tags || []).join(', '),
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const remove = async (strategy) => {
    if (!window.confirm(`Delete ${strategy.title}?`)) return;
    await axios.delete(`${API_URL}/investment-strategies/${strategy.id}`);
    await load();
  };

  return (
    <div className="glass-card animate-fade-in" style={{ display: 'grid', gap: '1.25rem' }}>
      <div className="flex-between" style={{ gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2>Investment Strategies</h2>
          <span className="text-muted text-sm">Store repeatable investing playbooks, source notes, and risk rules.</span>
        </div>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search strategies..." style={{ ...fieldStyle, maxWidth: 260 }} />
      </div>

      {error && <div className="text-danger">{error}</div>}

      <form onSubmit={save} style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: 12, padding: '1rem', display: 'grid', gap: '1rem' }}>
        <div className="flex-between" style={{ gap: '1rem', flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>{form.id ? 'Edit Strategy' : 'Add Strategy'}</h3>
          {form.id && <button type="button" className="btn" onClick={reset} style={{ display: 'flex', gap: 6, alignItems: 'center' }}><X size={14} /> Cancel</button>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) minmax(180px, 0.55fr)', gap: '1rem' }}>
          <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Strategy title" style={fieldStyle} />
          <input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="Category" style={fieldStyle} />
        </div>
        <textarea value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} placeholder="Short strategy summary" rows={3} style={{ ...fieldStyle, resize: 'vertical' }} />
        <textarea value={form.rulesText} onChange={(event) => setForm({ ...form, rulesText: event.target.value })} placeholder="Rules, one per line" rows={5} style={{ ...fieldStyle, resize: 'vertical' }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <textarea value={form.examples} onChange={(event) => setForm({ ...form, examples: event.target.value })} placeholder="Examples" rows={3} style={{ ...fieldStyle, resize: 'vertical' }} />
          <textarea value={form.risk} onChange={(event) => setForm({ ...form, risk: event.target.value })} placeholder="Risks" rows={3} style={{ ...fieldStyle, resize: 'vertical' }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <input value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} placeholder="Source" style={fieldStyle} />
          <input value={form.tagsText} onChange={(event) => setForm({ ...form, tagsText: event.target.value })} placeholder="Tags, comma separated" style={fieldStyle} />
        </div>
        <button type="submit" className="btn" style={{ justifySelf: 'start', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--accent-primary)', color: '#000', fontWeight: 800 }}>
          {form.id ? <Save size={16} /> : <Plus size={16} />} {form.id ? 'Save Strategy' : 'Add Strategy'}
        </button>
      </form>

      <div style={{ display: 'grid', gap: '0.75rem' }}>
        {filtered.map((strategy) => {
          const open = openId === strategy.id;
          return (
            <div key={strategy.id} style={{ border: '1px solid var(--glass-border)', borderRadius: 8, background: 'rgba(255,255,255,0.025)', overflow: 'hidden' }}>
              <button onClick={() => setOpenId(open ? null : strategy.id)} style={{ width: '100%', padding: '1rem', background: 'transparent', border: 'none', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', textAlign: 'left' }}>
                {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800 }}>{strategy.title}</div>
                  <div className="text-muted text-sm">{strategy.category}</div>
                </div>
              </button>
              {open && (
                <div style={{ padding: '0 1rem 1rem', display: 'grid', gap: '0.85rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                    <button className="btn" onClick={() => edit(strategy)} style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Pencil size={14} /> Edit</button>
                    <button className="btn" onClick={() => remove(strategy)} style={{ display: 'flex', gap: 6, alignItems: 'center', background: 'rgba(218,55,60,0.18)', color: '#ff8f94' }}><Trash2 size={14} /> Delete</button>
                  </div>
                  {strategy.summary && <div>{strategy.summary}</div>}
                  {strategy.rules?.length > 0 && <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>{strategy.rules.map((rule, index) => <li key={index}>{rule}</li>)}</ul>}
                  {strategy.examples && <div><strong>Examples:</strong> {strategy.examples}</div>}
                  {strategy.risk && <div><strong>Risk:</strong> {strategy.risk}</div>}
                  {strategy.source && <div className="text-muted text-sm">Source: {strategy.source}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
