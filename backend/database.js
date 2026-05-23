require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);
const DB_TIMEOUT_MS = 10000;
const HUNTING_GUIDES_TABLE = 'hunting_guides';

const withTimeout = (promise, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${DB_TIMEOUT_MS}ms`)), DB_TIMEOUT_MS))
]);

module.exports = {
  supabase,

  isConfigured() {
    return Boolean(supabaseUrl && supabaseKey);
  },
  
  // Bazaar queries
  async updateBazaar(products) {
    const rows = Object.entries(products).map(([productId, data]) => {
      const qs = data.quick_status;
      return {
        productId,
        buyPrice: qs.buyPrice,
        sellPrice: qs.sellPrice,
        buyVolume: qs.buyVolume,
        sellVolume: qs.sellVolume,
        lastUpdated: Date.now()
      };
    });
    
    // Payload size is ~650kb for 5000 items, fitting safely inside standard PostgreSQL DSN limits.
    const { error } = await withTimeout(supabase.from('bazaar').upsert(rows), 'updateBazaar');
    if (error) console.error("Error updating bazaar:", error);
  },

  async getBazaar(callback) {
    try {
      let bData = [];
      let iData = [];
      let page = 0;
      
      while (true) {
        const { data, error } = await withTimeout(
          supabase.from('bazaar').select('*').range(page * 1000, (page + 1) * 1000 - 1),
          'getBazaar bazaar page'
        );
        if (error) throw error;
        bData = bData.concat(data);
        if (data.length < 1000) break;
        page++;
      }
      
      page = 0;
      while (true) {
        const { data, error } = await withTimeout(
          supabase.from('items').select('id, npc_sell_price').range(page * 1000, (page + 1) * 1000 - 1),
          'getBazaar items page'
        );
        if (error) throw error;
        iData = iData.concat(data);
        if (data.length < 1000) break;
        page++;
      }
      
      const itemMap = {};
      iData.forEach(i => itemMap[i.id] = i.npc_sell_price);
      
      const rows = bData.map(b => ({
        ...b,
        npc_sell_price: itemMap[b.productId] || null
      }));
      
      callback(null, rows);
    } catch (err) {
      callback(err, []);
    }
  },

  // Auction queries
  async updateAuctions(auctionsList) {
    const rows = auctionsList.filter(auc => auc.bin).map(auc => ({
      uuid: auc.uuid,
      item_name: auc.item_name,
      tier: auc.tier,
      category: auc.category,
      starting_bid: auc.starting_bid,
      highest_bid_amount: auc.highest_bid_amount || auc.starting_bid,
      bin: auc.bin,
      start: auc.start,
      end: auc.end,
      lastUpdated: Date.now()
    }));
    
    // Chunk auctions if there are too many returned by the single page MVP poll
    if (rows.length === 0) return;
    const { error } = await withTimeout(supabase.from('auctions').upsert(rows), 'updateAuctions');
    if (error) console.error("Error updating auctions:", error);
  },

  async getAuctions(callback) {
    try {
      const now = Date.now();
      const { data, error } = await withTimeout(supabase
        .from('auctions')
        .select('*')
        .gt('end', now)
        .order('starting_bid', { ascending: true })
        .limit(500), 'getAuctions');
        
      if (error) throw error;
      callback(null, data || []);
    } catch (err) {
      callback(err, []);
    }
  },

  // SkyCofl queries
  async updateSkyCoflHistory(historyData) {
    const rows = historyData.map(item => ({
      item_id: item.id,
      average_bin: item.average_bin,
      sales_last_day: item.sales_last_day,
      lastUpdated: Date.now()
    }));
    const { error } = await withTimeout(supabase.from('skycofl_history').upsert(rows), 'updateSkyCoflHistory');
    if (error) console.error("Error updating skycofl history:", error);
  },

  async getSkyCoflHistory(itemId, callback) {
    try {
      const { data, error } = await withTimeout(supabase
        .from('skycofl_history')
        .select('*')
        .eq('item_id', itemId)
        .single(), 'getSkyCoflHistory');
        
      if (error && error.code !== 'PGRST116') throw error; // PGRST116 = 0 rows returned
      callback(null, data || null);
    } catch (err) {
      callback(err, null);
    }
  },

  // Items queries
  async updateItems(itemsList) {
    const rows = itemsList
      .filter(item => item.npc_sell_price !== undefined)
      .map(item => ({
        id: item.id,
        npc_sell_price: item.npc_sell_price
      }));
      
    if (rows.length === 0) return;
    const { error } = await withTimeout(supabase.from('items').upsert(rows), 'updateItems');
    if (error) console.error("Error updating items:", error);
  },

  async getHuntingGuides() {
    const { data, error } = await withTimeout(
      supabase
        .from(HUNTING_GUIDES_TABLE)
        .select('id, data, created_at, updated_at')
        .order('updated_at', { ascending: false }),
      'getHuntingGuides'
    );
    if (error) throw error;
    return (data || []).map((row) => ({
      ...(row.data || {}),
      id: row.id,
      createdAt: row.data?.createdAt ?? row.created_at ?? 0,
      updatedAt: row.data?.updatedAt ?? row.updated_at ?? 0,
    }));
  },

  async upsertHuntingGuide(guide) {
    const row = {
      id: guide.id,
      data: guide,
      created_at: Number(guide.createdAt || Date.now()),
      updated_at: Number(guide.updatedAt || Date.now()),
    };
    const { error } = await withTimeout(
      supabase.from(HUNTING_GUIDES_TABLE).upsert(row, { onConflict: 'id' }),
      'upsertHuntingGuide'
    );
    if (error) throw error;
  },

  async upsertHuntingGuides(guides) {
    const rows = guides.map((guide) => ({
      id: guide.id,
      data: guide,
      created_at: Number(guide.createdAt || Date.now()),
      updated_at: Number(guide.updatedAt || Date.now()),
    }));
    if (rows.length === 0) return;
    const { error } = await withTimeout(
      supabase.from(HUNTING_GUIDES_TABLE).upsert(rows, { onConflict: 'id' }),
      'upsertHuntingGuides'
    );
    if (error) throw error;
  },

  async deleteHuntingGuide(id) {
    const { error } = await withTimeout(
      supabase.from(HUNTING_GUIDES_TABLE).delete().eq('id', id),
      'deleteHuntingGuide'
    );
    if (error) throw error;
  }
};
