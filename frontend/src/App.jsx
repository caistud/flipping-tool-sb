import { useState } from 'react'
import './App.css'
import BazaarFlipper from './components/BazaarFlipper'
import AuctionFlipper from './components/AuctionFlipper'
import ShardFusionFlipper from './components/ShardFusionFlipper'

function App() {
  const [activeTab, setActiveTab] = useState('bazaar')

  const renderContent = () => {
    switch (activeTab) {
      case 'bazaar': return <BazaarFlipper />
      case 'auctions': return <AuctionFlipper />
      case 'shards': return <ShardFusionFlipper />
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
        
        <nav className="nav-tabs">
          <button 
            className={`tab-button ${activeTab === 'bazaar' ? 'active' : ''}`}
            onClick={() => setActiveTab('bazaar')}
          >
            Bazaar Flipping
          </button>
          <button 
            className={`tab-button ${activeTab === 'auctions' ? 'active' : ''}`}
            onClick={() => setActiveTab('auctions')}
          >
            AH Sniping
          </button>
          <button 
            className={`tab-button ${activeTab === 'shards' ? 'active' : ''}`}
            onClick={() => setActiveTab('shards')}
          >
            Shard Fusions
          </button>
        </nav>
      </header>

      <main className="content-area">
        {renderContent()}
      </main>
    </div>
  )
}

export default App
