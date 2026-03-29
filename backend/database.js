const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // Create Bazaar table
  db.run(`
    CREATE TABLE IF NOT EXISTS bazaar (
      productId TEXT PRIMARY KEY,
      buyPrice REAL,
      sellPrice REAL,
      buyVolume INTEGER,
      sellVolume INTEGER,
      lastUpdated INTEGER
    )
  `);

  // Create Auctions table
  db.run(`
    CREATE TABLE IF NOT EXISTS auctions (
      uuid TEXT PRIMARY KEY,
      item_name TEXT,
      tier TEXT,
      category TEXT,
      starting_bid REAL,
      highest_bid_amount REAL,
      bin BOOLEAN,
      start INTEGER,
      end INTEGER,
      lastUpdated INTEGER
    )
  `);

  // Create SkyCofl History table
  db.run(`
    CREATE TABLE IF NOT EXISTS skycofl_history (
      item_id TEXT PRIMARY KEY,
      average_bin REAL,
      sales_last_day INTEGER,
      lastUpdated INTEGER
    )
  `);
});

module.exports = {
  db,
  
  // Bazaar queries
  updateBazaar(products) {
    const stmt = db.prepare(`
      INSERT INTO bazaar (productId, buyPrice, sellPrice, buyVolume, sellVolume, lastUpdated)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(productId) DO UPDATE SET
        buyPrice = excluded.buyPrice,
        sellPrice = excluded.sellPrice,
        buyVolume = excluded.buyVolume,
        sellVolume = excluded.sellVolume,
        lastUpdated = excluded.lastUpdated
    `);
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      for (const [productId, data] of Object.entries(products)) {
        const qs = data.quick_status;
        stmt.run(
          productId,
          qs.buyPrice,
          qs.sellPrice,
          qs.buyVolume,
          qs.sellVolume,
          Date.now()
        );
      }
      db.run('COMMIT');
    });
    stmt.finalize();
  },

  getBazaar(callback) {
    db.all('SELECT * FROM bazaar', (err, rows) => {
      callback(err, rows);
    });
  },

  // Auction queries
  updateAuctions(auctionsList) {
    const stmt = db.prepare(`
      INSERT INTO auctions (uuid, item_name, tier, category, starting_bid, highest_bid_amount, bin, start, end, lastUpdated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(uuid) DO UPDATE SET
        highest_bid_amount = excluded.highest_bid_amount,
        lastUpdated = excluded.lastUpdated
    `);
    
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      for (const auc of auctionsList) {
        if (!auc.bin) continue; // Only tracking BINs for sniffing MVP
        stmt.run(
          auc.uuid,
          auc.item_name,
          auc.tier,
          auc.category,
          auc.starting_bid,
          auc.highest_bid_amount || auc.starting_bid,
          auc.bin ? 1 : 0,
          auc.start,
          auc.end,
          Date.now()
        );
      }
      db.run('COMMIT');
    });
    stmt.finalize();
  },

  getAuctions(callback) {
    // Only return active auctions
    const now = Date.now();
    db.all('SELECT * FROM auctions WHERE end > ? ORDER BY starting_bid ASC', [now], (err, rows) => {
      callback(err, rows);
    });
  },

  // SkyCofl queries
  updateSkyCoflHistory(historyData) {
    const stmt = db.prepare(`
      INSERT INTO skycofl_history (item_id, average_bin, sales_last_day, lastUpdated)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(item_id) DO UPDATE SET
        average_bin = excluded.average_bin,
        sales_last_day = excluded.sales_last_day,
        lastUpdated = excluded.lastUpdated
    `);
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      for (const item of historyData) {
        stmt.run(item.id, item.average_bin, item.sales_last_day, Date.now());
      }
      db.run('COMMIT');
    });
    stmt.finalize();
  },

  getSkyCoflHistory(itemId, callback) {
    db.get('SELECT * FROM skycofl_history WHERE item_id = ?', [itemId], (err, row) => {
      callback(err, row);
    });
  }
};
