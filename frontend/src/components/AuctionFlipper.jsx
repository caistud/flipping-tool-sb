import { useEffect, useState } from 'react';
import { fetchAuctions, fetchSkyCoflHistory } from '../services/api';

const formatCoins = (num) => {
  if (!num) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
  return num.toFixed(1);
};

export default function AuctionFlipper() {
  const [data, setData] = useState([]);
  const [skycoflData, setSkyCoflData] = useState({});
  const [lbinData, setLbinData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [topCount, setTopCount] = useState(50);
  const [sortBy, setSortBy] = useState('newest');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    let active = true;
    const loadData = async () => {
      try {
        const rows = await fetchAuctions();
        
        // Fetch background LBIN data for accurate modern snipe evaluations!
        try {
          const lbinRes = await fetch('http://localhost:3000/api/lowestbin');
          if (lbinRes.ok) {
            const lbinJson = await lbinRes.json();
            if (active) setLbinData(lbinJson);
          }
        } catch(e) { console.error("Could not fetch Moulberry LBIN"); }
        
        const recent = rows.sort((a, b) => b.start - a.start).slice(0, 500);

        if (active) {
          setData(recent);
        }
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    };
    
    loadData();
    const interval = setInterval(loadData, 15000); // 15s refresh
    return () => { active = false; clearInterval(interval); };
  }, [refreshTrigger]);

  const handleCheckSkyCofl = async (itemIdClean) => {
    // Basic item name normalization (e.g. "Heroic Hyperion ✪" -> "HYPERION")
    // Note: In real app, you parse the item_bytes using a library like prismarine-nbt to get internal ID
    // but for MVP, we just use the clean name
    let internalId = itemIdClean.toUpperCase().replace(/[^A-Z]/g, '_');
    
    try {
      const cofl = await fetchSkyCoflHistory(internalId);
      setSkyCoflData(prev => ({ ...prev, [itemIdClean]: cofl.average_bin }));
    } catch (e) {
      console.error(e);
      setSkyCoflData(prev => ({ ...prev, [itemIdClean]: 'Error' }));
    }
  };

  const getBadgeClass = (tier) => {
    if (!tier) return 'badge-common';
    return `badge-${tier.toLowerCase()}`;
  };

  if (loading && data.length === 0) return <div className="loader-container"><div className="loader"></div><p>Scanning Action House bins...</p></div>;
  if (error) return <div className="glass-card text-danger">Error fetching auctions data: {error}</div>;

  const sortedData = [...data]
    .filter(a => {
      if (searchQuery && !a.item_name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'newest') return b.start - a.start;
      const aPrice = a.starting_bid || a.highest_bid_amount || 0;
      const bPrice = b.starting_bid || b.highest_bid_amount || 0;
      if (sortBy === 'price_lowest') return aPrice - bPrice;
      if (sortBy === 'price_highest') return bPrice - aPrice;
      return 0;
    });
  
  const displayData = sortedData.slice(0, topCount);

  return (
    <div className="glass-card animate-fade-in">
      <div className="flex-between" style={{ marginBottom: '1rem' }}>
        <div>
          <h2>Recent BIN Listings</h2>
          <span className="text-muted text-sm">Showing the brightest new listings to verify with SkyCofl</span>
        </div>
      </div>
      
      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', marginBottom: '1.5rem', background: 'var(--glass-bg)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
        <div>
          <label style={{ marginRight: '0.5rem', color: 'var(--text-muted)' }}>Sort By:</label>
          <select 
            value={sortBy} 
            onChange={(e) => setSortBy(e.target.value)}
            style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.5rem', borderRadius: '8px', outline: 'none', cursor: 'pointer' }}
          >
            <option value="newest" style={{background: 'var(--glass-bg)'}}>Newest Listings</option>
            <option value="price_lowest" style={{background: 'var(--glass-bg)'}}>Lowest Price First</option>
            <option value="price_highest" style={{background: 'var(--glass-bg)'}}>Highest Price First</option>
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
        <div style={{ marginLeft: 'auto' }}>
          <button 
            className="btn" 
            onClick={() => setRefreshTrigger(prev => prev + 1)}
            style={{ padding: '0.4rem 0.8rem', background: 'var(--accent-primary)', color: '#000', fontWeight: 'bold' }}
          >
            Sync Now
          </button>
        </div>
      </div>
      
      <div className="cards-grid">
        {displayData.map((item) => (
          <div key={item.uuid} className="glass-card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div className="flex-between">
              <span className={`badge ${getBadgeClass(item.tier)}`}>{item.tier}</span>
              <span className="text-muted text-sm" style={{textTransform: 'uppercase'}}>{item.category}</span>
            </div>
            
            <h3 style={{ fontSize: '1.1rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {item.item_name}
              <a 
                href={`https://sky.coflnet.com/item/${item.item_name.toUpperCase().replace(/[^A-Z]/g, '_')}`} 
                target="_blank" 
                rel="noreferrer"
                title="View on CoFLink"
                style={{ color: 'var(--accent-primary)', textDecoration: 'none', fontSize: '0.85rem' }}
              >
                ↗
              </a>
            </h3>
            
            <div className="flex-between" style={{ marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.05)'}}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="text-muted" style={{fontSize: '0.8rem'}}>Listed For</span>
                <span className="text-warning" style={{fontWeight: '700', fontSize: '1.2rem'}}>{formatCoins(item.starting_bid || item.highest_bid_amount)}</span>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end'}}>
                <span className="text-muted" style={{fontSize: '0.8rem'}}>Live Lowest BIN</span>
                {lbinData[item.item_name.toUpperCase().replace(/[^A-Z]/g, '_')] ? (
                  <span className={lbinData[item.item_name.toUpperCase().replace(/[^A-Z]/g, '_')] > (item.starting_bid || 0) ? "text-success" : "text-danger"} style={{fontWeight: '700', fontSize: '1rem'}}>
                    {formatCoins(lbinData[item.item_name.toUpperCase().replace(/[^A-Z]/g, '_')])}
                  </span>
                ) : (
                  <span className="text-muted" style={{fontStyle: 'italic', fontSize: '0.9rem'}}>Scanning...</span>
                )}
              </div>
            </div>

            <div className="flex-between" style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px dashed rgba(255,255,255,0.1)'}}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="text-muted" style={{fontSize: '0.75rem'}}>Historical Center (SkyCofl)</span>
                {skycoflData[item.item_name] === undefined ? (
                  <button onClick={() => handleCheckSkyCofl(item.item_name)} style={{ background: 'var(--accent-primary)', border: 'none', color: 'white', padding: '0.1rem 0.4rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', marginTop: '0.2rem'}}>
                    Verify History
                  </button>
                ) : (
                  <span className={skycoflData[item.item_name] > item.starting_bid ? "text-success" : "text-danger"} style={{fontWeight: '700', fontSize: '0.85rem'}}>
                    {skycoflData[item.item_name] === 'Error' ? 'N/A' : formatCoins(skycoflData[item.item_name])}
                  </span>
                )}
              </div>
            </div>
            
            {(skycoflData[item.item_name] && skycoflData[item.item_name] !== 'Error') || lbinData[item.item_name.toUpperCase().replace(/[^A-Z]/g, '_')] ? (
              <div style={{ fontSize: '0.85rem', textAlign: 'center', marginTop: '0.5rem', background: 'var(--glass-highlight)', padding: '0.5rem', borderRadius: '8px' }}>
                Actual Margin vs LBIN: <strong className={lbinData[item.item_name.toUpperCase().replace(/[^A-Z]/g, '_')] - (item.starting_bid || 0) > 0 ? "text-success" : "text-danger"}>
                  {lbinData[item.item_name.toUpperCase().replace(/[^A-Z]/g, '_')] ? formatCoins(lbinData[item.item_name.toUpperCase().replace(/[^A-Z]/g, '_')] - (item.starting_bid || 0)) : '?'}
                </strong>
              </div>
            ) : null}
            
          </div>
        ))}
        {data.length === 0 && (
           <p className="text-muted">No recent BINs found. Check backend.</p>
        )}
      </div>
    </div>
  );
}
