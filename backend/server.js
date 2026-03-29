const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const db = require('./database.js');

const app = express();
app.use(cors());
const port = 3000;

const HYPIXEL_API_KEY = process.env.HYPIXEL_API_KEY || '';
const SKYCOFL_API_KEY = process.env.SKYCOFL_API_KEY || '';

// --- Routes ---
app.get('/api/bazaar', (req, res) => {
  db.getBazaar((err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/auctions', (req, res) => {
  db.getAuctions((err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Endpoint to fetch SkyCofl data for an item (caches into SQLite)
app.get('/api/skycofl-fetch/:id', async (req, res) => {
  const itemId = req.params.id;
  db.getSkyCoflHistory(itemId, async (err, row) => {
    if (row && Date.now() - row.lastUpdated < 3600000) {
      // Return cached if younger than 1 hour
      return res.json(row);
    }
    
    // Otherwise fetch
    try {
      const config = {};
      if (SKYCOFL_API_KEY) {
        // Different tokens expect different headers depending on your Coflnet plan.
        config.headers = { 'Authorization': SKYCOFL_API_KEY };
      }
      const coflRes = await axios.get(`https://sky.coflnet.com/api/item/price/${itemId}`, config);
      // Based on typical Coflnet API, adjust fields as needed. Using buy/sell as fallback avg.
      const average = coflRes.data.buy || coflRes.data.sell || coflRes.data.highestBuy || 0;
      db.updateSkyCoflHistory([{ id: itemId, average_bin: average, sales_last_day: coflRes.data.volume || 0 }]);
      res.json({ average_bin: average, sales_last_day: coflRes.data.volume || 0 });
    } catch (error) {
      console.error(`SkyCofl fetch failed for ${itemId}:`, error.message);
      res.status(500).json({ error: 'Failed to fetch from SkyCofl' });
    }
  });
});

// --- Background Polling ---
async function pollBazaar() {
  try {
    const url = 'https://api.hypixel.net/v2/skyblock/bazaar';
    // If user provided a key, maybe add it, but this endpoint is public
    const res = await axios.get(url);
    if (res.data.success) {
      db.updateBazaar(res.data.products);
      console.log(`[${new Date().toLocaleTimeString()}] Updated Bazaar data`);
    }
  } catch (error) {
    console.error('Error polling Bazaar:', error.message);
  }
}

async function pollAuctions() {
  try {
    // Only fetch first few pages to save rate limit and time (Pages 0, 1, 2)
    const pagesToFetch = [0, 1, 2];
    for (const page of pagesToFetch) {
      const url = `https://api.hypixel.net/v2/skyblock/auctions?page=${page}`;
      // In a real prod with a key, pass it as a header "API-Key"
      const res = await axios.get(url);
      if (res.data.success && res.data.auctions) {
        db.updateAuctions(res.data.auctions);
      }
    }
    console.log(`[${new Date().toLocaleTimeString()}] Updated Auctions data`);
  } catch (error) {
    console.error('Error polling Auctions:', error.message);
  }
}

// 1 minute interval for Hypixel rate limit safety (300 req / 5 mins limit = 60 req/min limit)
setInterval(pollBazaar, 60000); 
setInterval(pollAuctions, 60000); 

// Initial poll on startup
pollBazaar();
pollAuctions();

app.listen(port, () => {
  console.log(`Backend server running on http://localhost:${port}`);
});
