import { useEffect, useState } from 'react';
import { fetchBazaar } from '../services/api';

const formatCoins = (num) => {
  if (!num) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
  return num.toFixed(1);
};

export default function ShardFusionFlipper() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [topCount, setTopCount] = useState(50);
  const [sortBy, setSortBy] = useState('name');

  useEffect(() => {
    const loadData = async () => {
      try {
        const rows = await fetchBazaar();
        
        // Filter out shards
        const shards = rows.filter(item => item.productId.includes('KUUDRA') || item.productId.includes('SHARD') || item.productId.includes('ATTRIBUTE'))
        // If there are none from Hypixel raw bazaar matching this explicitly, just show all data that looks magical to prove framework.
        // Skyblock attributes are complicated. Kuudra attributes are technically attached to items or books.
        // We'll just display a placeholder UI populated with some base bazaar materials commonly used for Kuudra/Fusions.
                         
        if (shards.length === 0) {
          // If no explicitly named 'shard' products exist on Bazaar (Bazaar has ENCHANTED_ items, Essences, etc)
          // we'll filter for Essence or fragments commonly used in fusions.
          setData(rows.filter(i => i.productId.includes('ESSENCE') || i.productId.includes('FRAGMENT')));
        } else {
          setData(shards);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    
    loadData();
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  }, []);

  if (loading && data.length === 0) return <div className="loader-container"><div className="loader"></div><p>Fetching base fusion materials...</p></div>;
  if (error) return <div className="glass-card text-danger">Error fetching fusion data: {error}</div>;

  const sortedData = [...data].sort((a, b) => {
    if (sortBy === 'name') return a.productId.localeCompare(b.productId);
    if (sortBy === 'price_highest') return b.sellPrice - a.sellPrice;
    if (sortBy === 'volume_highest') return (b.buyVolume + b.sellVolume) - (a.buyVolume + a.sellVolume);
    return 0;
  });
  
  const displayData = sortedData.slice(0, topCount);

  return (
    <div className="glass-card animate-fade-in">
      <div className="flex-between" style={{ marginBottom: '1rem' }}>
        <h2>Shard Fusion Calculator</h2>
        <span className="text-muted text-sm">Base Materials pricing (Recipes pending)</span>
      </div>
      
      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', marginBottom: '1.5rem', background: 'var(--glass-bg)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
        <div>
          <label style={{ marginRight: '0.5rem', color: 'var(--text-muted)' }}>Sort By:</label>
          <select 
            value={sortBy} 
            onChange={(e) => setSortBy(e.target.value)}
            style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.5rem', borderRadius: '8px', outline: 'none', cursor: 'pointer' }}
          >
            <option value="name" style={{background: 'var(--glass-bg)'}}>Item Name</option>
            <option value="price_highest" style={{background: 'var(--glass-bg)'}}>Highest Price</option>
            <option value="volume_highest" style={{background: 'var(--glass-bg)'}}>Highest Volume</option>
          </select>
        </div>
        <div>
          <label style={{ marginRight: '0.5rem', color: 'var(--text-muted)' }}>Show Top:</label>
          <input 
            type="number" 
            value={topCount} 
            onChange={(e) => setTopCount(Number(e.target.value) || 1)}
            min="1" max="500"
            style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.5rem', borderRadius: '8px', width: '80px', outline: 'none' }}
          />
        </div>
      </div>
      
      <div className="glass-card text-warning" style={{ background: 'rgba(245, 158, 11, 0.1)', borderColor: 'rgba(245, 158, 11, 0.3)', marginBottom: '1.5rem' }}>
        <strong>Note:</strong> This is the MVP interface. Currently displaying base material/essence pricing from the Bazaar. 
        Once recipe extraction is implemented, this tab will calculate multi-step fusion margins.
      </div>
      
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Material Element ID</th>
              <th>Current Market Value (Insta-Buy)</th>
              <th>Current Market Value (Insta-Sell)</th>
              <th>Volume (B/S)</th>
            </tr>
          </thead>
          <tbody>
            {displayData.map((item) => (
              <tr key={item.productId}>
                <td className="item-name" style={{ color: 'var(--accent-secondary)' }}>
                  {item.productId.replace(/_/g, ' ')}
                </td>
                <td>{formatCoins(item.buyPrice)}</td>
                <td>{formatCoins(item.sellPrice)}</td>
                <td className="text-muted">{formatCoins(item.buyVolume)} / {formatCoins(item.sellVolume)}</td>
              </tr>
            ))}
            {data.length === 0 && (
              <tr><td colSpan="4" style={{textAlign: 'center'}}>No fusion-related materials found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
