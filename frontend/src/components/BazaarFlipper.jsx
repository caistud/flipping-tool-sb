import { useEffect, useState } from 'react';
import { fetchBazaar } from '../services/api';

const formatCoins = (num) => {
  if (!num) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
  return num.toFixed(1);
};

export default function BazaarFlipper() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [topCount, setTopCount] = useState(50);
  const [sortBy, setSortBy] = useState('profit');

  useEffect(() => {
    const loadData = async () => {
      try {
        const rows = await fetchBazaar();
        
        // Calculate margins
        const processed = rows.map(item => {
          const profit = item.buyPrice - item.sellPrice;
          const margin = item.sellPrice > 0 ? (profit / item.sellPrice) * 100 : 0;
          return { ...item, profit, margin };
        })
        // Filter out extremely low volume to avoid garbage items
        .filter(i => i.buyVolume > 10000 && i.sellVolume > 10000 && i.margin > 2 && i.sellPrice > 100)
        // Sort by highest profit per item
        .sort((a, b) => b.profit - a.profit);

        setData(processed);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    
    loadData();
    // Poll local DB every 10s
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading && data.length === 0) return <div className="loader-container"><div className="loader"></div><p>Syncing market data...</p></div>;
  if (error) return <div className="glass-card text-danger">Error fetching bazaar data: {error}</div>;

  const sortedData = [...data].sort((a, b) => {
    if (sortBy === 'profit') return b.profit - a.profit;
    if (sortBy === 'margin') return b.margin - a.margin;
    if (sortBy === 'volume') return (b.buyVolume + b.sellVolume) - (a.buyVolume + a.sellVolume);
    return 0;
  });
  
  const displayData = sortedData.slice(0, topCount);

  return (
    <div className="glass-card animate-fade-in">
      <div className="flex-between" style={{ marginBottom: '1rem' }}>
        <h2>Bazaar Flip Opportunities</h2>
        <span className="text-muted text-sm">Updates every 10s locally (Syncs with Hypixel every 60s)</span>
      </div>
      
      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', marginBottom: '1.5rem', background: 'var(--glass-bg)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
        <div>
          <label style={{ marginRight: '0.5rem', color: 'var(--text-muted)' }}>Sort By:</label>
          <select 
            value={sortBy} 
            onChange={(e) => setSortBy(e.target.value)}
            style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.5rem', borderRadius: '8px', outline: 'none', cursor: 'pointer' }}
          >
            <option value="profit" style={{background: 'var(--glass-bg)'}}>Highest Profit</option>
            <option value="margin" style={{background: 'var(--glass-bg)'}}>Highest Margin</option>
            <option value="volume" style={{background: 'var(--glass-bg)'}}>Highest Volume</option>
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

      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Item ID</th>
              <th>Insta-Sell (Cost to Set Buy Order)</th>
              <th>Insta-Buy (Earn from Sell Order)</th>
              <th>Profit / Item</th>
              <th>Margin</th>
              <th>Volume (B/S)</th>
            </tr>
          </thead>
          <tbody>
            {displayData.map((item) => (
              <tr key={item.productId}>
                <td className="item-name">{item.productId.replace(/_/g, ' ')}</td>
                <td>{formatCoins(item.sellPrice)}</td>
                <td>{formatCoins(item.buyPrice)}</td>
                <td className="text-success">+{formatCoins(item.profit)}</td>
                <td className="text-warning">{item.margin.toFixed(1)}%</td>
                <td className="text-muted">{formatCoins(item.buyVolume)} / {formatCoins(item.sellVolume)}</td>
              </tr>
            ))}
            {data.length === 0 && (
              <tr><td colSpan="6" style={{textAlign: 'center'}}>No profitable flips found right now.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
