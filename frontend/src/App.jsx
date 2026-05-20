import { useState } from 'react'
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
import MagicPowerOptimizer from './components/MagicPowerOptimizer'

const features = [
  { key: 'bazaar', label: 'Bazaar Flipping' },
  { key: 'auctions', label: 'AH Sniping' },
  { key: 'accessories', label: 'Accessory Craft Flips' },
  { key: 'magicPower', label: 'Magic Power Optimizer' },
  { key: 'forge', label: 'Forge Profit Flips' },
  { key: 'shards', label: 'Shard Fusions' },
  { key: 'hunting', label: 'Hunting Guide' },
  { key: 'huntFuse', label: 'Hunt + Fuse Strat' },
  { key: 'strategies', label: 'Investment Strategies' },
  { key: 'mayors', label: 'Mayor Flips' },
  { key: 'builder', label: 'Lowball Calculator' },
]

function App() {
  const [activeTab, setActiveTab] = useState('bazaar')

  const renderContent = () => {
    switch (activeTab) {
      case 'bazaar': return <BazaarFlipper />
      case 'auctions': return <AuctionFlipper />
      case 'accessories': return <AccessoryFlipper />
      case 'magicPower': return <MagicPowerOptimizer />
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

      <main className="content-area">
        {renderContent()}
      </main>
    </div>
  )
}

export default App
