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
  const [minMargin, setMinMargin] = useState(0);
  const [minProfit, setMinProfit] = useState(0);
  const [minVolume, setMinVolume] = useState(0);
  const [minCost, setMinCost] = useState(0);
  const [flipMode, setFlipMode] = useState('bz_bo_so');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const loadData = async () => {
      try {
        const rows = await fetchBazaar();
        // Calculate all margin paths
        const processed = rows.map(item => {
          // bz_bo_so (Buy Order -> Sell Offer // Arbitrage)
          const bo_so_Profit = item.buyPrice - item.sellPrice;
          const bo_so_Margin = item.sellPrice > 0 ? (bo_so_Profit / item.sellPrice) * 100 : 0;
          
          // bz_ib_so (Insta-Buy -> Sell Offer)
          const ib_so_Profit = item.buyPrice - item.buyPrice;
          const ib_so_Margin = item.buyPrice > 0 ? (ib_so_Profit / item.buyPrice) * 100 : 0;
          
          // bz_ib_is (Insta-Buy -> Insta-Sell)
          const ib_is_Profit = item.sellPrice - item.buyPrice;
          const ib_is_Margin = item.buyPrice > 0 ? (ib_is_Profit / item.buyPrice) * 100 : 0;
          
          // bz_bo_is (Buy Order -> Insta-Sell)
          const bo_is_Profit = item.sellPrice - item.sellPrice;
          const bo_is_Margin = item.sellPrice > 0 ? (bo_is_Profit / item.sellPrice) * 100 : 0;
          
          const npcInstaProfit = (item.npc_sell_price || 0) - item.buyPrice;
          const npcInstaMargin = item.buyPrice > 0 ? (npcInstaProfit / item.buyPrice) * 100 : 0;
          
          const npcOrderProfit = (item.npc_sell_price || 0) - item.sellPrice;
          const npcOrderMargin = item.sellPrice > 0 ? (npcOrderProfit / item.sellPrice) * 100 : 0;

          return { ...item, bo_so_Profit, bo_so_Margin, ib_so_Profit, ib_so_Margin, ib_is_Profit, ib_is_Margin, bo_is_Profit, bo_is_Margin, npcInstaProfit, npcInstaMargin, npcOrderProfit, npcOrderMargin };
        });

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
  }, [refreshTrigger]);

  if (loading && data.length === 0) return <div className="loader-container"><div className="loader"></div><p>Syncing market data...</p></div>;
  if (error) return <div className="glass-card text-danger">Error fetching bazaar data: {error}</div>;

  const sortedData = [...data]
    .map(item => {
      let profit = 0;
      let margin = 0;
      let cost = 0;
      let revenue = 0;
      
      if (flipMode === 'bz_bo_so') {
        profit = item.bo_so_Profit;
        margin = item.bo_so_Margin;
        cost = item.sellPrice;
        revenue = item.buyPrice;
      } else if (flipMode === 'bz_ib_so') {
        profit = item.ib_so_Profit;
        margin = item.ib_so_Margin;
        cost = item.buyPrice;
        revenue = item.buyPrice;
      } else if (flipMode === 'bz_ib_is') {
        profit = item.ib_is_Profit;
        margin = item.ib_is_Margin;
        cost = item.buyPrice;
        revenue = item.sellPrice;
      } else if (flipMode === 'bz_bo_is') {
        profit = item.bo_is_Profit;
        margin = item.bo_is_Margin;
        cost = item.sellPrice;
        revenue = item.sellPrice;
      } else if (flipMode === 'npc_insta') {
        profit = item.npcInstaProfit;
        margin = item.npcInstaMargin;
        cost = item.buyPrice;
        revenue = item.npc_sell_price || 0;
      } else if (flipMode === 'npc_order') {
        profit = item.npcOrderProfit;
        margin = item.npcOrderMargin;
        cost = item.sellPrice;
        revenue = item.npc_sell_price || 0;
      }
      return { ...item, displayProfit: profit, displayMargin: margin, displayCost: cost, displayRevenue: revenue };
    })
    .filter(a => {
      if (searchQuery && !a.productId.toLowerCase().replace(/_/g, ' ').includes(searchQuery.toLowerCase())) return false;
      
      // Filter out items that have no sell orders or buy orders.
      // (a item with 0 price or 0 volume is impossible to interact with in-game)
      if (a.buyPrice <= 0 || a.sellPrice <= 0) return false;
      if (a.buyVolume <= 0 || a.sellVolume <= 0) return false;
      
      const combinedVolume = Number(a.buyVolume) + Number(a.sellVolume);
      if (combinedVolume < minVolume) return false;
      
      if (a.displayCost < Number(minCost)) return false;
      if (a.displayMargin < Number(minMargin)) return false;
      if (a.displayProfit < Number(minProfit)) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'profit') return b.displayProfit - a.displayProfit;
      if (sortBy === 'margin') return b.displayMargin - a.displayMargin;
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
      
      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', marginBottom: '1.5rem', background: 'var(--glass-bg)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--glass-border)', flexWrap: 'wrap' }}>
        <div>
          <label style={{ marginRight: '0.5rem', color: 'var(--text-muted)' }}>Flip Strategy:</label>
          <select 
            value={flipMode} 
            onChange={(e) => setFlipMode(e.target.value)}
            style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--accent-secondary)', border: '1px solid var(--glass-border)', padding: '0.5rem', borderRadius: '8px', outline: 'none', cursor: 'pointer', fontWeight: 'bold' }}
          >
            <option value="bz_bo_so" style={{background: 'var(--glass-bg)'}}>Buy Order -&gt; Sell Order</option>
            <option value="bz_ib_so" style={{background: 'var(--glass-bg)'}}>Insta-Buy -&gt; Sell Order</option>
            <option value="bz_ib_is" style={{background: 'var(--glass-bg)'}}>Insta-Buy -&gt; Insta-Sell</option>
            <option value="bz_bo_is" style={{background: 'var(--glass-bg)'}}>Buy Order -&gt; Insta-Sell</option>
            <option value="npc_insta" style={{background: 'var(--glass-bg)'}}>Insta-Buy -&gt; NPC (Fast)</option>
            <option value="npc_order" style={{background: 'var(--glass-bg)'}}>Buy Order -&gt; NPC (Patient)</option>
          </select>
        </div>
        
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
            onChange={(e) => setTopCount(e.target.value === '' ? '' : Number(e.target.value))}
            min="1" max="500"
            style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.5rem', borderRadius: '8px', width: '80px', outline: 'none' }}
          />
        </div>
        
        <div>
          <label style={{ marginRight: '0.5rem', color: 'var(--text-muted)' }}>Search:</label>
          <input 
            type="text" 
            placeholder="Item name..."
            value={searchQuery} 
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.5rem', borderRadius: '8px', width: '140px', outline: 'none' }}
          />
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginLeft: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <label style={{ marginRight: '0.4rem', color: 'var(--text-warning)', fontSize: '0.9rem' }}>Min %:</label>
            <input 
              type="number" 
              value={minMargin} 
              onChange={(e) => setMinMargin(e.target.value === '' ? '' : Number(e.target.value))}
              style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--text-warning)', padding: '0.4rem', borderRadius: '8px', width: '60px', outline: 'none' }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <label style={{ marginRight: '0.4rem', color: 'var(--text-success)', fontSize: '0.9rem' }}>Min Profit:</label>
            <input 
              type="number" 
              value={minProfit} 
              onChange={(e) => setMinProfit(e.target.value === '' ? '' : Number(e.target.value))}
              step="100"
              style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--text-success)', padding: '0.4rem', borderRadius: '8px', width: '90px', outline: 'none' }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <label style={{ marginRight: '0.4rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>Min Cost:</label>
            <input 
              type="number" 
              value={minCost} 
              onChange={(e) => setMinCost(e.target.value === '' ? '' : Number(e.target.value))}
              step="10"
              style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.4rem', borderRadius: '8px', width: '80px', outline: 'none' }}
            />
          </div>
          
          {(flipMode.includes('bo_') || flipMode === 'npc_order') && (
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <label style={{ marginRight: '0.4rem', color: '#5865F2', fontSize: '0.9rem', fontWeight: 'bold' }}>Order Fill Speed:</label>
              <select 
                value={minVolume} 
                onChange={(e) => setMinVolume(Number(e.target.value))}
                style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid #5865F2', padding: '0.4rem', borderRadius: '8px', outline: 'none', cursor: 'pointer', fontWeight: 'bold' }}
              >
                <option value={0} style={{background: 'var(--glass-bg)'}}>All Volumes</option>
                <option value={10000} style={{background: 'var(--glass-bg)'}}>Low (10k+)</option>
                <option value={100000} style={{background: 'var(--glass-bg)'}}>Medium (100k+)</option>
                <option value={1000000} style={{background: 'var(--glass-bg)'}}>High (1M+)</option>
              </select>
            </div>
          )}
          
          <button 
            className="btn" 
            onClick={() => setRefreshTrigger(prev => prev + 1)}
            style={{ marginLeft: '1rem', padding: '0.4rem 0.8rem', background: 'var(--accent-primary)', color: '#000', fontWeight: 'bold' }}
          >
            Sync Now
          </button>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Item ID</th>
              <th>Cost ({flipMode.includes('bo') || flipMode === 'npc_order' ? 'Buy Order' : 'Insta-Buy'})</th>
              <th>Revenue ({flipMode.includes('so') ? 'Sell Order' : (flipMode.includes('is') ? 'Insta-Sell' : 'NPC')})</th>
              <th onClick={() => setSortBy('profit')} style={{ cursor: 'pointer', color: sortBy === 'profit' ? 'var(--text-success)' : 'inherit' }}>
                Profit / Item {sortBy === 'profit' && '↓'}
              </th>
              <th onClick={() => setSortBy('margin')} style={{ cursor: 'pointer', color: sortBy === 'margin' ? 'var(--text-warning)' : 'inherit' }}>
                Margin {sortBy === 'margin' && '↓'}
              </th>
              <th onClick={() => setSortBy('volume')} style={{ cursor: 'pointer', color: sortBy === 'volume' ? '#fff' : 'inherit' }}>
                Volume (B/S) {sortBy === 'volume' && '↓'}
              </th>
            </tr>
          </thead>
          <tbody>
            {displayData.map((item) => (
              <tr key={item.productId}>
                <td className="item-name" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {item.productId.replace(/_/g, ' ')}
                  <a 
                    href={`https://sky.coflnet.com/item/${item.productId}`} 
                    target="_blank" 
                    rel="noreferrer"
                    title="View on CoFLink"
                    style={{ color: 'var(--accent-primary)', textDecoration: 'none', fontSize: '0.85rem' }}
                  >
                    ↗
                  </a>
                </td>
                <td>{formatCoins(item.displayCost)}</td>
                <td>{formatCoins(item.displayRevenue)}</td>
                <td className="text-success">+{formatCoins(item.displayProfit)}</td>
                <td className="text-warning">{item.displayMargin.toFixed(1)}%</td>
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
