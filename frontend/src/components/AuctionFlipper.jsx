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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [topCount, setTopCount] = useState(50);
  const [sortBy, setSortBy] = useState('newest');

  useEffect(() => {
    let active = true;
    const loadData = async () => {
      try {
        const rows = await fetchAuctions();
        
        // Find snipes: we don't have all AH pages, but we can display the newest items and then check skycofl
        // For MVP frontend, let's just group by item name and if there's an outlier, it's a snipe.
        // OR better: display the absolute newest BINs, and let user click 'Check SkyCofl' to verify true value.
        
        // Let's sort by start date descending to find freshly listed BINs
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
  }, []);

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

  const sortedData = [...data].sort((a, b) => {
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
      </div>
      
      <div className="cards-grid">
        {displayData.map((item) => (
          <div key={item.uuid} className="glass-card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div className="flex-between">
              <span className={`badge ${getBadgeClass(item.tier)}`}>{item.tier}</span>
              <span className="text-muted text-sm" style={{textTransform: 'uppercase'}}>{item.category}</span>
            </div>
            
            <h3 style={{ fontSize: '1.1rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {item.item_name}
            </h3>
            
            <div className="flex-between" style={{ marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.05)'}}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="text-muted" style={{fontSize: '0.8rem'}}>BIN Price</span>
                <span className="text-warning" style={{fontWeight: '700', fontSize: '1.2rem'}}>{formatCoins(item.starting_bid || item.highest_bid_amount)}</span>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end'}}>
                <span className="text-muted" style={{fontSize: '0.8rem'}}>SkyCofl Average</span>
                {skycoflData[item.item_name] === undefined ? (
                  <button onClick={() => handleCheckSkyCofl(item.item_name)} style={{ background: 'var(--accent-primary)', border: 'none', color: 'white', padding: '0.2rem 0.5rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem'}}>
                    Verify Value
                  </button>
                ) : (
                  <span className={skycoflData[item.item_name] > item.starting_bid ? "text-success" : "text-danger"} style={{fontWeight: '700'}}>
                    {skycoflData[item.item_name] === 'Error' ? 'N/A' : formatCoins(skycoflData[item.item_name])}
                  </span>
                )}
              </div>
            </div>
            
            {skycoflData[item.item_name] && skycoflData[item.item_name] !== 'Error' && (
              <div style={{ fontSize: '0.85rem', textAlign: 'center', marginTop: '0.5rem', background: 'var(--glass-highlight)', padding: '0.5rem', borderRadius: '8px' }}>
                Profit Margin: <strong className={skycoflData[item.item_name] - item.starting_bid > 0 ? "text-success" : "text-danger"}>
                  {formatCoins(skycoflData[item.item_name] - item.starting_bid)}
                </strong>
              </div>
            )}
            
          </div>
        ))}
        {data.length === 0 && (
           <p className="text-muted">No recent BINs found. Check backend.</p>
        )}
      </div>
    </div>
  );
}
