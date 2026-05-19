import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { ChevronDown, ChevronRight, Pencil, Plus, Save, Search, Trash2, X } from 'lucide-react';
import { API_URL } from '../services/api';

const emptyForm = {
  id: null,
  shardId: '',
  shardName: '',
  location: '',
  baseShardsPerHour: '',
  userFortune: '',
  userShardsPerHour: '',
  setup: '',
  steps: '',
  notes: '',
  source: '',
  tagsText: '',
};

const fieldStyle = {
  background: 'rgba(255,255,255,0.05)',
  color: 'var(--text-primary)',
  border: '1px solid var(--glass-border)',
  padding: '0.65rem',
  borderRadius: '8px',
  outline: 'none',
  width: '100%',
};

const formatCoins = (num) => {
  const value = Number(num || 0);
  if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(2)}M`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return Math.round(value).toLocaleString();
};

function GuideText({ label, value }) {
  if (!value) return null;
  return (
    <div>
      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.35rem', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{value}</div>
    </div>
  );
}

function GuideCard({ guide, open, onToggle, onEdit, onDelete }) {
  return (
    <div style={{ border: '1px solid var(--glass-border)', borderRadius: '8px', background: 'rgba(255,255,255,0.025)', overflow: 'hidden' }}>
      <button
        onClick={onToggle}
        style={{ width: '100%', background: 'transparent', border: 'none', color: 'var(--text-primary)', padding: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', textAlign: 'left' }}
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800 }}>{guide.shardName || guide.shardId}</div>
          <div className="text-muted text-sm">{guide.location || 'No location added'}{guide.source ? ` - ${guide.source}` : ''}</div>
        </div>
        {guide.tags?.length > 0 && (
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 320 }}>
            {guide.tags.slice(0, 4).map((tag) => (
              <span key={tag} style={{ fontSize: '0.72rem', color: '#a0a8f0', border: '1px solid rgba(88,101,242,0.35)', borderRadius: 999, padding: '2px 8px', background: 'rgba(88,101,242,0.12)' }}>{tag}</span>
            ))}
          </div>
        )}
      </button>
      {open && (
        <div style={{ padding: '0 1rem 1rem', display: 'grid', gap: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button className="btn" onClick={onEdit} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.45rem 0.75rem' }}><Pencil size={14} /> Edit</button>
            <button className="btn" onClick={onDelete} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.45rem 0.75rem', background: 'rgba(218,55,60,0.18)', color: '#ff8f94' }}><Trash2 size={14} /> Delete</button>
          </div>
          <GuideText label="Location" value={guide.location} />
          {(guide.userShardsPerHour || guide.baseShardsPerHour || guide.userFortune) && (
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.35rem', textTransform: 'uppercase' }}>Rates</div>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                {guide.baseShardsPerHour ? <span>Base: {Number(guide.baseShardsPerHour).toLocaleString()}/hr</span> : null}
                {guide.userFortune ? <span>Fortune: {Number(guide.userFortune).toLocaleString()}</span> : null}
                {guide.userShardsPerHour ? <span>Your rate: {Number(guide.userShardsPerHour).toLocaleString()}/hr</span> : null}
              </div>
            </div>
          )}
          {guide.userShardsPerHour > 0 && (guide.shardPrices?.instasell > 0 || guide.shardPrices?.sellOrder > 0) && (
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.35rem', textTransform: 'uppercase' }}>Live Shard Profit / Hour</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(180px, 1fr))', gap: '0.75rem' }}>
                <div style={{ border: '1px solid var(--glass-border)', borderRadius: 8, padding: '0.75rem', background: 'rgba(255,255,255,0.03)' }}>
                  <div className="text-muted text-sm">Instasell @ {formatCoins(guide.shardPrices?.instasell)}</div>
                  <div className="text-success" style={{ fontWeight: 800 }}>{formatCoins(guide.huntingProfitPerHour?.instasell)}/hr</div>
                  {guide.baseShardsPerHour > 0 && <div className="text-muted text-sm">Base: {formatCoins(guide.huntingProfitPerHour?.baseInstasell)}/hr</div>}
                </div>
                <div style={{ border: '1px solid var(--glass-border)', borderRadius: 8, padding: '0.75rem', background: 'rgba(255,255,255,0.03)' }}>
                  <div className="text-muted text-sm">Sell Order @ {formatCoins(guide.shardPrices?.sellOrder)}</div>
                  <div className="text-success" style={{ fontWeight: 800 }}>{formatCoins(guide.huntingProfitPerHour?.sellOrder)}/hr</div>
                  {guide.baseShardsPerHour > 0 && <div className="text-muted text-sm">Base: {formatCoins(guide.huntingProfitPerHour?.baseSellOrder)}/hr</div>}
                </div>
              </div>
            </div>
          )}
          <GuideText label="Setup" value={guide.setup} />
          <GuideText label="Steps" value={guide.steps} />
          <GuideText label="Notes" value={guide.notes} />
          {guide.source && (
            <div className="text-muted text-sm">
              Source: {guide.source.startsWith('http') ? <a href={guide.source} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-primary)' }}>{guide.source}</a> : guide.source}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function HuntingGuide() {
  const [guides, setGuides] = useState([]);
  const [shards, setShards] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchData = async () => {
    setError('');
    try {
      const [guideRes, shardRes] = await Promise.all([
        axios.get(`${API_URL}/hunting-guides`),
        axios.get(`${API_URL}/shard-list`),
      ]);
      setGuides(guideRes.data || []);
      setShards(shardRes.data || []);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const filteredGuides = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return guides;
    return guides.filter((guide) => (
      guide.shardName?.toLowerCase().includes(q)
      || guide.shardId?.toLowerCase().includes(q)
      || guide.location?.toLowerCase().includes(q)
      || guide.tags?.some((tag) => tag.toLowerCase().includes(q))
    ));
  }, [guides, search]);

  const selectedShard = shards.find((shard) => shard.internalId === form.shardId);

  const updateForm = (patch) => setForm((current) => ({ ...current, ...patch }));

  const resetForm = () => setForm(emptyForm);

  const submitGuide = async (event) => {
    event.preventDefault();
    if (!form.shardId) {
      setError('Pick a shard before saving the guide.');
      return;
    }
    setSaving(true);
    setError('');
    const payload = {
      shardId: form.shardId,
      shardName: form.shardName || selectedShard?.name || form.shardId,
      location: form.location,
      setup: form.setup,
      steps: form.steps,
      notes: form.notes,
      source: form.source,
      baseShardsPerHour: Number(form.baseShardsPerHour || 0),
      userFortune: Number(form.userFortune || 0),
      userShardsPerHour: Number(form.userShardsPerHour || 0),
      tags: form.tagsText.split(',').map((tag) => tag.trim()).filter(Boolean),
    };

    try {
      if (form.id) await axios.put(`${API_URL}/hunting-guides/${form.id}`, payload);
      else await axios.post(`${API_URL}/hunting-guides`, payload);
      resetForm();
      await fetchData();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  const editGuide = (guide) => {
    setForm({
      id: guide.id,
      shardId: guide.shardId,
      shardName: guide.shardName,
      location: guide.location || '',
      baseShardsPerHour: guide.baseShardsPerHour || '',
      userFortune: guide.userFortune || '',
      userShardsPerHour: guide.userShardsPerHour || '',
      setup: guide.setup || '',
      steps: guide.steps || '',
      notes: guide.notes || '',
      source: guide.source || '',
      tagsText: (guide.tags || []).join(', '),
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const deleteGuide = async (guide) => {
    if (!window.confirm(`Delete guide for ${guide.shardName || guide.shardId}?`)) return;
    await axios.delete(`${API_URL}/hunting-guides/${guide.id}`);
    await fetchData();
  };

  return (
    <div className="glass-card animate-fade-in" style={{ display: 'grid', gap: '1.25rem' }}>
      <div className="flex-between" style={{ gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2>Hunting Guide</h2>
          <span className="text-muted text-sm">Save shard hunting notes, routes, sources, and setups as expandable guide cards.</span>
        </div>
        <div style={{ position: 'relative', minWidth: 260 }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search guides..." style={{ ...fieldStyle, paddingLeft: 34 }} />
        </div>
      </div>

      {error && <div className="text-danger" style={{ background: 'rgba(218,55,60,0.12)', border: '1px solid rgba(218,55,60,0.3)', borderRadius: 8, padding: '0.75rem 1rem' }}>{error}</div>}

      <form onSubmit={submitGuide} style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: 12, padding: '1rem', display: 'grid', gap: '1rem' }}>
        <div className="flex-between" style={{ gap: '1rem', flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>{form.id ? 'Edit Guide' : 'Add Guide'}</h3>
          {form.id && <button type="button" onClick={resetForm} className="btn" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><X size={14} /> Cancel Edit</button>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) minmax(220px, 1fr)', gap: '1rem' }}>
          <label style={{ color: 'var(--text-muted)' }}>
            Shard
            <select value={form.shardId} onChange={(event) => {
              const shard = shards.find((entry) => entry.internalId === event.target.value);
              updateForm({ shardId: event.target.value, shardName: shard?.name || '' });
            }} style={{ ...fieldStyle, marginTop: '0.4rem' }}>
              <option value="">Pick a shard...</option>
              {shards.map((shard) => <option key={shard.internalId} value={shard.internalId}>{shard.name}</option>)}
            </select>
          </label>
          <label style={{ color: 'var(--text-muted)' }}>
            Location / Biome
            <input value={form.location} onChange={(event) => updateForm({ location: event.target.value })} placeholder="e.g. Crimson Isle, Crystal Hollows..." style={{ ...fieldStyle, marginTop: '0.4rem' }} />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(160px, 1fr))', gap: '1rem' }}>
          <label style={{ color: 'var(--text-muted)' }}>
            Base Shards / Hour
            <input type="number" value={form.baseShardsPerHour} onChange={(event) => updateForm({ baseShardsPerHour: event.target.value })} placeholder="700" style={{ ...fieldStyle, marginTop: '0.4rem' }} />
          </label>
          <label style={{ color: 'var(--text-muted)' }}>
            Your Fortune
            <input type="number" value={form.userFortune} onChange={(event) => updateForm({ userFortune: event.target.value })} placeholder="107" style={{ ...fieldStyle, marginTop: '0.4rem' }} />
          </label>
          <label style={{ color: 'var(--text-muted)' }}>
            Your Shards / Hour
            <input type="number" value={form.userShardsPerHour} onChange={(event) => updateForm({ userShardsPerHour: event.target.value })} placeholder="1593" style={{ ...fieldStyle, marginTop: '0.4rem' }} />
          </label>
        </div>

        <label style={{ color: 'var(--text-muted)' }}>
          Setup
          <textarea value={form.setup} onChange={(event) => updateForm({ setup: event.target.value })} placeholder="Gear, pet, enchants, bait, lobby requirements..." rows={3} style={{ ...fieldStyle, marginTop: '0.4rem', resize: 'vertical' }} />
        </label>
        <label style={{ color: 'var(--text-muted)' }}>
          Guide Steps
          <textarea value={form.steps} onChange={(event) => updateForm({ steps: event.target.value })} placeholder="Paste the route, spawn conditions, method, and important details here." rows={7} style={{ ...fieldStyle, marginTop: '0.4rem', resize: 'vertical' }} />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) minmax(220px, 1fr)', gap: '1rem' }}>
          <label style={{ color: 'var(--text-muted)' }}>
            Source
            <input value={form.source} onChange={(event) => updateForm({ source: event.target.value })} placeholder="Guide author, Discord, YouTube, URL..." style={{ ...fieldStyle, marginTop: '0.4rem' }} />
          </label>
          <label style={{ color: 'var(--text-muted)' }}>
            Tags
            <input value={form.tagsText} onChange={(event) => updateForm({ tagsText: event.target.value })} placeholder="fishing, combat, rare, painful..." style={{ ...fieldStyle, marginTop: '0.4rem' }} />
          </label>
        </div>
        <label style={{ color: 'var(--text-muted)' }}>
          Notes
          <textarea value={form.notes} onChange={(event) => updateForm({ notes: event.target.value })} placeholder="Your personal reminders, rates, gotchas, or corrections." rows={3} style={{ ...fieldStyle, marginTop: '0.4rem', resize: 'vertical' }} />
        </label>

        <button type="submit" disabled={saving} className="btn" style={{ justifySelf: 'start', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--accent-primary)', color: '#000', fontWeight: 800 }}>
          {form.id ? <Save size={16} /> : <Plus size={16} />}
          {saving ? 'Saving...' : form.id ? 'Save Guide' : 'Add Guide'}
        </button>
      </form>

      <div style={{ display: 'grid', gap: '0.75rem' }}>
        <div className="text-muted text-sm">Showing {filteredGuides.length} saved guide{filteredGuides.length === 1 ? '' : 's'}</div>
        {filteredGuides.map((guide) => (
          <GuideCard
            key={guide.id}
            guide={guide}
            open={openId === guide.id}
            onToggle={() => setOpenId(openId === guide.id ? null : guide.id)}
            onEdit={() => editGuide(guide)}
            onDelete={() => deleteGuide(guide)}
          />
        ))}
        {filteredGuides.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem', border: '1px dashed var(--glass-border)', borderRadius: 8 }}>
            No hunting guides yet. Pick a shard above and add your first one.
          </div>
        )}
      </div>
    </div>
  );
}
