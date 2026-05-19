import { useState, useEffect } from 'react'
import axios from 'axios'
import './App.css'
import BazaarFlipper from './components/BazaarFlipper'
import AuctionFlipper from './components/AuctionFlipper'
import ShardFusionFlipper from './components/ShardFusionFlipper'
import ItemBuilder from './components/ItemBuilder'
import MayorFlipper from './components/MayorFlipper'
import AccessoryFlipper from './components/AccessoryFlipper'
import HuntingGuide from './components/HuntingGuide'
import InvestmentStrategies from './components/InvestmentStrategies'
import HuntFuseStrat from './components/HuntFuseStrat'
import ForgeFlipper from './components/ForgeFlipper'
import { API_URL } from './services/api'

const features = [
  { key: 'bazaar', label: 'Bazaar Flipping' },
  { key: 'auctions', label: 'AH Sniping' },
  { key: 'accessories', label: 'Accessory Craft Flips' },
  { key: 'forge', label: 'Forge Profit Flips' },
  { key: 'shards', label: 'Shard Fusions' },
  { key: 'hunting', label: 'Hunting Guide' },
  { key: 'huntFuse', label: 'Hunt + Fuse Strat' },
  { key: 'strategies', label: 'Investment Strategies' },
  { key: 'mayors', label: 'Mayor Flips' },
  { key: 'builder', label: 'Lowball Calculator' },
]

function SettingsPanel() {
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    axios.get(`${API_URL}/settings/apikey`)
      .then(res => setApiKey(res.data.apikey))
      .catch(() => setStatus('Failed to load key'))
  }, [])

  const handleUpdate = async () => {
    try {
      setStatus('Saving...')
      await axios.post(`${API_URL}/settings/apikey`, { apikey: apiKey })
      setStatus('Key saved and loaded!')
      setTimeout(() => setStatus(''), 3000)
    } catch (err) {
      setStatus('Failed to save key')
    }
  }

  const handleRestart = async () => {
    try {
      setStatus('Restarting backend...')
      await axios.post(`${API_URL}/settings/restart`)
      setTimeout(() => { setStatus('Backend restarted!'); setTimeout(() => setStatus(''), 2000) }, 3000)
    } catch (err) {
      setStatus('Failed to restart')
    }
  }

  return (
    <div style={{ background: 'var(--glass-bg)', padding: '1rem', borderBottom: '1px solid var(--glass-border)', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <strong style={{color: 'var(--text-primary)'}}>⚙️ Admin Settings</strong>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto', flexWrap: 'wrap' }}>
        <input 
          type="text" 
          placeholder="Hypixel API Key" 
          value={apiKey} 
          onChange={(e) => setApiKey(e.target.value)} 
          style={{ width: '320px', background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', padding: '0.4rem', borderRadius: '4px', outline: 'none' }}
        />
        <button className="btn" style={{ background: 'var(--accent-primary)', color: '#000', padding: '0.4rem 1rem', fontWeight: 'bold' }} onClick={handleUpdate}>Save Key</button>
        <button className="btn" style={{ background: '#da373c', color: '#fff', padding: '0.4rem 1rem', marginLeft: '1rem', fontWeight: 'bold' }} onClick={handleRestart}>Force Restart Backend</button>
      </div>
      {status && <span style={{ color: 'var(--text-warning)', marginLeft: '1rem', fontSize: '0.9rem', fontWeight: 'bold' }}>{status}</span>}
    </div>
  )
}

function App() {
  const [activeTab, setActiveTab] = useState('bazaar')

  const renderContent = () => {
    switch (activeTab) {
      case 'bazaar': return <BazaarFlipper />
      case 'auctions': return <AuctionFlipper />
      case 'accessories': return <AccessoryFlipper />
      case 'forge': return <ForgeFlipper />
      case 'shards': return <ShardFusionFlipper />
      case 'hunting': return <HuntingGuide />
      case 'huntFuse': return <HuntFuseStrat />
      case 'strategies': return <InvestmentStrategies />
      case 'mayors': return <MayorFlipper />
      case 'builder': return <ItemBuilder />
      default: return null
    }
  }

  return (
    <div className="app-container">
      <header>
        <div className="logo-container">
          <div className="logo-icon">S</div>
          <div className="logo-text">Skyblock Flips</div>
        </div>
        
        <div className="feature-select-wrap">
          <label htmlFor="feature-select">Feature</label>
          <select
            id="feature-select"
            className="feature-select"
            value={activeTab}
            onChange={(event) => setActiveTab(event.target.value)}
          >
            {features.map((feature) => (
              <option key={feature.key} value={feature.key}>{feature.label}</option>
            ))}
          </select>
        </div>
      </header>

      <SettingsPanel />

      <main className="content-area">
        {renderContent()}
      </main>
    </div>
  )
}

export default App
