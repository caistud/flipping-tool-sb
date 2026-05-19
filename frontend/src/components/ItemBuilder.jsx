import { useEffect, useState } from 'react';
import { API_URL, fetchBazaar, fetchSkyCoflHistory } from '../services/api';

const formatCoins = (num) => {
  if (!num) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
  return num.toFixed(1);
};

export default function ItemBuilder() {
  const [bazaarData, setBazaarData] = useState({});
  const [lbinData, setLbinData] = useState({});
  const [loading, setLoading] = useState(true);

  // Manual Input State
  const [baseName, setBaseName] = useState('');
  const [basePrice, setBasePrice] = useState(0);
  const [targetMargin, setTargetMargin] = useState(15);
  
  // Modifiers
  const [recomb, setRecomb] = useState(false);
  const [hotPotatoBooks, setHotPotatoBooks] = useState(0);
  const [fumingPotatoBooks, setFumingPotatoBooks] = useState(0);
  const [artOfWar, setArtOfWar] = useState(false);
  const [selectedUltimate, setSelectedUltimate] = useState('');
  const [selectedEnchants, setSelectedEnchants] = useState([]);
  const [selectedAttributes, setSelectedAttributes] = useState([]);
  
  // Temporary state for the attribute dropdown before adding
  const [tempAttrId, setTempAttrId] = useState('');
  const [tempAttrLevel, setTempAttrLevel] = useState(1);

  useEffect(() => {
    const loadData = async () => {
      try {
        // Fetch raw material instabuys from background instance
        const rows = await fetchBazaar();
        const bzMap = {};
        for (const r of rows) {
          bzMap[r.productId] = r.sellPrice; // sellPrice = Insta-Buy cost!
        }
        setBazaarData(bzMap);
        
        // Concurrently fetch Moulberry's Live LBIN via internal CORS proxy
        const lbinRes = await fetch(`${API_URL}/lowestbin`);
        const lbinJson = await lbinRes.json();
        setLbinData(lbinJson);

      } catch (err) {
        console.error("Error fetching market data:", err);
      } finally {
        setLoading(false);
      }
    };
    
    loadData();
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  }, []);

  // Filter Ultimates
  const ultimateEnchants = Object.keys(bazaarData)
    .filter(id => id.startsWith('ENCHANTMENT_ULTIMATE_'))
    .sort();
    
  // Dynamic list of all normal enchants for standard T6/T7 logic
  const regularEnchants = Object.keys(bazaarData)
    .filter(id => id.startsWith('ENCHANTMENT_') && !id.startsWith('ENCHANTMENT_ULTIMATE_'))
    .sort();

  // Dynamic list for Attributes (Kuudra/Glacite/etc)
  const attributeShards = Object.keys(bazaarData)
    .filter(id => id.includes('SHARD') || id.includes('ATTRIBUTE'))
    .sort();

  // SkyCofl & LBIN Auto-Pricing
  const [fetchingLBIN, setFetchingLBIN] = useState(false);
  const [fetchingMedian, setFetchingMedian] = useState(false);
  const [craftCost, setCraftCost] = useState(null);
  const [craftIncomplete, setCraftIncomplete] = useState(false);

  const calculateCraftCost = async (internalId) => {
    try {
      setCraftCost(null);
      setCraftIncomplete(false);
      const res = await fetch(`https://raw.githubusercontent.com/Moulberry/NotEnoughUpdates-REPO/master/items/${internalId}.json`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.recipe) {
         let total = 0;
         let missing = false;
         for (const slot in data.recipe) {
            const item = data.recipe[slot];
            if (item) {
               const parts = item.split(':');
               let id = parts[0];
               let amount = 1;
               if (parts.length === 2) {
                  amount = parseInt(parts[1]);
               } else if (parts.length === 3) {
                  id = parts[0] + ':' + parts[1];
                  amount = parseInt(parts[2]);
               }
               const price = bazaarData[id] || lbinData[id] || 0;
               if (price === 0) missing = true;
               total += (amount * price);
            }
         }
         // Account for recipe yield (e.g., if recipe outputs 3 items, divide total cost by 3)
         // NEU usually provides `info` or we just output the raw material total for 1 craft.
         if (total > 0) {
           setCraftCost(Math.floor(total));
           setCraftIncomplete(missing);
         }
      }
    } catch(e) {}
  };

  const handleAutoPriceLBIN = () => {
    if (!baseName) return;
    setFetchingLBIN(true);
    try {
      let internalId = baseName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
      
      if (bazaarData[internalId]) {
        setBasePrice(Math.floor(bazaarData[internalId]));
      } else if (lbinData[internalId]) {
        setBasePrice(Math.floor(lbinData[internalId]));
      } else {
        alert("Could not find a Live LBIN for that item. Check spelling!");
      }
      
      // Calculate insta-buy craft cost alongside it
      calculateCraftCost(internalId);
    } finally {
      setFetchingLBIN(false);
    }
  };

  const handleAutoPriceMedian = async () => {
    if (!baseName) return;
    setFetchingMedian(true);
    try {
      let internalId = baseName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
      
      if (bazaarData[internalId]) {
        // Bazaar doesn't have a "historical median" via this API, just fall back to its live price
        setBasePrice(Math.floor(bazaarData[internalId]));
      } else {
        const cofl = await fetchSkyCoflHistory(internalId);
        if (cofl && cofl.average_bin > 0) {
          setBasePrice(Math.floor(cofl.average_bin));
        } else {
          alert("Could not find a valid historical median from SkyCofl. Check spelling!");
        }
      }
      // Calculate insta-buy craft cost regardless
      calculateCraftCost(internalId);
    } catch (err) {
      console.error(err);
      alert("Error fetching median from SkyCofl database.");
    } finally {
      setFetchingMedian(false);
    }
  };

  // Price Calculation Math
  const getModifierCost = (id) => Math.floor(bazaarData[id] || 0);

  const recombCost = recomb ? getModifierCost('RECOMBOBULATOR_3000') : 0;
  const hpbCost = hotPotatoBooks * getModifierCost('HOT_POTATO_BOOK');
  const fpbCost = fumingPotatoBooks * getModifierCost('FUMING_POTATO_BOOK');
  const aowCost = artOfWar ? getModifierCost('THE_ART_OF_WAR') : 0;
  const ultCost = selectedUltimate ? getModifierCost(selectedUltimate) : 0;
  
  let regEnchantsCost = 0;
  selectedEnchants.forEach(id => { regEnchantsCost += getModifierCost(id); });

  let attrCost = 0;
  selectedAttributes.forEach(attr => {
    attrCost += getModifierCost(attr.id) * Math.pow(2, attr.level - 1);
  });

  const sumModifiers = recombCost + hpbCost + fpbCost + aowCost + ultCost + regEnchantsCost + attrCost;
  const rawCostToCraft = (Number(basePrice) || 0) + sumModifiers;
  const lowballOffer = rawCostToCraft * (1 - (targetMargin / 100));
  const estimatedProfit = rawCostToCraft - lowballOffer;

  if (loading && Object.keys(bazaarData).length === 0) {
    return <div className="loader-container"><div className="loader"></div><p>Pulling Marketplace Modifiers...</p></div>;
  }

  return (
    <div className="glass-card animate-fade-in" style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) minmax(350px, 1fr)', gap: '2rem', alignItems: 'start' }}>
      
      {/* LEFT: Configurator */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <h2 style={{borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem'}}>Build an Offer</h2>
        
        {/* Base Item Target */}
        <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
          <h3 style={{marginTop: 0, color: 'var(--text-primary)', marginBottom: '1rem'}}>1. Clean Base Item</h3>
          
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem', color: 'var(--text-muted)' }}>
              <span>Item Name</span>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <button 
                  onClick={handleAutoPriceLBIN}
                  disabled={fetchingLBIN || fetchingMedian || !baseName}
                  style={{ background: fetchingLBIN ? 'rgba(255,255,255,0.1)' : 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: fetchingLBIN ? 'var(--text-muted)' : 'var(--text-primary)', borderRadius: '4px', cursor: 'pointer', fontSize: '0.7rem', padding: '0.2rem 0.5rem', transition: '0.2s' }}
                >
                  {fetchingLBIN ? '...' : 'Live LBIN'}
                </button>
                <button 
                  onClick={handleAutoPriceMedian}
                  disabled={fetchingLBIN || fetchingMedian || !baseName}
                  style={{ background: fetchingMedian ? 'rgba(255,255,255,0.1)' : 'var(--accent-primary)', border: 'none', color: fetchingMedian ? 'var(--text-muted)' : '#000', borderRadius: '4px', cursor: 'pointer', fontSize: '0.7rem', padding: '0.2rem 0.5rem', fontWeight: 'bold', transition: '0.2s' }}
                >
                  {fetchingMedian ? '...' : 'Avg Median'}
                </button>
              </div>
            </label>
            <input 
              type="text" 
              placeholder="e.g. Livid Dagger"
              value={baseName}
              onChange={(e) => setBaseName(e.target.value)}
              style={{ width: '100%', background: 'var(--glass-bg)', color: '#fff', border: '1px solid var(--glass-border)', padding: '0.6rem', borderRadius: '8px', outline: 'none' }}
            />
          </div>
          
          <div>
            <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-muted)' }}>Clean Market Price (Coins)</label>
            <input 
              type="number" 
              value={basePrice}
              onChange={(e) => setBasePrice(e.target.value)}
              placeholder="7000000"
              style={{ width: '100%', background: 'var(--glass-bg)', color: 'var(--accent-secondary)', border: '1px solid var(--accent-secondary)', padding: '0.6rem', borderRadius: '8px', outline: 'none', fontWeight: 'bold' }}
            />
          </div>
        </div>

        {/* Modifiers List */}
        <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
          <h3 style={{marginTop: 0, color: 'var(--text-primary)', marginBottom: '1rem'}}>2. Attached Modifiers</h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="flex-between">
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: recomb ? 'var(--text-success)' : 'var(--text-muted)', cursor: 'pointer' }}>
                <input type="checkbox" checked={recomb} onChange={(e) => setRecomb(e.target.checked)} style={{accentColor: 'var(--accent-primary)', width: '1.2rem', height: '1.2rem'}}/>
                Recombobulator 3000
              </label>
              <span className="text-muted text-sm">{formatCoins(getModifierCost('RECOMBOBULATOR_3000'))} <span style={{fontSize: '0.65rem', opacity: 0.6}}>Insta-Buy</span></span>
            </div>

            <div className="flex-between">
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: artOfWar ? 'var(--text-success)' : 'var(--text-muted)', cursor: 'pointer' }}>
                <input type="checkbox" checked={artOfWar} onChange={(e) => setArtOfWar(e.target.checked)} style={{accentColor: 'var(--accent-primary)', width: '1.2rem', height: '1.2rem'}}/>
                The Art of War
              </label>
              <span className="text-muted text-sm">{formatCoins(getModifierCost('THE_ART_OF_WAR'))} <span style={{fontSize: '0.65rem', opacity: 0.6}}>Insta-Buy</span></span>
            </div>

            <div style={{ borderTop: '1px solid var(--glass-border)', margin: '0.5rem 0' }}></div>

            <div className="flex-between" style={{ alignItems: 'center' }}>
              <label style={{ color: 'var(--text-primary)'}}>Hot Potato Books</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                <input type="range" min="0" max="10" value={hotPotatoBooks} onChange={e => setHotPotatoBooks(Number(e.target.value))} />
                <span style={{ fontWeight: 'bold', width: '20px', textAlign: 'center' }}>{hotPotatoBooks}</span>
              </div>
            </div>

            <div className="flex-between" style={{ alignItems: 'center' }}>
              <label style={{ color: 'var(--text-primary)'}}>Fuming Potato Books</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                <input type="range" min="0" max="5" value={fumingPotatoBooks} onChange={e => setFumingPotatoBooks(Number(e.target.value))} />
                <span style={{ fontWeight: 'bold', width: '20px', textAlign: 'center' }}>{fumingPotatoBooks}</span>
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--glass-border)', margin: '0.5rem 0' }}></div>
            <div>
              <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-primary)' }}>Ultimate Enchant</label>
              <select 
                value={selectedUltimate} 
                onChange={e => setSelectedUltimate(e.target.value)}
                style={{ width: '100%', background: 'var(--glass-bg)', color: '#fff', border: '1px solid var(--glass-border)', padding: '0.6rem', borderRadius: '8px', outline: 'none' }}
              >
                <option value="">None</option>
                {ultimateEnchants.map(id => (
                  <option key={id} value={id}>{id.replace('ENCHANTMENT_ULTIMATE_', '').replace(/_/g, ' ')} ({formatCoins(getModifierCost(id))} Insta-Buy)</option>
                ))}
              </select>
            </div>

            <div style={{ borderTop: '1px solid var(--glass-border)', margin: '0.5rem 0' }}></div>

            <div>
              <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-primary)' }}>Normal Enchants (T6/T7)</label>
              <select 
                value=""
                onChange={e => {
                  if (e.target.value && !selectedEnchants.includes(e.target.value)) {
                    setSelectedEnchants([...selectedEnchants, e.target.value]);
                  }
                }}
                style={{ width: '100%', background: 'var(--glass-bg)', color: '#fff', border: '1px solid var(--glass-border)', padding: '0.6rem', borderRadius: '8px', outline: 'none', marginBottom: '1rem' }}
              >
                <option value="">+ Add Enchantment...</option>
                {regularEnchants.map(id => (
                  <option key={id} value={id}>{id.replace('ENCHANTMENT_', '').replace(/_/g, ' ')} ({formatCoins(getModifierCost(id))} Insta-Buy)</option>
                ))}
              </select>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {selectedEnchants.map(id => (
                  <div key={id} className="flex-between" style={{ background: 'rgba(255,255,255,0.05)', padding: '0.4rem 0.8rem', borderRadius: '6px' }}>
                    <span style={{color: 'var(--text-primary)', fontSize: '0.85rem'}}>{id.replace('ENCHANTMENT_', '').replace(/_/g, ' ')}</span>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                      <span className="text-muted" style={{fontSize: '0.8rem', fontFamily: 'monospace'}}>{formatCoins(getModifierCost(id))}</span>
                      <button onClick={() => setSelectedEnchants(selectedEnchants.filter(x => x !== id))} style={{ background: 'transparent', border: 'none', color: 'var(--accent-danger)', cursor: 'pointer', fontWeight: 'bold' }}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--glass-border)', margin: '0.5rem 0' }}></div>
            
            {/* Attributes Selection */}
            <div>
              <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-primary)' }}>Armor Attributes (Kuudra/Mineshaft)</label>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                <select 
                  value={tempAttrId}
                  onChange={e => setTempAttrId(e.target.value)}
                  style={{ flex: 1, background: 'var(--glass-bg)', color: '#fff', border: '1px solid var(--glass-border)', padding: '0.6rem', borderRadius: '8px', outline: 'none' }}
                >
                  <option value="">Select Attribute...</option>
                  {attributeShards.map(id => (
                    <option key={id} value={id}>{id.replace('SHARD_', '').replace('ATTRIBUTE_', '').replace(/_/g, ' ')} (Base: {formatCoins(getModifierCost(id))})</option>
                  ))}
                </select>
                <input 
                  type="number" 
                  min="1" max="10" 
                  value={tempAttrLevel}
                  onChange={e => setTempAttrLevel(Number(e.target.value) || 1)}
                  style={{ width: '60px', background: 'var(--glass-bg)', color: 'white', border: '1px solid var(--glass-border)', padding: '0.6rem', borderRadius: '8px', textAlign: 'center' }}
                  title="Attribute Level"
                />
                <button 
                  className="btn"
                  disabled={!tempAttrId}
                  onClick={() => {
                    if (tempAttrId && !selectedAttributes.some(a => a.id === tempAttrId)) {
                      setSelectedAttributes([...selectedAttributes, {id: tempAttrId, level: tempAttrLevel}]);
                      setTempAttrId('');
                      setTempAttrLevel(1);
                    }
                  }}
                  style={{ background: tempAttrId ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)', color: '#000', border: 'none', padding: '0 1rem', borderRadius: '8px', fontWeight: 'bold', cursor: tempAttrId ? 'pointer' : 'default' }}
                >
                  +
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {selectedAttributes.map(attr => {
                  const val = getModifierCost(attr.id) * Math.pow(2, attr.level - 1);
                  return (
                    <div key={attr.id} className="flex-between" style={{ background: 'rgba(255,255,255,0.05)', padding: '0.4rem 0.8rem', borderRadius: '6px' }}>
                      <span style={{color: 'var(--text-primary)', fontSize: '0.85rem'}}>
                        {attr.id.replace('SHARD_', '').replace('ATTRIBUTE_', '').replace(/_/g, ' ')} <strong className="text-warning">Lvl {attr.level}</strong>
                      </span>
                      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                        <span className="text-muted" style={{fontSize: '0.8rem', fontFamily: 'monospace'}}>{formatCoins(val)}</span>
                        <button onClick={() => setSelectedAttributes(selectedAttributes.filter(x => x.id !== attr.id))} style={{ background: 'transparent', border: 'none', color: 'var(--accent-danger)', cursor: 'pointer', fontWeight: 'bold' }}>✕</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            
          </div>
        </div>
      </div>

      {/* RIGHT: Math Receipt View */}
      <div style={{ position: 'sticky', top: '2rem' }}>
        <div style={{ background: 'rgba(0, 0, 0, 0.4)', padding: '2rem', borderRadius: '16px', border: '1px solid var(--glass-border)', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)' }}>
          <h2 style={{marginTop: 0, textAlign: 'center', marginBottom: '1.5rem', color: 'var(--accent-primary)'}}>Lowball Receipt</h2>
          
          {/* Itemized Target Row */}
          <div className="flex-between" style={{ marginBottom: '1rem', borderBottom: '1px dashed rgba(255,255,255,0.2)', paddingBottom: '0.5rem' }}>
            <span style={{color: 'var(--text-muted)'}}>{baseName || "Clean Item"}</span>
            <div style={{display: 'flex', flexDirection: 'column', alignItems: 'flex-end'}}>
              <span style={{fontFamily: 'monospace'}}>{Number(basePrice).toLocaleString()}</span>
              {!(fetchingLBIN || fetchingMedian) && basePrice > 0 && <span style={{fontSize: '0.65rem', color: 'var(--text-muted)'}}>{bazaarData[baseName.toUpperCase().replace(/[^A-Z0-9]/g, '_')] ? 'Insta-Buy' : 'Lowest BIN'}</span>}
              {craftCost > 0 && (
                <span className="text-warning" style={{fontSize: '0.75rem', marginTop: '0.2rem'}} title={craftIncomplete ? "Some materials were untradeable and couldn't be priced!" : ""}>
                  Insta-Buy Craft Cost: {craftCost.toLocaleString()} {craftIncomplete ? '(!)' : ''}
                </span>
              )}
            </div>
          </div>

          {/* Modifiers List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem', minHeight: '120px' }}>
            {recomb && (
              <div className="flex-between text-sm">
                <span className="text-success">+ Recombobulator 3000</span>
                <span style={{fontFamily: 'monospace'}}>{recombCost.toLocaleString()}</span>
              </div>
            )}
            {hotPotatoBooks > 0 && (
              <div className="flex-between text-sm">
                <span className="text-success">+ {hotPotatoBooks}x Hot Potato Book</span>
                <span style={{fontFamily: 'monospace'}}>{hpbCost.toLocaleString()}</span>
              </div>
            )}
            {fumingPotatoBooks > 0 && (
              <div className="flex-between text-sm">
                <span className="text-success">+ {fumingPotatoBooks}x Fuming Potato Book</span>
                <span style={{fontFamily: 'monospace'}}>{fpbCost.toLocaleString()}</span>
              </div>
            )}
            {artOfWar && (
              <div className="flex-between text-sm">
                <span className="text-success">+ The Art of War</span>
                <span style={{fontFamily: 'monospace'}}>{aowCost.toLocaleString()}</span>
              </div>
            )}
            {selectedUltimate && (
              <div className="flex-between text-sm">
                <span className="text-success">+ {selectedUltimate.replace('ENCHANTMENT_ULTIMATE_', '').replace(/_/g, ' ')}</span>
                <span style={{fontFamily: 'monospace'}}>{ultCost.toLocaleString()}</span>
              </div>
            )}
            {selectedEnchants.map(id => (
              <div key={id} className="flex-between text-sm">
                <span className="text-success">+ {id.replace('ENCHANTMENT_', '').replace(/_/g, ' ')}</span>
                <span style={{fontFamily: 'monospace'}}>{getModifierCost(id).toLocaleString()}</span>
              </div>
            ))}
            {selectedAttributes.map(attr => {
              const val = getModifierCost(attr.id) * Math.pow(2, attr.level - 1);
              return (
                <div key={attr.id} className="flex-between text-sm">
                  <span className="text-warning">+ {attr.id.replace('SHARD_', '').replace('ATTRIBUTE_', '').replace(/_/g, ' ')} Lvl {attr.level}</span>
                  <span style={{fontFamily: 'monospace'}}>{val.toLocaleString()}</span>
                </div>
              );
            })}
            {!sumModifiers && <div className="text-muted text-sm" style={{fontStyle: 'italic', textAlign: 'center', marginTop: '1rem'}}>No valid modifiers added</div>}
          </div>

          {/* Sums */}
          <div style={{ borderTop: '2px solid var(--glass-border)', paddingTop: '1rem', marginBottom: '1.5rem' }}>
            <div className="flex-between" style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>
              <span>Total Raw Value:</span>
              <span>{Math.floor(rawCostToCraft).toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '1rem', background: 'rgba(255,255,255,0.05)', padding: '0.5rem 1rem', borderRadius: '8px' }}>
              <label>Lowball Target Deduction:</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                <input 
                  type="number" 
                  value={targetMargin} 
                  onChange={(e) => setTargetMargin(Number(e.target.value) || 0)}
                  style={{ width: '50px', background: 'transparent', color: 'var(--text-warning)', border: 'none', borderBottom: '1px solid var(--text-warning)', outline: 'none', textAlign: 'center', fontWeight: 'bold' }}
                />
                <span style={{color: 'var(--text-warning)'}}>%</span>
              </div>
            </div>
          </div>

          {/* Final Target Offer */}
          <div style={{ background: 'var(--accent-primary)', padding: '1rem', borderRadius: '12px', textAlign: 'center', color: '#000' }}>
            <div style={{ fontSize: '0.9rem', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px', opacity: 0.8 }}>Target Offer Amount</div>
            <div style={{ fontSize: '2rem', fontWeight: '900', fontFamily: 'monospace', margin: '0.5rem 0' }}>
              {Math.floor(lowballOffer).toLocaleString()}
            </div>
            <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'rgba(0,0,0,0.7)' }}>
              Projected Profit: {Math.floor(estimatedProfit).toLocaleString()}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
