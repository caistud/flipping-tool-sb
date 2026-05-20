const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const nbt = require('prismarine-nbt');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
app.use(cors());
app.use(express.json());
const port = process.env.PORT || 3000;

let HYPIXEL_API_KEY = process.env.HYPIXEL_API_KEY || '';
const SKYCOFL_API_KEY = process.env.SKYCOFL_API_KEY || '';
const HTTP_TIMEOUT_MS = 8000;
const MAYOR_ENRICHMENT_TIMEOUT_MS = 3000;
const FUSION_CACHE_MS = 15000;
const BOT_PROFIT_HAIRCUT_RATE = 0.05;
const MAYOR_FLIPS_PATH = path.join(__dirname, 'mayor_flips.json');
const MAYOR_SNAPSHOTS_PATH = path.join(__dirname, 'mayor_price_snapshots.json');
const MAYOR_HISTORY_PATH = path.join(__dirname, 'mayor_history.json');
const HUNTING_GUIDES_PATH = path.join(__dirname, 'hunting_guides.json');
const INVESTMENT_STRATEGIES_PATH = path.join(__dirname, 'investment_strategies.json');
const MAYOR_CACHE_MS = 10 * 60 * 1000;
const MAYOR_SNAPSHOT_INTERVAL_MS = 30 * 60 * 1000;
const MAYOR_BASELINE_DAYS = 30;
const MAX_RECURSIVE_RECIPE_CANDIDATES = 12;
const MANIPULATED_INPUT_SPREAD_LIMIT = 1.5;
const MANIPULATED_OUTPUT_SPREAD_LIMIT = 3.0;
const ENABLE_SUPABASE_MARKET_SYNC = process.env.ENABLE_SUPABASE_MARKET_SYNC === 'true';
const POLL_BAZAAR_MS = Math.max(60000, Number(process.env.POLL_BAZAAR_MS || 120000));
const POLL_AUCTIONS_MS = Math.max(60000, Number(process.env.POLL_AUCTIONS_MS || 180000));
const POLL_ITEMS_MS = Math.max(3600000, Number(process.env.POLL_ITEMS_MS || 21600000));
const NEU_REPO_TREE_URL = 'https://api.github.com/repos/NotEnoughUpdates/NotEnoughUpdates-REPO/git/trees/master?recursive=1';
const NEU_RAW_ITEM_URL = 'https://raw.githubusercontent.com/NotEnoughUpdates/NotEnoughUpdates-REPO/master/items';
const ACCESSORY_RECIPE_CACHE_MS = 6 * 60 * 60 * 1000;
const FORGE_RECIPE_CACHE_MS = 6 * 60 * 60 * 1000;
const SKYSHARDS_CANONICAL_RECIPES = {
  SHARD_WATER_HYDRA: [
    ['SHARD_AZURE', 'SHARD_FIRE_EEL'],
  ],
};

const timedGet = (url, config = {}) => axios.get(url, { timeout: HTTP_TIMEOUT_MS, ...config });

let db = null;
function getDb() {
  if (!db) db = require('./database.js');
  return db;
}

function liveBazaarRows() {
  return Object.entries(rawBazaarCache || {}).map(([productId, data]) => {
    const qs = data.quick_status || {};
    return {
      productId,
      buyPrice: Number(qs.buyPrice || 0),
      sellPrice: Number(qs.sellPrice || 0),
      buyVolume: Number(qs.buyVolume || 0),
      sellVolume: Number(qs.sellVolume || 0),
      lastUpdated: rawBazaarLastFetch || Date.now(),
      npc_sell_price: npcSellPriceCache[productId] ?? null,
      source: 'live-hypixel',
    };
  });
}

async function sendBazaarRows(res) {
  await refreshRawBazaarCache();

  const fallbackRows = liveBazaarRows();
  if (fallbackRows.length > 0) return res.json(fallbackRows);
  return res.status(503).json({ error: 'No live Hypixel Bazaar data available' });
}

// --- Health / configuration status ---
app.get('/api/health', (req, res) => {
    res.json({
        ok: true,
        service: 'skyblock-flip-backend',
        hypixelKeyConfigured: Boolean(HYPIXEL_API_KEY),
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
    });
});

app.get('/api/settings/apikey', (req, res) => {
    res.json({ configured: Boolean(HYPIXEL_API_KEY) });
});

app.post('/api/settings/apikey', (req, res) => {
    res.status(410).json({ error: 'Runtime API key updates are disabled. Set HYPIXEL_API_KEY in the backend environment.' });
});

app.post('/api/settings/restart', (req, res) => {
    res.status(410).json({ error: 'Remote restart is disabled for deployed environments.' });
});

// --- Custom Recipe CRUD ---
const CUSTOM_RECIPES_PATH = path.join(__dirname, 'custom_recipes.json');

const readCustomRecipes = () => {
    try {
        if (!fs.existsSync(CUSTOM_RECIPES_PATH)) return [];
        return JSON.parse(fs.readFileSync(CUSTOM_RECIPES_PATH, 'utf8')) || [];
    } catch { return []; }
};

const writeCustomRecipes = (recipes) => {
    fs.writeFileSync(CUSTOM_RECIPES_PATH, JSON.stringify(recipes, null, 2), 'utf8');
};

const readHuntingGuides = () => {
    try {
        if (!fs.existsSync(HUNTING_GUIDES_PATH)) return [];
        const parsed = JSON.parse(fs.readFileSync(HUNTING_GUIDES_PATH, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.error('Failed to read hunting guides:', error.message);
        return [];
    }
};

const writeHuntingGuides = (guides) => {
    fs.writeFileSync(HUNTING_GUIDES_PATH, JSON.stringify(guides, null, 2), 'utf8');
};

const defaultInvestmentStrategies = () => ([
    {
        id: 'cyclical_investing_strategy',
        title: 'Cyclical Investing Strategy',
        category: 'General Investing',
        summary: 'Buy predictable event or mayor-related items during supply-heavy dips, then hold until the next demand cycle or supply drought.',
        rules: [
            'Identify repeatable cycles: mayors, festivals, events, patches, dungeon/slayer/fishing rotations.',
            'Buy when the active cycle creates extra supply and impatient sellers undercut.',
            'Use source-date or normal baseline prices to avoid buying late into a rebound.',
            'Prefer liquid items when holding a large bankroll; use niche items only when the discount is large.',
            'Sell in layers before or during the next demand spike instead of trying to catch the exact top.'
        ],
        examples: 'Paul dungeon books, Scorpius enchants, Marina fishing materials, Diana ritual items.',
        risk: 'Main risks are long hold time, update changes, low liquidity, and buying before the real bottom.',
        source: 'User strategy seed',
        tags: ['cycle', 'mayor', 'event', 'swing-trade'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
    }
]);

const readInvestmentStrategies = () => {
    try {
        if (!fs.existsSync(INVESTMENT_STRATEGIES_PATH)) {
            const seeded = defaultInvestmentStrategies();
            fs.writeFileSync(INVESTMENT_STRATEGIES_PATH, JSON.stringify(seeded, null, 2), 'utf8');
            return seeded;
        }
        const parsed = JSON.parse(fs.readFileSync(INVESTMENT_STRATEGIES_PATH, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.error('Failed to read investment strategies:', error.message);
        return [];
    }
};

const writeInvestmentStrategies = (strategies) => {
    fs.writeFileSync(INVESTMENT_STRATEGIES_PATH, JSON.stringify(strategies, null, 2), 'utf8');
};

const cleanGuideText = (value, maxLength = 12000) => String(value || '').trim().slice(0, maxLength);

const shardNameByInternalId = () => {
    const map = {};
    Object.values(skyshardsData.shards || {}).forEach((shard) => {
        if (shard.internal_id) map[shard.internal_id] = shard.name || shard.internal_id;
    });
    return map;
};

app.get('/api/custom-recipes', (req, res) => {
    res.json(readCustomRecipes());
});

app.post('/api/custom-recipes', (req, res) => {
    const { outputInternalId, outputName, qtyYielded, family, inputs } = req.body;
    if (!outputInternalId || !outputName || !qtyYielded || !inputs || !inputs.length) {
        return res.status(400).json({ error: 'Missing required fields: outputInternalId, outputName, qtyYielded, inputs' });
    }
    for (const inp of inputs) {
        if (!inp.id || !inp.name || !inp.qty || inp.qty < 1) {
            return res.status(400).json({ error: `Invalid input: ${JSON.stringify(inp)}` });
        }
    }
    const recipes = readCustomRecipes();
    const newRecipe = { outputInternalId, outputName, qtyYielded: parseInt(qtyYielded), family: family || 'NONE', inputs, fee: 0 };
    recipes.push(newRecipe);
    writeCustomRecipes(recipes);
    bootSkyShards(); // Hot-reload
    res.json({ success: true, recipe: newRecipe, totalCustom: recipes.length });
});

app.delete('/api/custom-recipes/:index', (req, res) => {
    const idx = parseInt(req.params.index, 10);
    const recipes = readCustomRecipes();
    if (isNaN(idx) || idx < 0 || idx >= recipes.length) {
        return res.status(404).json({ error: 'Recipe index out of range' });
    }
    const removed = recipes.splice(idx, 1)[0];
    writeCustomRecipes(recipes);
    bootSkyShards(); // Hot-reload
    res.json({ success: true, removed });
});

app.get('/api/hunting-guides', async (req, res) => {
    try {
        await refreshRawBazaarCache();
    } catch (error) {
        console.error('Failed to refresh bazaar data for hunting guides:', error.message);
    }

    const names = shardNameByInternalId();
    const guides = readHuntingGuides()
        .map((guide, index) => {
            const quickStatus = rawBazaarCache[guide.shardId]?.quick_status || {};
            const instaSellPrice = Number(quickStatus.sellPrice || 0);
            const sellOrderPrice = Number(quickStatus.buyPrice || 0);
            const userShardsPerHour = Number(guide.userShardsPerHour || 0);
            const baseShardsPerHour = Number(guide.baseShardsPerHour || 0);

            return {
                ...guide,
                index,
                shardName: guide.shardName || names[guide.shardId] || guide.shardId,
                shardPrices: {
                    instasell: instaSellPrice,
                    sellOrder: sellOrderPrice,
                },
                huntingProfitPerHour: {
                    instasell: userShardsPerHour * instaSellPrice,
                    sellOrder: userShardsPerHour * sellOrderPrice,
                    baseInstasell: baseShardsPerHour * instaSellPrice,
                    baseSellOrder: baseShardsPerHour * sellOrderPrice,
                },
            };
        })
        .sort((a, b) => (a.shardName || '').localeCompare(b.shardName || ''));
    res.json(guides);
});

app.post('/api/hunting-guides', (req, res) => {
    const { shardId, shardName, location, setup, steps, notes, source, tags } = req.body || {};
    if (!shardId) return res.status(400).json({ error: 'Missing shardId' });

    const names = shardNameByInternalId();
    const now = Date.now();
    const guide = {
        id: `${shardId}_${now}`,
        shardId,
        shardName: cleanGuideText(shardName || names[shardId] || shardId, 120),
        location: cleanGuideText(location, 500),
        baseShardsPerHour: Number(req.body.baseShardsPerHour || 0),
        userFortune: Number(req.body.userFortune || 0),
        userShardsPerHour: Number(req.body.userShardsPerHour || 0),
        setup: cleanGuideText(setup, 2000),
        steps: cleanGuideText(steps, 12000),
        notes: cleanGuideText(notes, 4000),
        source: cleanGuideText(source, 1000),
        tags: Array.isArray(tags) ? tags.map((tag) => cleanGuideText(tag, 40)).filter(Boolean).slice(0, 12) : [],
        createdAt: now,
        updatedAt: now,
    };

    const guides = readHuntingGuides();
    guides.push(guide);
    writeHuntingGuides(guides);
    res.json({ success: true, guide, total: guides.length });
});

app.put('/api/hunting-guides/:id', (req, res) => {
    const guides = readHuntingGuides();
    const idx = guides.findIndex((guide) => guide.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Guide not found' });

    const current = guides[idx];
    const names = shardNameByInternalId();
    const next = {
        ...current,
        shardId: req.body.shardId || current.shardId,
        shardName: cleanGuideText(req.body.shardName || current.shardName || names[req.body.shardId || current.shardId] || current.shardId, 120),
        location: cleanGuideText(req.body.location, 500),
        baseShardsPerHour: Number(req.body.baseShardsPerHour || 0),
        userFortune: Number(req.body.userFortune || 0),
        userShardsPerHour: Number(req.body.userShardsPerHour || 0),
        setup: cleanGuideText(req.body.setup, 2000),
        steps: cleanGuideText(req.body.steps, 12000),
        notes: cleanGuideText(req.body.notes, 4000),
        source: cleanGuideText(req.body.source, 1000),
        tags: Array.isArray(req.body.tags) ? req.body.tags.map((tag) => cleanGuideText(tag, 40)).filter(Boolean).slice(0, 12) : [],
        updatedAt: Date.now(),
    };

    guides[idx] = next;
    writeHuntingGuides(guides);
    res.json({ success: true, guide: next });
});

app.delete('/api/hunting-guides/:id', (req, res) => {
    const guides = readHuntingGuides();
    const next = guides.filter((guide) => guide.id !== req.params.id);
    if (next.length === guides.length) return res.status(404).json({ error: 'Guide not found' });
    writeHuntingGuides(next);
    res.json({ success: true, total: next.length });
});

app.get('/api/investment-strategies', (req, res) => {
    res.json(readInvestmentStrategies().sort((a, b) => (a.category || '').localeCompare(b.category || '') || (a.title || '').localeCompare(b.title || '')));
});

app.post('/api/investment-strategies', (req, res) => {
    const now = Date.now();
    const strategy = {
        id: cleanGuideText(req.body.id || `${String(req.body.title || 'strategy').toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${now}`, 120),
        title: cleanGuideText(req.body.title, 160),
        category: cleanGuideText(req.body.category || 'General Investing', 120),
        summary: cleanGuideText(req.body.summary, 2000),
        rules: Array.isArray(req.body.rules) ? req.body.rules.map((rule) => cleanGuideText(rule, 500)).filter(Boolean) : [],
        examples: cleanGuideText(req.body.examples, 2000),
        risk: cleanGuideText(req.body.risk, 2000),
        source: cleanGuideText(req.body.source, 1000),
        tags: Array.isArray(req.body.tags) ? req.body.tags.map((tag) => cleanGuideText(tag, 40)).filter(Boolean).slice(0, 12) : [],
        createdAt: now,
        updatedAt: now,
    };
    if (!strategy.title) return res.status(400).json({ error: 'Missing title' });
    const strategies = readInvestmentStrategies().filter((item) => item.id !== strategy.id);
    strategies.push(strategy);
    writeInvestmentStrategies(strategies);
    res.json({ success: true, strategy });
});

app.put('/api/investment-strategies/:id', (req, res) => {
    const strategies = readInvestmentStrategies();
    const idx = strategies.findIndex((strategy) => strategy.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Strategy not found' });
    const current = strategies[idx];
    const next = {
        ...current,
        title: cleanGuideText(req.body.title || current.title, 160),
        category: cleanGuideText(req.body.category || current.category || 'General Investing', 120),
        summary: cleanGuideText(req.body.summary, 2000),
        rules: Array.isArray(req.body.rules) ? req.body.rules.map((rule) => cleanGuideText(rule, 500)).filter(Boolean) : [],
        examples: cleanGuideText(req.body.examples, 2000),
        risk: cleanGuideText(req.body.risk, 2000),
        source: cleanGuideText(req.body.source, 1000),
        tags: Array.isArray(req.body.tags) ? req.body.tags.map((tag) => cleanGuideText(tag, 40)).filter(Boolean).slice(0, 12) : [],
        updatedAt: Date.now(),
    };
    strategies[idx] = next;
    writeInvestmentStrategies(strategies);
    res.json({ success: true, strategy: next });
});

app.delete('/api/investment-strategies/:id', (req, res) => {
    const strategies = readInvestmentStrategies();
    const next = strategies.filter((strategy) => strategy.id !== req.params.id);
    if (next.length === strategies.length) return res.status(404).json({ error: 'Strategy not found' });
    writeInvestmentStrategies(next);
    res.json({ success: true, total: next.length });
});

app.get('/api/hunt-fuse', async (req, res) => {
    try {
        await refreshRawBazaarCache();
        const outMode = req.query.outMode || 'insta-sell';
        const inMode = req.query.inMode || 'insta-buy';
        const minProfit = Number(req.query.minProfit || 0);
        const allGuides = readHuntingGuides();
        const selectedShardIds = String(req.query.huntedShardIds || '')
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean);
        const selectedShardSet = new Set(selectedShardIds);
        const activeGuides = selectedShardSet.size > 0
            ? allGuides.filter((guide) => selectedShardSet.has(guide.shardId))
            : allGuides;
        const guideMap = new Map(activeGuides.map((guide) => [guide.shardId, guide]));
        const names = shardNameByInternalId();
        const opportunities = [];

        for (const rec of flattenedRecipes) {
            const outBz = rawBazaarCache[rec.outputInternalId];
            if (!outBz?.quick_status) continue;

            const huntedInputs = rec.inputs.filter((input) => guideMap.has(input.id));
            if (huntedInputs.length === 0) continue;

            const outputUnitPrice = outMode === 'sell-order'
                ? Number(outBz.quick_status.buyPrice || 0)
                : Number(outBz.quick_status.sellPrice || 0);
            if (!Number.isFinite(outputUnitPrice) || outputUnitPrice <= 0) continue;

            for (const hunted of huntedInputs) {
                let paidInputCost = 0;
                let valid = true;
                const paidInputs = [];

                for (const input of rec.inputs) {
                    if (input.id === hunted.id) continue;
                    const cost = marketCostForQty(input.id, input.qty, inMode);
                    if (cost === null) {
                        valid = false;
                        break;
                    }
                    paidInputCost += cost;
                    paidInputs.push({
                        id: input.id,
                        name: input.name || names[input.id] || input.id,
                        qty: input.qty,
                        cost,
                    });
                }
                if (!valid) continue;

                const revenue = outputUnitPrice * rec.qtyYielded;
                const profitPerCraft = revenue - paidInputCost;
                const valuePerHuntedShard = hunted.qty > 0 ? profitPerCraft / hunted.qty : 0;
                if (valuePerHuntedShard < minProfit) continue;

                const guide = guideMap.get(hunted.id);
                opportunities.push({
                    huntedShardId: hunted.id,
                    huntedShardName: hunted.name || names[hunted.id] || hunted.id,
                    huntedQtyNeeded: hunted.qty,
                    guideId: guide.id,
                    guideLocation: guide.location || '',
                    guideTags: guide.tags || [],
                    baseShardsPerHour: Number(guide.baseShardsPerHour || 0),
                    userFortune: Number(guide.userFortune || 0),
                    userShardsPerHour: Number(guide.userShardsPerHour || 0),
                    profitPerHour: Number(guide.userShardsPerHour || 0) * valuePerHuntedShard,
                    baseProfitPerHour: Number(guide.baseShardsPerHour || 0) * valuePerHuntedShard,
                    outputId: rec.outputInternalId,
                    outputName: rec.outputName,
                    outputQty: rec.qtyYielded,
                    outputUnitPrice,
                    outMode,
                    revenue,
                    paidInputCost,
                    profitPerCraft,
                    valuePerHuntedShard,
                    paidInputs,
                    recipeInputs: rec.inputs.map((input) => ({
                        id: input.id,
                        name: input.name || names[input.id] || input.id,
                        qty: input.qty,
                        hunted: input.id === hunted.id,
                    })),
                    volumePerHour: Number(outBz.quick_status.buyMovingWeek || 0) / 168,
                    safeSellable: Math.floor(Number(outBz.quick_status.buyMovingWeek || 0) / 48),
                });
            }
        }

        opportunities.sort((a, b) => b.profitPerHour - a.profitPerHour || b.valuePerHuntedShard - a.valuePerHuntedShard || b.profitPerCraft - a.profitPerCraft);
        res.json({
            rows: opportunities.slice(0, Math.min(500, Math.max(25, Number(req.query.limit || 100)))),
            guideCount: guideMap.size,
            totalGuideCount: allGuides.length,
            selectedShardIds,
            guideOptions: allGuides
                .map((guide) => ({
                    shardId: guide.shardId,
                    shardName: guide.shardName || names[guide.shardId] || guide.shardId,
                    location: guide.location || '',
                    userShardsPerHour: Number(guide.userShardsPerHour || 0),
                    baseShardsPerHour: Number(guide.baseShardsPerHour || 0),
                }))
                .sort((a, b) => (a.shardName || '').localeCompare(b.shardName || '')),
            scannedRecipes: flattenedRecipes.length,
            updatedAt: Date.now(),
        });
    } catch (error) {
        console.error('Crash in hunt-fuse:', error);
        res.status(500).json({ error: 'Failed to calculate hunt fuse opportunities', details: error.message });
    }
});

// Expose all known shards for the recipe builder dropdown
app.get('/api/shard-list', (req, res) => {
    const shards = skyshardsData.shards;
    const list = Object.entries(shards)
        .filter(([, s]) => s.internal_id)
        .map(([key, s]) => ({
            key,
            internalId: s.internal_id,
            name: s.name,
            fuseAmount: s.fuse_amount || 1,
            rarity: s.rarity || '',
            family: s.family || '',
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    res.json(list);
});

// --- Routes ---
app.get('/api/bazaar', async (req, res) => {
  try {
    await sendBazaarRows(res);
  } catch (error) {
    console.error('Crash in /api/bazaar:', error.message);
    const fallbackRows = liveBazaarRows();
    if (fallbackRows.length > 0) return res.json(fallbackRows);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/auctions', async (req, res) => {
  if (liveAuctionsCache.length === 0 || Date.now() - liveAuctionsLastFetch > POLL_AUCTIONS_MS) {
    await pollAuctions();
  }

  if (liveAuctionsCache.length > 0) return res.json(liveAuctionsCache);
  return res.status(503).json({ error: 'No live Hypixel Auction data available' });
});

// Endpoint to fetch SkyCofl data for an item (in-memory cache only)
app.get('/api/skycofl-fetch/:id', async (req, res) => {
  const itemId = req.params.id;
  const cached = skyCoflPriceCache.get(itemId);
  if (cached && Date.now() - cached.lastUpdated < 60 * 60 * 1000) {
    return res.json(cached);
  }

  try {
    const config = {};
    if (SKYCOFL_API_KEY) {
      // Different tokens expect different headers depending on your Coflnet plan.
      config.headers = { 'Authorization': SKYCOFL_API_KEY };
    }
    const coflRes = await timedGet(`https://sky.coflnet.com/api/item/price/${encodeURIComponent(itemId)}`, config);
    const row = {
      item_id: itemId,
      average_bin: Math.floor(coflRes.data.median || coflRes.data.mode || coflRes.data.min || 0),
      sales_last_day: coflRes.data.volume || 0,
      lastUpdated: Date.now(),
      source: 'skycofl-live-cache',
    };
    skyCoflPriceCache.set(itemId, row);
    res.json(row);
  } catch (error) {
    console.error(`SkyCofl fetch failed for ${itemId}:`, error.message);
    res.status(500).json({ error: 'Failed to fetch from SkyCofl' });
  }
});

// Raw Live Proxy for Hypixel to parse 'sellMovingWeek'
let rawBazaarCache = {};
let rawBazaarLastFetch = 0;
let rawBazaarRefreshPromise = null;
let liveAuctionsCache = [];
let liveAuctionsLastFetch = 0;
let npcSellPriceCache = {};
const skyCoflPriceCache = new Map();
const bestFusionsCache = new Map();
const batchOptimizeCache = new Map();
let electionCache = null;
let electionLastFetch = 0;
let mayorSnapshotLastWrite = 0;
const mayorHistoricalPriceCache = new Map();

async function refreshRawBazaarCache(force = false) {
  const isFresh = Date.now() - rawBazaarLastFetch <= 60000 && Object.keys(rawBazaarCache).length > 0;
  if (!force && isFresh) return rawBazaarCache;

  if (!rawBazaarRefreshPromise) {
    rawBazaarRefreshPromise = timedGet('https://api.hypixel.net/v2/skyblock/bazaar')
      .then((resp) => {
        if (resp.data.success) {
          rawBazaarCache = resp.data.products;
          rawBazaarLastFetch = Date.now();
        }
        return rawBazaarCache;
      })
      .catch((e) => {
        console.error('Failed to update raw bazaar cache', e.message);
        return rawBazaarCache;
      })
      .finally(() => {
        rawBazaarRefreshPromise = null;
      });
  }

  return rawBazaarRefreshPromise;
}

app.get('/api/bazaar', async (req, res) => {
  try {
    await sendBazaarRows(res);
  } catch (error) {
    console.error('Crash in /api/bazaar:', error.message);
    const fallbackRows = liveBazaarRows();
    if (fallbackRows.length > 0) return res.json(fallbackRows);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/bazaar-live', async (req, res) => {
  res.json(await refreshRawBazaarCache());
});

function readMayorFlipConfig() {
  try {
    return JSON.parse(fs.readFileSync(MAYOR_FLIPS_PATH, 'utf8')) || [];
  } catch (error) {
    console.error('Failed to read mayor flip config:', error.message);
    return [];
  }
}

function displayItemName(itemId) {
  return String(itemId || '')
    .replace(/^ENCHANTMENT_/, '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function readBazaarRowsMap() {
  await refreshRawBazaarCache();
  return Object.fromEntries(liveBazaarRows().map((row) => [row.productId, row]));
}

function summarizeBazaarProduct(productId, bazaarRowsMap = {}) {
  const product = rawBazaarCache[productId];
  if (!product?.quick_status) {
    const row = bazaarRowsMap[productId];
    if (!row) return null;

    const buyPrice = Number(row.buyPrice || 0);
    const sellPrice = Number(row.sellPrice || 0);
    const spread = buyPrice - sellPrice;
    const margin = sellPrice > 0 ? (spread / sellPrice) * 100 : 0;
    const buyVolume = Number(row.buyVolume || 0);
    const sellVolume = Number(row.sellVolume || 0);
    const orderBookVolume = buyVolume + sellVolume;

    return {
      productId,
      name: displayItemName(productId),
      buyPrice,
      sellPrice,
      spread,
      margin,
      buyVolume,
      sellVolume,
      buyMovingWeek: 0,
      sellMovingWeek: 0,
      movingWeek: 0,
      movementPerHour: orderBookVolume / (7 * 24),
      orderBookVolume,
      source: 'stored-bazaar',
    };
  }

  const qs = product.quick_status;
  const buyPrice = Number(qs.buyPrice || 0);
  const sellPrice = Number(qs.sellPrice || 0);
  const spread = buyPrice - sellPrice;
  const margin = sellPrice > 0 ? (spread / sellPrice) * 100 : 0;
  const buyMovingWeek = Number(qs.buyMovingWeek || 0);
  const sellMovingWeek = Number(qs.sellMovingWeek || 0);
  const movingWeek = buyMovingWeek + sellMovingWeek;
  const buyVolume = Number(qs.buyVolume || 0);
  const sellVolume = Number(qs.sellVolume || 0);

  return {
    productId,
    name: displayItemName(productId),
    buyPrice,
    sellPrice,
    spread,
    margin,
    buyVolume,
    sellVolume,
    buyMovingWeek,
    sellMovingWeek,
    movingWeek,
    movementPerHour: movingWeek / (7 * 24),
    orderBookVolume: buyVolume + sellVolume,
    source: 'live-hypixel',
  };
}

async function fetchElectionData() {
  const fresh = electionCache && Date.now() - electionLastFetch < MAYOR_CACHE_MS;
  if (fresh) return electionCache;

  try {
    const response = await timedGet('https://api.hypixel.net/v2/resources/skyblock/election');
    electionCache = response.data || null;
    electionLastFetch = Date.now();
  } catch (error) {
    console.error('Failed to fetch election data:', error.message);
  }

  return electionCache;
}

function normalizeMayorName(name) {
  return String(name || '').trim().toLowerCase();
}

function matchesCanonicalRecipe(outputId, inputs) {
  const allowed = SKYSHARDS_CANONICAL_RECIPES[outputId];
  if (!allowed) return true;
  const sortedInputs = inputs.map((input) => input.id).sort().join('|');
  return allowed.some((recipeIds) => recipeIds.slice().sort().join('|') === sortedInputs);
}

function recipeSignature(recipe) {
  const inputs = (recipe.inputs || [])
    .map((input) => `${input.id}:${Number(input.qty) || 0}`)
    .sort()
    .join('|');
  return `${recipe.outputInternalId}|${recipe.qtyYielded}|${inputs}`;
}

function readMayorSnapshots() {
  try {
    if (!fs.existsSync(MAYOR_SNAPSHOTS_PATH)) return [];
    const parsed = JSON.parse(fs.readFileSync(MAYOR_SNAPSHOTS_PATH, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Failed to read mayor price snapshots:', error.message);
    return [];
  }
}

function writeMayorSnapshots(snapshots) {
  fs.writeFileSync(MAYOR_SNAPSHOTS_PATH, JSON.stringify(snapshots, null, 2), 'utf8');
}

function readMayorHistory() {
  try {
    if (!fs.existsSync(MAYOR_HISTORY_PATH)) return [];
    const parsed = JSON.parse(fs.readFileSync(MAYOR_HISTORY_PATH, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Failed to read mayor history:', error.message);
    return [];
  }
}

function writeMayorHistory(history) {
  fs.writeFileSync(MAYOR_HISTORY_PATH, JSON.stringify(history, null, 2), 'utf8');
}

function recordMayorHistory(election) {
  const mayor = election?.mayor;
  if (!mayor?.name) return readMayorHistory();

  const history = readMayorHistory();
  const electionYear = mayor.election?.year || null;
  const currentKey = `${mayor.key || mayor.name}:${electionYear || 'unknown'}`;
  const lastEntry = history[history.length - 1];

  if (lastEntry?.key === currentKey) {
    lastEntry.lastSeen = Date.now();
    lastEntry.perks = mayor.perks || lastEntry.perks || [];
    writeMayorHistory(history);
    return history;
  }

  if (lastEntry && !lastEntry.endedAt) {
    lastEntry.endedAt = Date.now();
  }

  history.push({
    key: currentKey,
    mayorKey: mayor.key || null,
    name: mayor.name,
    electionYear,
    startedAt: Date.now(),
    lastSeen: Date.now(),
    endedAt: null,
    perks: mayor.perks || [],
  });

  const trimmed = history.slice(-24);
  writeMayorHistory(trimmed);
  return trimmed;
}

function median(values) {
  const nums = values.map(Number).filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function buildMayorBaselines(snapshots, now = Date.now()) {
  const cutoff = now - (MAYOR_BASELINE_DAYS * 24 * 60 * 60 * 1000);
  const recent = snapshots.filter((snap) => Number(snap.t) >= cutoff);
  const byItem = new Map();

  for (const snap of recent) {
    if (!snap.id) continue;
    if (!byItem.has(snap.id)) byItem.set(snap.id, []);
    byItem.get(snap.id).push(snap);
  }

  return {
    get(itemId, mayor) {
      const entries = byItem.get(itemId) || [];
      const normalEntries = entries.filter((entry) => normalizeMayorName(entry.mayor) !== normalizeMayorName(mayor));
      const fallbackEntries = entries;
      const baselineEntries = normalEntries.length >= 3 ? normalEntries : fallbackEntries;
      const normalInstabuy = median(baselineEntries.map((entry) => entry.buyPrice));
      const normalInstasell = median(baselineEntries.map((entry) => entry.sellPrice));
      const sampleCount = baselineEntries.length;
      const excludedMayorSamples = entries.length - normalEntries.length;

      return {
        normalInstabuy,
        normalInstasell,
        sampleCount,
        excludedMayorSamples,
        baselineType: normalEntries.length >= 3 ? 'non-mayor-median' : (sampleCount > 0 ? 'all-samples-median' : 'collecting'),
      };
    }
  };
}

function buildRecentMayorPriceSummary(snapshots, history, trackedIds, now = Date.now()) {
  const recentHistory = history.slice(-6).reverse();
  return recentHistory.map((entry) => {
    const start = Number(entry.startedAt || 0);
    const end = Number(entry.endedAt || entry.lastSeen || now);
    const during = snapshots.filter((snap) => (
      trackedIds.has(snap.id)
      && Number(snap.t) >= start
      && Number(snap.t) <= end
    ));
    const byItem = new Map();

    for (const snap of during) {
      if (!byItem.has(snap.id)) byItem.set(snap.id, []);
      byItem.get(snap.id).push(snap);
    }

    const items = Array.from(byItem.entries()).map(([id, itemSnaps]) => ({
      id,
      name: displayItemName(id),
      medianInstabuy: median(itemSnaps.map((snap) => snap.buyPrice)),
      medianInstasell: median(itemSnaps.map((snap) => snap.sellPrice)),
      sampleCount: itemSnaps.length,
    })).sort((a, b) => (b.sampleCount - a.sampleCount) || a.name.localeCompare(b.name));

    return {
      mayor: entry.name,
      electionYear: entry.electionYear,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      sampleCount: during.length,
      items,
    };
  });
}

async function getHistoricalBazaarSnapshot(itemId, sourceDate) {
  if (!itemId || !sourceDate) return null;
  const key = `${itemId}|${sourceDate}`;
  const cached = mayorHistoricalPriceCache.get(key);
  if (cached && Date.now() - cached.time < 6 * 60 * 60 * 1000) return cached.value;

  try {
    const response = await axios.get(`https://sky.coflnet.com/api/bazaar/${encodeURIComponent(itemId)}/snapshot`, {
      timeout: MAYOR_ENRICHMENT_TIMEOUT_MS,
      params: { timestamp: sourceDate },
      headers: { 'User-Agent': 'skyblock-flips-local-tool' },
    });
    const data = response.data || {};
    const value = {
      buyPrice: Number(data.buyPrice || 0),
      sellPrice: Number(data.sellPrice || 0),
      buyVolume: Number(data.buyVolume || 0),
      sellVolume: Number(data.sellVolume || 0),
      timestamp: data.timeStamp || sourceDate,
      source: 'skycofl',
    };
    mayorHistoricalPriceCache.set(key, { time: Date.now(), value });
    return value;
  } catch (error) {
    const value = { error: error.message };
    mayorHistoricalPriceCache.set(key, { time: Date.now(), value });
    return value;
  }
}

async function withMayorEnrichmentTimeout(promise, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), MAYOR_ENRICHMENT_TIMEOUT_MS)),
  ]);
}

function maybeWriteMayorSnapshots(rows, currentMayorName) {
  if (Date.now() - mayorSnapshotLastWrite < MAYOR_SNAPSHOT_INTERVAL_MS) return false;

  const snapshots = readMayorSnapshots();
  const now = Date.now();
  const cutoff = now - (MAYOR_BASELINE_DAYS * 24 * 60 * 60 * 1000);
  const nextSnapshots = snapshots.filter((snap) => Number(snap.t) >= cutoff);
  const seenThisWrite = new Set();

  for (const row of rows) {
    if (!row.marketFound || !row.id || seenThisWrite.has(row.id)) continue;
    seenThisWrite.add(row.id);
    nextSnapshots.push({
      t: now,
      mayor: currentMayorName || 'Unknown',
      id: row.id,
      buyPrice: Number(row.buyPrice || 0),
      sellPrice: Number(row.sellPrice || 0),
      movementPerHour: Number(row.movementPerHour || 0),
      source: row.source || 'unknown',
    });
  }

  if (seenThisWrite.size === 0) return false;

  writeMayorSnapshots(nextSnapshots);
  mayorSnapshotLastWrite = now;
  return true;
}

app.get('/api/mayor-flips', async (req, res) => {
  try {
    await refreshRawBazaarCache();

    const selectedMayor = normalizeMayorName(req.query.mayor || 'all');
    const sortBy = String(req.query.sortBy || 'movement');
    const minMovement = Number(req.query.minMovement || 0);
    const includeMissing = String(req.query.includeMissing || 'false') === 'true';
    const config = readMayorFlipConfig();
    const election = await fetchElectionData();
    const currentMayorName = election?.mayor?.name || null;
    const mayorHistory = recordMayorHistory(election);
    const bazaarRowsMap = Object.keys(rawBazaarCache).length > 0 ? {} : await readBazaarRowsMap();
    const snapshots = readMayorSnapshots();
    const baselineLookup = buildMayorBaselines(snapshots);
    const trackedIds = new Set(config.flatMap((entry) => entry.items.map((item) => item.id)));

    const mayorConfigs = selectedMayor === 'all'
      ? config
      : config.filter((entry) => normalizeMayorName(entry.mayor) === selectedMayor);

    let rows = mayorConfigs.flatMap((mayorEntry) => (
      mayorEntry.items.map((item) => {
        const market = summarizeBazaarProduct(item.id, bazaarRowsMap);
        if (!market && item.market !== 'auction' && !includeMissing) return null;

        const movement = market?.movementPerHour || 0;
        const spread = market?.spread || 0;
        const margin = market?.margin || 0;
        const liquidityScore = Math.min(100, Math.round(Math.log10(Math.max(1, movement)) * 25));
        const spreadScore = Math.min(100, Math.max(0, Math.round(margin * 3)));
        const watchScore = Math.round((liquidityScore * 0.65) + (spreadScore * 0.35));
        const baseline = baselineLookup.get(item.id, mayorEntry.mayor);
        const normalPrice = baseline.normalInstabuy;
        const priceDelta = normalPrice ? (market?.buyPrice || 0) - normalPrice : null;
        const priceDeltaPercent = normalPrice ? (priceDelta / normalPrice) * 100 : null;

        return {
          mayor: mayorEntry.mayor,
          theme: mayorEntry.theme,
          strategy: mayorEntry.strategy,
          id: item.id,
          name: market?.name || displayItemName(item.id),
          reason: item.reason,
          maxBuy: item.maxBuy || null,
          expectedReturn: item.expectedReturn || null,
          targetReturnPrice: item.targetReturnPrice || null,
          holdTime: item.holdTime || null,
          risk: item.risk || null,
          marketType: item.market || 'bazaar',
          sourceNote: item.source || null,
          sourceDate: item.sourceDate || null,
          isBelowTarget: item.maxBuy ? (market?.buyPrice || 0) <= item.maxBuy : null,
          isCurrentMayor: normalizeMayorName(currentMayorName) === normalizeMayorName(mayorEntry.mayor),
          marketFound: Boolean(market),
          watchScore,
          normalPrice,
          normalInstabuy: baseline.normalInstabuy,
          normalInstasell: baseline.normalInstasell,
          priceDelta,
          priceDeltaPercent,
          baselineSampleCount: baseline.sampleCount,
          baselineType: baseline.baselineType,
          excludedMayorSamples: baseline.excludedMayorSamples,
          ...market,
          spread,
          margin,
        };
      }).filter(Boolean)
    ))
      .filter((row) => !row.marketFound || row.movementPerHour >= minMovement);

    const hasAuctionRows = rows.some((row) => row.marketType === 'auction');
    const lbinData = hasAuctionRows
      ? await withMayorEnrichmentTimeout(ensureLowestBinCache(), {})
      : {};

    rows = await Promise.all(rows.map(async (row) => {
      if (row.marketType === 'auction') {
        const outputPricing = await withMayorEnrichmentTimeout(
          getAccessoryOutputPrice(row.id, lbinData),
          { price: 0, source: 'timeout' }
        );
        const price = outputPricing.price || 0;
        const priceDeltaToTarget = row.maxBuy ? price - row.maxBuy : null;
        const priceDeltaToTargetPercent = row.maxBuy ? (priceDeltaToTarget / row.maxBuy) * 100 : null;
        return {
          ...row,
          marketFound: price > 0,
          buyPrice: price,
          sellPrice: price,
          spread: 0,
          margin: 0,
          movementPerHour: 0,
          orderBookVolume: 0,
          currentPriceSource: outputPricing.source,
          isBelowTarget: row.maxBuy && price > 0 ? price <= row.maxBuy : null,
          priceDeltaToTarget,
          priceDeltaToTargetPercent,
        };
      }

      if (!row.sourceDate || !row.marketFound) return row;
      const sourceSnapshot = await withMayorEnrichmentTimeout(
        getHistoricalBazaarSnapshot(row.id, row.sourceDate),
        { error: 'Historical lookup timed out' }
      );
      if (!sourceSnapshot || sourceSnapshot.error || !sourceSnapshot.buyPrice) {
        return {
          ...row,
          sourcePriceError: sourceSnapshot?.error || 'No historical snapshot',
        };
      }
      const sourceBuyDelta = row.buyPrice - sourceSnapshot.buyPrice;
      const sourceBuyDeltaPercent = sourceSnapshot.buyPrice > 0 ? (sourceBuyDelta / sourceSnapshot.buyPrice) * 100 : null;
      return {
        ...row,
        sourceBuyPrice: sourceSnapshot.buyPrice,
        sourceSellPrice: sourceSnapshot.sellPrice,
        sourceSnapshotAt: sourceSnapshot.timestamp,
        sourceBuyDelta,
        sourceBuyDeltaPercent,
        sourcePriceSource: sourceSnapshot.source,
      };
    }));

    rows = rows
      .sort((a, b) => {
        if (sortBy === 'margin') return (b.margin || 0) - (a.margin || 0);
        if (sortBy === 'spread') return (b.spread || 0) - (a.spread || 0);
        if (sortBy === 'buyPrice') return (b.buyPrice || 0) - (a.buyPrice || 0);
        if (sortBy === 'score') return (b.watchScore || 0) - (a.watchScore || 0);
        return (b.movementPerHour || 0) - (a.movementPerHour || 0);
      });

    const snapshotWritten = maybeWriteMayorSnapshots(rows, currentMayorName);
    const summarySnapshots = snapshotWritten ? readMayorSnapshots() : snapshots;

    res.json({
      currentMayor: currentMayorName,
      currentMayorPerks: election?.mayor?.perks || [],
      election,
      mayors: config.map(({ mayor, theme, strategy, items }) => ({
        mayor,
        theme,
        strategy,
        itemCount: items.length,
      })),
      mayorHistory: mayorHistory.slice(-6).reverse(),
      recentMayorPrices: buildRecentMayorPriceSummary(summarySnapshots, mayorHistory, trackedIds),
      rows,
      updatedAt: Date.now(),
      baselineDays: MAYOR_BASELINE_DAYS,
      snapshotIntervalMinutes: MAYOR_SNAPSHOT_INTERVAL_MS / 60000,
      snapshotWritten,
    });
  } catch (error) {
    console.error('Crash in mayor-flips:', error);
    res.status(500).json({ error: 'Failed to calculate mayor flips', details: error.message });
  }
});

// --- MANUAL RECIPE ENGINE ---
// Recipes come EXCLUSIVELY from custom_recipes.json.
// skyshards_new_fusion_data.json is loaded only for shard metadata (names, fuse amounts) — never for recipes.
const skyshardsData = require('./skyshards_new_fusion_data.json');
let flattenedRecipes = [];
let recipesByOutput = {};

const bootSkyShards = () => {
    flattenedRecipes = [];
    recipesByOutput = {};
    bestFusionsCache.clear();
    batchOptimizeCache.clear();
    const seenRecipeSignatures = new Set();
    const nativeOutputIds = new Set();

    // --- Auto-Load Native Recipes from skyshardsData.recipes (deduplicated) ---
    // The raw data has ~81k permutations because [A,B] and [B,A] are stored separately.
    // We canonicalize each pair (sort the two input IDs) to collapse mirrors into one recipe.
    if (skyshardsData && skyshardsData.recipes) {
        // seenKeys tracks canonical "output|qty|idA|idB" strings to skip duplicates
        const seenKeys = new Set();
        let nativeCount = 0;

        Object.entries(skyshardsData.recipes).forEach(([outputKey, quantMap]) => {
            const outShard = skyshardsData.shards[outputKey];
            if (!outShard || !outShard.internal_id) return;

            Object.entries(quantMap).forEach(([qtyStr, arrOfPairs]) => {
                const qtyYielded = parseInt(qtyStr, 10);
                arrOfPairs.forEach(pair => {
                    const input1 = skyshardsData.shards[pair[0]];
                    const input2 = skyshardsData.shards[pair[1]];
                    if (!input1 || !input1.internal_id || !input2 || !input2.internal_id) return;

                    // Canonical key: sort the two input IDs so [A,B] == [B,A]
                    const sortedIds = [input1.internal_id, input2.internal_id].sort();
                    const canonKey = `${outShard.internal_id}|${qtyYielded}|${sortedIds[0]}|${sortedIds[1]}`;
                    if (seenKeys.has(canonKey)) return;
                    seenKeys.add(canonKey);

                    // Build inputs map using each input shard's required fuse amount.
                    const counts = {};
                    counts[input1.internal_id] = {
                        id: input1.internal_id,
                        name: input1.name,
                        qty: input1.fuse_amount || 1
                    };
                    if (counts[input2.internal_id]) counts[input2.internal_id].qty += (input2.fuse_amount || 1);
                    else {
                        counts[input2.internal_id] = {
                            id: input2.internal_id,
                            name: input2.name,
                            qty: input2.fuse_amount || 1
                        };
                    }

                    const recipeObj = {
                        outputInternalId: outShard.internal_id,
                        outputName: outShard.name,
                        qtyYielded: qtyYielded,
                        family: outShard.family || 'NONE',
                        inputs: Object.values(counts),
                        fee: 0
                    };

                    if (!matchesCanonicalRecipe(recipeObj.outputInternalId, recipeObj.inputs)) return;

                    const signature = recipeSignature(recipeObj);
                    seenRecipeSignatures.add(signature);
                    nativeOutputIds.add(recipeObj.outputInternalId);
                    flattenedRecipes.push(recipeObj);
                    if (!recipesByOutput[recipeObj.outputInternalId]) {
                        recipesByOutput[recipeObj.outputInternalId] = [];
                    }
                    recipesByOutput[recipeObj.outputInternalId].push(recipeObj);
                    nativeCount++;
                });
            });
        });
        console.log(`[SkyShards] Auto-loaded ${nativeCount} unique native recipes (deduped from raw permutations).`);
    }

    // Custom recipes ONLY — no auto-generated permutations
    try {
        const customDbPath = path.join(__dirname, 'custom_recipes.json');
        if (fs.existsSync(customDbPath)) {
            const customData = JSON.parse(fs.readFileSync(customDbPath, 'utf8'));
            if (Array.isArray(customData)) {
                let loadedCustomCount = 0;
                let skippedCustomCount = 0;
                customData.forEach(recipeObj => {
                    const signature = recipeSignature(recipeObj);
                    if (seenRecipeSignatures.has(signature)) {
                        skippedCustomCount++;
                        return;
                    }
                    if (nativeOutputIds.has(recipeObj.outputInternalId)) {
                        skippedCustomCount++;
                        return;
                    }
                    seenRecipeSignatures.add(signature);
                    flattenedRecipes.push(recipeObj);
                    if (!recipesByOutput[recipeObj.outputInternalId]) {
                        recipesByOutput[recipeObj.outputInternalId] = [];
                    }
                    recipesByOutput[recipeObj.outputInternalId].push(recipeObj);
                    loadedCustomCount++;
                });
                console.log(`[SkyShards] Loaded ${loadedCustomCount} custom recipes from custom_recipes.json (${skippedCustomCount} skipped because current native data already covers that output).`);
            }
        }
    } catch (err) {
        console.warn('[WARN] Could not load custom_recipes.json:', err.message);
    }

    console.log(`[SkyShards Engine] Active recipes: ${flattenedRecipes.length}`);
};
bootSkyShards();


// ─── INTEGER-RUN RECURSIVE SOLVER ─────────────────────────────────────────────
//
// Key insight: craft runs are discrete (integer). If a recipe yields Y shards
// and you only need N of them, you still run ceil(N/Y) full runs, producing
// ceil(N/Y)*Y shards total. The extra (surplus) shards can be consumed by
// later steps in the tree instead of buying — this is tracked via a mutable
// `surplus` map passed through the recursion.
//
// Returns: { costToSatisfy, runsNeeded, totalProduced, rawMaterials: {id->qty} }
//          costToSatisfy = actual coins spent (0 if fully covered by surplus)
//          rawMaterials accumulates the leaf-level bazaar purchases needed.

function walkBook(itemId, qty, isInstaBuy, fallbackPrice) {
    if (qty <= 0) return 0;
    const bz = rawBazaarCache[itemId];
    if (!bz) return qty * fallbackPrice;
    
    // DELIBERATE BUG REPLICATION: The bot incorrectly maps Instabuy = buy_summary (Buy Orders) and Instasell = sell_summary (Sell Offers)
    const book = isInstaBuy ? bz.buy_summary : bz.sell_summary;
    if (!book || !Array.isArray(book) || book.length === 0) {
        return qty * fallbackPrice;
    }
    
    let total = 0;
    let remaining = qty;
    
    for (const order of book) {
        if (remaining <= 0) break;
        const take = Math.min(order.amount, remaining);
        total += take * order.pricePerUnit;
        remaining -= take;
    }
    
    if (remaining > 0) {
        total += remaining * fallbackPrice;
    }
    
    return total;
}

function marketCostForQty(itemId, qty, inMode) {
    const bz = rawBazaarCache[itemId];
    if (!bz) return null;

    const isInstaBuy = inMode === 'insta-buy';
    const fallbackPrice = isInstaBuy ? bz.quick_status.buyPrice : bz.quick_status.sellPrice;
    if (!Number.isFinite(fallbackPrice) || fallbackPrice <= 0) return null;

    return isInstaBuy
        ? walkBook(itemId, qty, true, fallbackPrice)
        : fallbackPrice * qty;
}

function mergeRawMaterial(target, source) {
    Object.entries(source).forEach(([id, mat]) => {
        if (!target[id]) {
            target[id] = { id, name: mat.name || id.replace('SHARD_', '').replace(/_/g, ' '), qty: 0, cost: 0 };
        }
        target[id].qty += mat.qty;
        target[id].cost += mat.cost;
    });
}

function bestAcquisitionForQty(itemId, qtyNeeded, inMode, filterManipulated, seen = new Set(), memo = new Map(), depth = 0) {
    if (qtyNeeded <= 0) return { cost: 0, rawMaterials: {}, action: 'BUY' };

    const memoKey = `${itemId}|${Number(qtyNeeded).toFixed(4)}|${inMode}|${filterManipulated}|${depth}`;
    if (memo.has(memoKey)) return memo.get(memoKey);

    const bz = rawBazaarCache[itemId];
    if (!bz) return null;

    const directCost = marketCostForQty(itemId, qtyNeeded, inMode);
    if (directCost === null && (!recipesByOutput[itemId] || seen.has(itemId) || depth >= 5)) return null;

    let best = directCost !== null
        ? {
            cost: directCost,
            rawMaterials: {
                [itemId]: {
                    id: itemId,
                    name: itemId.replace('SHARD_', '').replace(/_/g, ' '),
                    qty: qtyNeeded,
                    cost: directCost,
                }
            },
            action: 'BUY',
            recipeUsed: null,
        }
        : {
            cost: Infinity,
            rawMaterials: {},
            action: 'UNAVAILABLE',
            recipeUsed: null,
        };

    if (depth >= 5 || seen.has(itemId) || !recipesByOutput[itemId]) {
        const result = Number.isFinite(best.cost) ? best : null;
        memo.set(memoKey, result);
        return result;
    }

    const nextSeen = new Set(seen);
    nextSeen.add(itemId);
    const rankedRecipes = recipesByOutput[itemId]
        .map((recipe) => {
            const runsNeeded = Math.ceil(qtyNeeded / recipe.qtyYielded);
            const estimatedCost = recipe.inputs.reduce((sum, inp) => {
                const cost = marketCostForQty(inp.id, inp.qty * runsNeeded, inMode);
                return sum + (cost === null ? Infinity : cost);
            }, (recipe.fee || 0) * runsNeeded);
            return { recipe, runsNeeded, estimatedCost };
        })
        .filter((candidate) => Number.isFinite(candidate.estimatedCost))
        .sort((a, b) => a.estimatedCost - b.estimatedCost);

    for (const candidate of rankedRecipes.slice(0, MAX_RECURSIVE_RECIPE_CANDIDATES)) {
        let craftCost = (candidate.recipe.fee || 0) * candidate.runsNeeded;
        const rawMaterials = {};
        let valid = true;

        for (const inp of candidate.recipe.inputs) {
            const childQty = inp.qty * candidate.runsNeeded;
            const child = bestAcquisitionForQty(inp.id, childQty, inMode, filterManipulated, nextSeen, memo, depth + 1);
            if (!child) {
                valid = false;
                break;
            }
            craftCost += child.cost;
            mergeRawMaterial(rawMaterials, child.rawMaterials);
        }

        if (valid && craftCost < best.cost) {
            best = {
                cost: craftCost,
                rawMaterials,
                action: 'CRAFT',
                recipeUsed: candidate.recipe,
                runsNeeded: candidate.runsNeeded,
            };
            break;
        }
    }

    const result = Number.isFinite(best.cost) ? best : null;
    memo.set(memoKey, result);
    return result;
}

function cheapestCostForQty(itemId, qtyNeeded, inMode, filterManipulated, seen, memo, surplus) {
    // --- Step 1: Draw from surplus first ---
    const haveSurplus = surplus[itemId] || 0;
    if (haveSurplus >= qtyNeeded) {
        surplus[itemId] = haveSurplus - qtyNeeded;
        return { costToSatisfy: 0, runsNeeded: 0, totalProduced: qtyNeeded, rawMaterials: {} };
    }
    // Partial surplus usage
    const stillNeeded = qtyNeeded - haveSurplus;
    surplus[itemId] = 0;  // exhausted

    // --- Step 2: Decide BUY vs CRAFT for the remaining `stillNeeded` units ---
    const bz = rawBazaarCache[itemId];
    if (!bz) return null; // item not on bazaar — can't proceed

    // Anti-manipulation check on inputs
    if (filterManipulated && inMode === 'insta-buy') {
        const spread = bz.quick_status.buyPrice / Math.max(1, bz.quick_status.sellPrice);
        if (spread > MANIPULATED_INPUT_SPREAD_LIMIT) return null;
    }

    const isInstaBuy = (inMode === 'insta-buy');
    const fallbackPrice = isInstaBuy ? bz.quick_status.buyPrice : bz.quick_status.sellPrice;
    const costForQty = isInstaBuy 
        ? walkBook(itemId, stillNeeded, true, fallbackPrice)
        : fallbackPrice * stillNeeded;

    // Buy option: baseline
    let bestOption = {
        costToSatisfy: costForQty,
        runsNeeded: 0,
        totalProduced: stillNeeded,
        rawMaterials: { [itemId]: stillNeeded },
        action: 'BUY',
        recipeUsed: null,
    };

    // Craft option: check all recipes for this item
    if (recipesByOutput[itemId] && !seen.has(itemId)) {
        const localSeen = new Set(seen);
        localSeen.add(itemId);

        for (const recipe of recipesByOutput[itemId]) {
            // How many full craft runs do we need to satisfy `stillNeeded`?
            const runsNeeded = Math.ceil(stillNeeded / recipe.qtyYielded);
            const totalProduced = runsNeeded * recipe.qtyYielded;
            const surplusFromThisCraft = totalProduced - stillNeeded;

            // Clone surplus map so each recipe branch is independent
            const trialSurplus = { ...surplus };

            let craftCost = (recipe.fee || 0) * runsNeeded;
            const craftRawMats = {};
            let valid = true;

            for (const inp of recipe.inputs) {
                const inputQtyNeeded = inp.qty * runsNeeded;
                const childResult = cheapestCostForQty(
                    inp.id, inputQtyNeeded,
                    inMode, filterManipulated,
                    localSeen, memo, trialSurplus
                );
                if (childResult === null) { valid = false; break; }
                craftCost += childResult.costToSatisfy;
                // Accumulate raw materials from children
                Object.entries(childResult.rawMaterials).forEach(([id, qty]) => {
                    craftRawMats[id] = (craftRawMats[id] || 0) + qty;
                });
            }

            if (!valid) continue;

            // Effective cost per unit produced (including any surplus produced)
            const effectiveCostPerUnit = craftCost / totalProduced;

            if (craftCost < bestOption.costToSatisfy) {
                bestOption = {
                    costToSatisfy: craftCost,
                    runsNeeded,
                    totalProduced,
                    surplusProduced: surplusFromThisCraft,
                    rawMaterials: craftRawMats,
                    action: 'CRAFT',
                    recipeUsed: recipe,
                    trialSurplus,  // winning surplus state to commit if chosen
                };
            }
        }
    }

    // Commit the winning surplus state
    if (bestOption.action === 'CRAFT' && bestOption.trialSurplus) {
        Object.assign(surplus, bestOption.trialSurplus);
        // Bank the surplus shards produced by this craft for later reuse
        surplus[itemId] = (surplus[itemId] || 0) + (bestOption.surplusProduced || 0);
    }


    delete bestOption.trialSurplus; // don't leak internal state
    return bestOption;
}

// ─── Legacy wrapper for craft-tree builder compatibility ────────────────────
// Returns a unit-cost record compatible with the old API surface
function findCheapestUnitCost(itemId, inMode, filterManipulated, seen, memo) {
    if (memo.has(itemId)) return memo.get(itemId);
    const bz = rawBazaarCache[itemId];
    if (!bz) {
        const r = { totalCost: Infinity, action: 'INVALID', rawMaterials: {}, recipeUsed: null };
        memo.set(itemId, r); return r;
    }
    const buyPricePerUnit = (inMode === 'buy-order') ? bz.quick_status.sellPrice : bz.quick_status.buyPrice;

    // Use the integer solver for 1 unit, fresh surplus pool
    const result = cheapestCostForQty(itemId, 1, inMode, filterManipulated, seen, memo, {});
    if (!result) {
        const r = { totalCost: buyPricePerUnit, action: 'BUY', rawMaterials: { [itemId]: { id: itemId, qty: 1, cost: buyPricePerUnit } }, recipeUsed: null };
        memo.set(itemId, r); return r;
    }
    const r = {
        totalCost: result.costToSatisfy,
        action: result.action,
        rawMaterials: Object.fromEntries(
            Object.entries(result.rawMaterials).map(([id, qty]) => {
                const ibz = rawBazaarCache[id];
                const p = ibz ? ((inMode === 'buy-order') ? ibz.quick_status.sellPrice : ibz.quick_status.buyPrice) : 0;
                return [id, { id, qty, cost: p * qty }];
            })
        ),
        recipeUsed: result.recipeUsed || null,
    };
    memo.set(itemId, r);
    return r;
}

app.get('/api/best-fusions', async (req, res) => {
  try {
    await refreshRawBazaarCache();
    
    if (!rawBazaarCache || Object.keys(rawBazaarCache).length === 0) return res.json([]);
    
    const crocBuff = parseInt(req.query.croc || 0, 10);
    const seaBuff = parseInt(req.query.sea || 0, 10);
    const tiaBuff = parseInt(req.query.tia || 0, 10);
    const salesTier = req.query.salesTier || 'all'; // all, low, medium, high
    const tradeMode = req.query.tradeMode || 'insta-buy_insta-sell'; // e.g. 'buy-order_insta-sell'
    const sortMode = req.query.sortMode || 'total'; // 'total', 'absolute', or 'volume'
    const uncapped = req.query.uncapped === 'true';
    const filterManipulated = req.query.filterManipulated === 'true';
    const cacheKey = JSON.stringify({ crocBuff, seaBuff, tiaBuff, salesTier, tradeMode, sortMode, uncapped, filterManipulated });
    const cached = bestFusionsCache.get(cacheKey);
    if (cached && Date.now() - cached.time < FUSION_CACHE_MS) {
        return res.json(cached.results);
    }
    
    // Parse the compound trade mode. Defaulting to insta-buy inputs for backwards compatibility if no '_'
    const [inMode, outMode] = tradeMode.includes('_') ? tradeMode.split('_') : ['insta-buy', tradeMode];

    let results = [];
    
    // Calculate best recipe for each Output ID.
    // Inputs are priced using their best acquisition path: buy directly or craft
    // from their currently cheapest profitable sub-recipe.
    const bestByOutput = new Map();

    const acquisitionMemo = new Map();
    // Cache shard internal_id -> name lookup
    const shardNameCache = {};
    const shardFamilyCache = {};
    for (const k in skyshardsData.shards) {
        const s = skyshardsData.shards[k];
        if (s.internal_id) {
            shardNameCache[s.internal_id] = s.name;
            shardFamilyCache[s.internal_id] = s.family || 'NONE';
        }
    }

    flattenedRecipes.forEach(rec => {
        const outBz = rawBazaarCache[rec.outputInternalId];
        if (!outBz) return;
        
        const outputSpreadRatio = outBz.quick_status.sellPrice > 0
             ? outBz.quick_status.buyPrice / outBz.quick_status.sellPrice
             : Infinity;

        // Anti-manipulation ON: reject outputs whose sell-order price is far above instant-sell.
        // Anti-manipulation OFF: keep the Discord bot behavior and price sell-order flips at buyPrice.
        if (filterManipulated && outMode !== 'insta-sell' && outputSpreadRatio > MANIPULATED_OUTPUT_SPREAD_LIMIT) {
            return;
        }

        if (filterManipulated && outMode === 'insta-sell') {
            const outSpread = outBz.quick_status.buyPrice / Math.max(1, outBz.quick_status.sellPrice);
            if (outSpread > MANIPULATED_INPUT_SPREAD_LIMIT) return;
        }

        let totalInputCost = 0;
        const baseMaterialMap = {};
        let allValid = true;

        const aggregatedInputs = {};
        for (const inp of rec.inputs) {
            if (!inp.id) continue;
            aggregatedInputs[inp.id] = (aggregatedInputs[inp.id] || 0) + (Number(inp.qty) || 0);
        }

        for (const [inputId, totalQty] of Object.entries(aggregatedInputs)) {
            if (!allValid) break;
            const inBz = rawBazaarCache[inputId];
            if (!inBz) { allValid = false; break; }

            const acquisition = bestAcquisitionForQty(
                inputId,
                totalQty,
                inMode,
                filterManipulated,
                new Set([rec.outputInternalId]),
                acquisitionMemo
            );
            if (!acquisition) { allValid = false; break; }

            totalInputCost += acquisition.cost;
            mergeRawMaterial(baseMaterialMap, acquisition.rawMaterials);
        }

        if (!allValid) return;
        const baseMaterials = Object.values(baseMaterialMap).map(mat => ({
            name: shardNameCache[mat.id] || mat.name || mat.id,
            id: mat.id,
            qty: +(mat.qty.toFixed(2)),
            actualQtyObtained: +(mat.qty.toFixed(2)),
            cost: +(mat.cost.toFixed(0)),
            action: 'BUY',
        }));


        
        // Use total volume (buy + sell) for the liquidity banding/traffic-light tier filter ONLY
        const totalSalesPerHour = (outBz.quick_status.sellMovingWeek + outBz.quick_status.buyMovingWeek) / 168.0;
        
        // Exact Liquidity Banding (Hourly!)
        if (salesTier === 'low' && totalSalesPerHour >= 20) return;
        if (salesTier === 'medium' && (totalSalesPerHour < 20 || totalSalesPerHour >= 50)) return;
        if (salesTier === 'high' && totalSalesPerHour < 50) return;

        let yieldMult = 1.0;
        
        const sysFamily = shardFamilyCache[rec.outputInternalId] || 'NONE';

        if (sysFamily.toUpperCase() === 'REPTILE') {
            yieldMult += (+crocBuff * 0.02);
            yieldMult += (+seaBuff * 0.02);
            yieldMult += (+tiaBuff * 0.02);
        }
        
        const effectiveYieldPerCraft = rec.qtyYielded * yieldMult;
        
        const grossOutputPricePerShard = outMode === 'insta-sell' 
             ? outBz.quick_status.sellPrice   // Instantly dump to Highest Buy Order
             : outBz.quick_status.buyPrice;   // List a Sell Offer at the lowest listing price
        const inputCostPerCraft = totalInputCost + rec.fee;

        // Volume = 2-day safe sell window (matches the reference bot: floor(buyMovingWeek / 48))
        const buyOrdersPerHour = outBz.quick_status.buyMovingWeek / 168.0;
        const safeShardsSellable = Math.floor(outBz.quick_status.buyMovingWeek / 48);
        const maxTargetShards = uncapped
            ? Math.max(1, safeShardsSellable)
            : Math.max(1, Math.min(200, safeShardsSellable));

        // How many craft runs to hit that shard volume?
        const maxCraftRuns = Math.floor(maxTargetShards / effectiveYieldPerCraft);
        if (maxCraftRuns < 1) return;

        // Discord Bot metrics format
        const grossRevenuePerCraft = grossOutputPricePerShard * effectiveYieldPerCraft;
        const grossProfitPerCraft = grossRevenuePerCraft - inputCostPerCraft;
        const netProfitPerCraft   = grossProfitPerCraft * (1 - BOT_PROFIT_HAIRCUT_RATE);

        // Bot displays gross profit per shard, then applies a 5% haircut to total profit.
        const grossProfitPerShard = grossProfitPerCraft / effectiveYieldPerCraft;
        const netProfitPerShard   = grossProfitPerShard * (1 - BOT_PROFIT_HAIRCUT_RATE);

        const absoluteProfit = netProfitPerCraft;
        if (grossProfitPerCraft <= 0) return;

        const roiPerCraft = netProfitPerCraft / inputCostPerCraft;
        if (sortMode === 'absolute' && roiPerCraft < 0.03) return;

        // Total Net Profit = Net Profit Per Shard * maxTargetShards (which the bot caps at 200)
        const totalProfitBatch = netProfitPerShard * maxTargetShards;

        if (totalProfitBatch < 10000) return;

        // Represent sales/hr using buy-orders only (demand side), which the bot also uses for volume
        const salesPerHour = buyOrdersPerHour;

        const candidate = {
            id: rec.outputInternalId,
            name: rec.outputName,
            inputs: baseMaterials,             // Raw materials per craft run (fixed, no double-multiply)
            recipeInputs: rec.inputs.map((inp) => ({
                id: inp.id,
                name: inp.name || shardNameCache[inp.id] || inp.id,
                qty: inp.qty,
            })),
            recipeKey: recipeSignature(rec),
            isTargetCrafted: false,
            yieldsPerCraft: rec.qtyYielded,
            maxVolume: maxTargetShards,
            maxTargetShards: maxTargetShards,
            totalProfit: totalProfitBatch,
            absoluteProfit,
            grossProfitPerShard: +(grossProfitPerShard.toFixed(0)),
            netProfitPerShard: +(netProfitPerShard.toFixed(0)),
            grossProfitPerCraft: +grossProfitPerCraft.toFixed(0),   // Matches bot's displayed left-hand number
            netProfitPerCraft:   +netProfitPerCraft.toFixed(0),     // What's used for totalProfit calc
            inputCost: +(inputCostPerCraft.toFixed(0)),
            roi: (totalProfitBatch / (inputCostPerCraft * maxCraftRuns)) * 100,
            roiPerCraft: +(roiPerCraft * 100).toFixed(1),
            salesPerHour,
            tradeMode,
            marketBuy: outBz.quick_status.buyPrice,
            marketSell: outBz.quick_status.sellPrice,
            outputSpreadRatio,
            sellOrderPremium: outputSpreadRatio,
            manipulationWarning: outMode !== 'insta-sell' && outputSpreadRatio > MANIPULATED_OUTPUT_SPREAD_LIMIT,
            volumeDebug: {
                buyMovingWeek: outBz.quick_status.buyMovingWeek,
                sellMovingWeek: outBz.quick_status.sellMovingWeek,
                buyDiv48: Math.floor(outBz.quick_status.buyMovingWeek / 48),
                sellDiv48: Math.floor(outBz.quick_status.sellMovingWeek / 48),
                totalDiv48: Math.floor((outBz.quick_status.buyMovingWeek + outBz.quick_status.sellMovingWeek) / 48),
            }
        };

        const existing = bestByOutput.get(rec.outputInternalId);
        const recipeMetric = sortMode === 'absolute' ? 'absoluteProfit' : 'totalProfit';
        if (!existing || candidate[recipeMetric] > existing[recipeMetric]) {
            bestByOutput.set(rec.outputInternalId, candidate);
        }
    });

    results = Array.from(bestByOutput.values())
        .sort((a, b) => {
            if (sortMode === 'volume') {
                return (b.maxVolume - a.maxVolume) || (b.salesPerHour - a.salesPerHour) || (b.totalProfit - a.totalProfit);
            }
            return sortMode === 'absolute' ? b.absoluteProfit - a.absoluteProfit : b.totalProfit - a.totalProfit;
        });

    bestFusionsCache.set(cacheKey, { time: Date.now(), results });
    if (bestFusionsCache.size > 30) bestFusionsCache.delete(bestFusionsCache.keys().next().value);

    console.log(`Finished /best-fusions API: Checked ${flattenedRecipes.length} recipes. Survived the Math Filter: ${bestByOutput.size}. Trade Mode: ${tradeMode}, Sort: ${sortMode}, Tier: ${salesTier}`);
    res.json(results);
  } catch(e) {
    console.error("Crash in best-fusions:", e);
    res.status(500).json({error: e.message, stack: e.stack});
  }
});

// --- BATCH OPTIMIZER ---
// Greedy ROI-ranked capital allocator.
// Given a coin budget, allocates craft runs across the best fusion opportunities
// to maximise total profit, then returns a consolidated shopping list.
app.get('/api/batch-optimize', async (req, res) => {
    // Ensure bazaar cache is fresh
    await refreshRawBazaarCache();
    if (!rawBazaarCache || Object.keys(rawBazaarCache).length === 0) {
        return res.json({ error: 'Bazaar data unavailable', allocation: [], summary: {}, shoppingList: [] });
    }

    const budget         = parseFloat(req.query.budget || 0);
    const crocBuff       = parseInt(req.query.croc || 0, 10);
    const seaBuff        = parseInt(req.query.sea || 0, 10);
    const tiaBuff        = parseInt(req.query.tia || 0, 10);
    const salesTier      = req.query.salesTier || 'all';
    const tradeMode      = req.query.tradeMode || 'buy-order_insta-sell';
    const uncapped       = req.query.uncapped === 'true';
    const filterManipulated = req.query.filterManipulated === 'true';
    const cacheKey = JSON.stringify({ budget, crocBuff, seaBuff, tiaBuff, salesTier, tradeMode, uncapped, filterManipulated });
    const cached = batchOptimizeCache.get(cacheKey);
    if (cached && Date.now() - cached.time < FUSION_CACHE_MS) {
        return res.json(cached.payload);
    }

    if (budget <= 0) return res.status(400).json({ error: 'budget must be > 0', allocation: [], summary: {}, shoppingList: [] });

    const [inMode, outMode] = tradeMode.includes('_') ? tradeMode.split('_') : ['insta-buy', tradeMode];
    const acquisitionMemo = new Map();

    // Step 1: Collect all profitable candidates (same logic as /api/best-fusions, no top-50 cap)
    const bestByOutput = new Map();

    // Pre-compute caches for batch optimizer
    const batchShardFamilyCache = {};
    for (const k in skyshardsData.shards) {
        const s = skyshardsData.shards[k];
        if (s.internal_id) batchShardFamilyCache[s.internal_id] = s.family || 'NONE';
    }

    flattenedRecipes.forEach(rec => {
        const outBz = rawBazaarCache[rec.outputInternalId];
        if (!outBz) return;

        const outputSpreadRatio = outBz.quick_status.sellPrice > 0
            ? outBz.quick_status.buyPrice / outBz.quick_status.sellPrice
            : Infinity;

        if (filterManipulated && outMode !== 'insta-sell' && outputSpreadRatio > MANIPULATED_OUTPUT_SPREAD_LIMIT) {
            return;
        }

        if (filterManipulated && outMode === 'insta-sell') {
            const outSpread = outBz.quick_status.buyPrice / Math.max(1, outBz.quick_status.sellPrice);
            if (outSpread > MANIPULATED_INPUT_SPREAD_LIMIT) return;
        }

        let allValid = true;
        let totalInputCost = 0;
        const allRawMats = {};
        const aggregatedInputs = {};

        rec.inputs.forEach(inp => {
            if (!inp.id) return;
            aggregatedInputs[inp.id] = (aggregatedInputs[inp.id] || 0) + (Number(inp.qty) || 0);
        });

        Object.entries(aggregatedInputs).forEach(([inputId, totalQty]) => {
            if (!allValid) return;
            const inBz = rawBazaarCache[inputId];
            if (!inBz) {
                allValid = false;
                return;
            }

            const acquisition = bestAcquisitionForQty(
                inputId,
                totalQty,
                inMode,
                filterManipulated,
                new Set([rec.outputInternalId]),
                acquisitionMemo
            );
            if (!acquisition) {
                allValid = false;
                return;
            }

            totalInputCost += acquisition.cost;
            mergeRawMaterial(allRawMats, acquisition.rawMaterials);
        });
        if (!allValid) return;

        const totalSalesPerHourBatch = (outBz.quick_status.sellMovingWeek + outBz.quick_status.buyMovingWeek) / 168.0;
        if (salesTier === 'low'    && totalSalesPerHourBatch >= 20) return;
        if (salesTier === 'medium' && (totalSalesPerHourBatch < 20 || totalSalesPerHourBatch >= 50)) return;
        if (salesTier === 'high'   && totalSalesPerHourBatch < 50) return;

        let yieldMult = 1.0;
        
        const sysFamily = batchShardFamilyCache[rec.outputInternalId] || 'NONE';

        if (sysFamily.toUpperCase() === 'REPTILE') {
            yieldMult += (+crocBuff * 0.02);
            yieldMult += (+seaBuff * 0.02);
            yieldMult += (+tiaBuff * 0.02);
        }

        const effectiveYieldPerCraft = rec.qtyYielded * yieldMult;
        const isInstaSell = (outMode === 'insta-sell');
        const fallbackOutPrice = isInstaSell ? outBz.quick_status.sellPrice : outBz.quick_status.buyPrice;
        // Check base gross output value for 1 craft (to calculate base ROI for sorting)
        const grossOutputPricePerCraft = isInstaSell 
            ? walkBook(rec.outputInternalId, effectiveYieldPerCraft, false, fallbackOutPrice)
            : fallbackOutPrice * effectiveYieldPerCraft;
        const inputCostPerCraft = totalInputCost + rec.fee;

        // Volume = 2-day safe sell window (matches reference bot: floor(buyMovingWeek / 48))
        const safeShardsSellable = Math.floor(outBz.quick_status.buyMovingWeek / 48);
        const maxVolume = uncapped ? Math.max(1, safeShardsSellable) : Math.max(1, Math.min(200, safeShardsSellable));

        const grossProfitPerCraftRun = grossOutputPricePerCraft - inputCostPerCraft;
        const profitPerCraftRun = grossProfitPerCraftRun * (1 - BOT_PROFIT_HAIRCUT_RATE);
        const costPerCraftRun = inputCostPerCraft;
        const roiPerCraft = profitPerCraftRun / costPerCraftRun;

        if (profitPerCraftRun <= 0 || roiPerCraft < 0.03) return;

        const salesPerHour = outBz.quick_status.buyMovingWeek / 168.0;

        const rawMaterials = Object.values(allRawMats).map(mat => ({
            id: mat.id,
            name: mat.id.replace('SHARD_', '').replace(/_/g, ' '),
            qty: +(mat.qty.toFixed(2)),
            cost: +(mat.cost.toFixed(0))
        }));

        const candidate = {
            id: rec.outputInternalId,
            name: rec.outputName,
            yieldsPerCraft: rec.qtyYielded,
            maxVolume,
            costPerCraftRun: +(costPerCraftRun.toFixed(0)),
            profitPerCraftRun: +(profitPerCraftRun.toFixed(0)),
            roiPerCraft: +(roiPerCraft * 100).toFixed(1),
            salesPerHour,
            fee: rec.fee || 0,
            rawMaterials,
            outputSpreadRatio,
            sellOrderPremium: outputSpreadRatio,
            manipulationWarning: !isInstaSell && outputSpreadRatio > MANIPULATED_OUTPUT_SPREAD_LIMIT,
        };

        const existing = bestByOutput.get(rec.outputInternalId);
        if (!existing || candidate.roiPerCraft > existing.roiPerCraft) {
            bestByOutput.set(rec.outputInternalId, candidate);
        }
    });

    // Step 2: Sort by ROI descending (greedy ranking)
    const candidates = Array.from(bestByOutput.values())
        .sort((a, b) => b.roiPerCraft - a.roiPerCraft);

    // Step 3: Greedily allocate budget
    let remainingBudget = budget;
    const allocation = [];
    const consolidatedMats = {};  // id -> { name, totalQty, totalCost }

    for (const c of candidates) {
        if (remainingBudget <= 0) break;
        if (c.costPerCraftRun <= 0) continue;

        // How many runs can we afford, capped by maxVolume
        const affordableRuns = Math.floor(remainingBudget / c.costPerCraftRun);
        let runs = Math.min(affordableRuns, c.maxVolume);
        if (runs <= 0) continue;

        // Recalculate true bulk costs dynamically from the precise order book depth!
        // If order book slippage makes it too expensive, we decrement runs until it fits budget.
        const isInstaBuy = inMode === 'insta-buy';
        const isInstaSell = outMode === 'insta-sell';
        let trueInvestment = 0;
        let finalRawMats = [];
        
        while (runs > 0) {
            trueInvestment = c.fee * runs;
            finalRawMats = [];
            for (const mat of c.rawMaterials) {
                const totalQty = mat.qty * runs;
                const bz = rawBazaarCache[mat.id];
                const fallback = isInstaBuy ? bz.quick_status.buyPrice : bz.quick_status.sellPrice;
                const exactCost = isInstaBuy ? walkBook(mat.id, totalQty, true, fallback) : fallback * totalQty;
                trueInvestment += exactCost;
                finalRawMats.push({ ...mat, totalQty, totalCost: exactCost });
            }
            if (trueInvestment <= remainingBudget) break;
            runs--;
        }

        if (runs <= 0) continue;

        const totalYield = Math.floor(runs * c.yieldsPerCraft);
        const bzOut = rawBazaarCache[c.id];
        const fallbackOut = isInstaSell ? bzOut.quick_status.sellPrice : bzOut.quick_status.buyPrice;
        const trueGrossRevenue = isInstaSell ? walkBook(c.id, totalYield, false, fallbackOut) : fallbackOut * totalYield;
        const profit = (trueGrossRevenue - trueInvestment) * (1 - BOT_PROFIT_HAIRCUT_RATE);
        remainingBudget -= trueInvestment;

        // Note: true roi logic on bulk orders could drop. We rely on the initial 1-craft ROI for screening.
        const trueROI = (profit / trueInvestment) * 100;

        allocation.push({
            id: c.id,
            name: c.name,
            crafts: runs,
            yieldsPerCraft: c.yieldsPerCraft,
            totalYield: totalYield,
            investment: +trueInvestment.toFixed(0),
            profit: +profit.toFixed(0),
            roiPerCraft: +trueROI.toFixed(1),
            salesPerHour: +c.salesPerHour.toFixed(1),
            rawMaterials: finalRawMats.map(m => ({
                ...m,
                totalQty:  +m.totalQty.toFixed(2),
                totalCost: +m.totalCost.toFixed(0),
            }))
        });

        // Merge into consolidated shopping list
        finalRawMats.forEach(mat => {
            if (!consolidatedMats[mat.id]) {
                consolidatedMats[mat.id] = { id: mat.id, name: mat.name, totalQty: mat.totalQty, totalCost: mat.totalCost };
            } else {
                consolidatedMats[mat.id].totalQty  += mat.totalQty;
                consolidatedMats[mat.id].totalCost += mat.totalCost;
            }
        });
    }

    const totalInvestment = allocation.reduce((s, a) => s + a.investment, 0);
    const totalProfit     = allocation.reduce((s, a) => s + a.profit, 0);

    const shoppingList = Object.values(consolidatedMats)
        .map(m => ({ ...m, totalQty: +m.totalQty.toFixed(2), totalCost: +m.totalCost.toFixed(0) }))
        .sort((a, b) => b.totalCost - a.totalCost);

    console.log(`[batch-optimize] budget=${budget.toLocaleString()}, candidates=${candidates.length}, allocated=${allocation.length} fusions, investment=${totalInvestment.toLocaleString()}, profit=${totalProfit.toLocaleString()}`);

    const payload = {
        allocation,
        summary: {
            totalInvestment: +totalInvestment.toFixed(0),
            totalProfit: +totalProfit.toFixed(0),
            remainingBudget: +remainingBudget.toFixed(0),
            effectiveROI: totalInvestment > 0 ? +((totalProfit / totalInvestment) * 100).toFixed(1) : 0,
            fusionCount: allocation.length,
        },
        shoppingList,
    };

    batchOptimizeCache.set(cacheKey, { time: Date.now(), payload });
    if (batchOptimizeCache.size > 15) batchOptimizeCache.delete(batchOptimizeCache.keys().next().value);

    res.json(payload);
});

// ─── VISUAL CRAFT TREE BUILDER ────────────────────────────────────────────────
// Builds a human-readable crafting tree for a given item+qty using integer runs.
// `surplus` is passed through so earlier nodes can consume over-production from
// later siblings (same rule as the solver).
function buildCraftTree(itemId, qtyNeeded, inMode, filterManipulated, surplus, seen) {
    if (!seen) seen = new Set();
    const bz = rawBazaarCache[itemId];
    if (!bz) return null;

    const buyPrice    = (inMode === 'buy-order') ? bz.quick_status.sellPrice : bz.quick_status.buyPrice;
    const prettyName  = itemId.replace('SHARD_', '').replace(/_/g, ' ');

    // Draw from surplus first
    const haveSurplus = surplus[itemId] || 0;
    if (haveSurplus >= qtyNeeded) {
        surplus[itemId] -= qtyNeeded;
        return {
            id: itemId, name: prettyName, qty: qtyNeeded, qtyNeeded,
            action: 'FROM_SURPLUS', unitPrice: 0, totalCost: 0,
            surplusUsed: qtyNeeded, children: []
        };
    }
    const stillNeeded = qtyNeeded - haveSurplus;
    surplus[itemId]   = 0;

    // Determine whether crafting is cheaper than buying
    const buyTotalCost = buyPrice * stillNeeded;
    let bestNode = {
        id: itemId, name: prettyName, qty: qtyNeeded, qtyNeeded,
        action: 'BUY', unitPrice: buyPrice, totalCost: buyTotalCost,
        surplusUsed: haveSurplus, children: []
    };

    if (recipesByOutput[itemId] && !seen.has(itemId)) {
        const localSeen = new Set(seen);
        localSeen.add(itemId);

        for (const recipe of recipesByOutput[itemId]) {
            const runsNeeded  = Math.ceil(stillNeeded / recipe.qtyYielded);
            const totalProduced = runsNeeded * recipe.qtyYielded;
            const surplusProduced = totalProduced - stillNeeded;

            // Trial surplus for this recipe branch
            const trialSurplus = { ...surplus };
            let craftCost  = (recipe.fee || 0) * runsNeeded;
            const children = [];
            let valid = true;

            for (const inp of recipe.inputs) {
                const childQty  = inp.qty * runsNeeded;
                const childNode = buildCraftTree(inp.id, childQty, inMode, filterManipulated, trialSurplus, localSeen);
                if (!childNode) { valid = false; break; }
                craftCost += childNode.totalCost;
                children.push(childNode);
            }
            if (!valid) continue;

            if (craftCost < bestNode.totalCost) {
                bestNode = {
                    id: itemId, name: prettyName,
                    qty: totalProduced, qtyNeeded,
                    surplusProduced,
                    surplusUsed: haveSurplus,
                    action: 'CRAFT',
                    runsNeeded,
                    recipe: { outputName: recipe.outputName, qtyYielded: recipe.qtyYielded },
                    unitPrice: craftCost / totalProduced,
                    totalCost: craftCost,
                    children,
                };
                // Commit winning surplus state
                Object.assign(surplus, trialSurplus);
                surplus[itemId] = (surplus[itemId] || 0) + surplusProduced;
            }
        }
    }

    return bestNode;
}

app.get('/api/craft-tree/:itemId', async (req, res) => {
    await refreshRawBazaarCache();
    
    const itemId = req.params.itemId;
    const inMode = req.query.inMode || 'buy-order';
    const targetQty = parseInt(req.query.qty, 10) || 1;
    const maxDepth = Math.min(8, Math.max(1, parseInt(req.query.depth, 10) || 5));
    const maxNodes = 1500;
    const alternativeLimit = Math.min(8, Math.max(1, parseInt(req.query.alternatives, 10) || 5));
    const requestedRecipeKey = req.query.recipeKey || null;
    let nodeCount = 0;

    const getUnitPrice = (id) => {
        const bz = rawBazaarCache[id];
        if (!bz) return null;
        const price = (inMode === 'buy-order') ? bz.quick_status.sellPrice : bz.quick_status.buyPrice;
        return Number.isFinite(price) && price > 0 ? price : null;
    };

    const directMarketCost = (id, qty) => {
        return marketCostForQty(id, qty, inMode);
    };

    const estimateRecipeDirectCost = (recipe, runsNeeded) => {
        return recipe.inputs.reduce((sum, inp) => {
            const cost = directMarketCost(inp.id, inp.qty * runsNeeded);
            if (cost === null) return Infinity;
            return sum + cost;
        }, (recipe.fee || 0) * runsNeeded);
    };

    const recipeInputsForDisplay = (recipe, runsNeeded = 1) => {
        return (recipe.inputs || []).map((inp) => ({
            id: inp.id,
            name: inp.name || inp.id.replace('SHARD_', '').replace(/_/g, ' '),
            qty: inp.qty * runsNeeded,
        }));
    };

    const buildBoundedRecipeTree = (id, qtyNeeded, depth, seen = new Set(), forcedRecipe = null) => {
        nodeCount++;
        const prettyName = id.replace('SHARD_', '').replace(/_/g, ' ');
        const directUnitPrice = getUnitPrice(id);
        const hasDirectMarket = directUnitPrice !== null;
        const marketCost = directMarketCost(id, qtyNeeded);
        const directCost = marketCost === null ? Infinity : marketCost;
        const recipes = recipesByOutput[id] || [];

        if (!forcedRecipe && (depth >= maxDepth || nodeCount >= maxNodes || seen.has(id) || recipes.length === 0)) {
            return {
                id,
                name: prettyName,
                qty: qtyNeeded,
                qtyNeeded,
                action: hasDirectMarket ? 'BUY' : 'UNAVAILABLE',
                unitPrice: directUnitPrice || 0,
                totalCost: directCost,
                children: [],
                capped: depth >= maxDepth || nodeCount >= maxNodes,
                cycle: seen.has(id),
                stopReason: !hasDirectMarket ? 'not-on-bazaar' : (seen.has(id) ? 'cycle' : (depth >= maxDepth ? 'max-depth' : (nodeCount >= maxNodes ? 'node-limit' : 'no-recipe'))),
            };
        }

        const nextSeen = new Set(seen);
        nextSeen.add(id);
        const candidateRecipes = forcedRecipe ? [forcedRecipe] : recipes;
        const rankedRecipes = candidateRecipes
            .map((recipe) => {
                const runsNeeded = Math.ceil(qtyNeeded / recipe.qtyYielded);
                return {
                    recipe,
                    runsNeeded,
                    producedQty: runsNeeded * recipe.qtyYielded,
                    estimatedCost: estimateRecipeDirectCost(recipe, runsNeeded),
                };
            })
            .sort((a, b) => {
                const aCost = Number.isFinite(a.estimatedCost) ? a.estimatedCost : Number.MAX_SAFE_INTEGER;
                const bCost = Number.isFinite(b.estimatedCost) ? b.estimatedCost : Number.MAX_SAFE_INTEGER;
                return aCost - bCost;
            });

        let bestCraft = null;

        for (const candidateRecipe of rankedRecipes.slice(0, MAX_RECURSIVE_RECIPE_CANDIDATES)) {
            const children = candidateRecipe.recipe.inputs.map((inp) => {
                const childQty = inp.qty * candidateRecipe.runsNeeded;
                const child = buildBoundedRecipeTree(inp.id, childQty, depth + 1, nextSeen);
                child.name = inp.name || child.name;
                return child;
            });
            if (children.some((child) => child.action === 'UNAVAILABLE' || !Number.isFinite(child.totalCost))) {
                continue;
            }

            const craftCost = children.reduce((sum, child) => sum + child.totalCost, (candidateRecipe.recipe.fee || 0) * candidateRecipe.runsNeeded);
            if (!bestCraft || craftCost < bestCraft.totalCost) {
                bestCraft = {
                    recipe: candidateRecipe.recipe,
                    runsNeeded: candidateRecipe.runsNeeded,
                    producedQty: candidateRecipe.producedQty,
                    totalCost: craftCost,
                    children,
                    estimatedCost: candidateRecipe.estimatedCost,
                };
            }
        }

        if (!bestCraft || (!forcedRecipe && hasDirectMarket && bestCraft.totalCost >= directCost)) {
            return {
                id,
                name: prettyName,
                qty: qtyNeeded,
                qtyNeeded,
                action: hasDirectMarket ? 'BUY' : 'UNAVAILABLE',
                unitPrice: directUnitPrice || 0,
                totalCost: directCost,
                children: [],
                directBuyCost: directCost,
                bestCraftCost: bestCraft ? bestCraft.totalCost : null,
                alternativesChecked: rankedRecipes.length,
                stopReason: !hasDirectMarket ? 'not-on-bazaar' : (bestCraft ? 'direct-buy-cheaper' : 'no-valid-craft'),
            };
        }

        return {
            id,
            name: bestCraft.recipe.outputName || prettyName,
            qty: bestCraft.producedQty,
            qtyNeeded,
            action: 'CRAFT',
            runsNeeded: bestCraft.runsNeeded,
            recipe: { outputName: bestCraft.recipe.outputName, qtyYielded: bestCraft.recipe.qtyYielded },
            recipeKey: recipeSignature(bestCraft.recipe),
            recipeInputs: recipeInputsForDisplay(bestCraft.recipe, bestCraft.runsNeeded),
            unitPrice: bestCraft.producedQty > 0 ? bestCraft.totalCost / bestCraft.producedQty : 0,
            totalCost: bestCraft.totalCost,
            directBuyCost: directCost,
            children: bestCraft.children,
            alternativesChecked: rankedRecipes.length,
            selectedEstimatedCost: bestCraft.estimatedCost,
            savedVsDirect: directCost - bestCraft.totalCost,
        };
    };

    const buildFullRecipeTree = (id, qtyNeeded, depth, seen = new Set(), forcedRecipe = null) => {
        nodeCount++;
        const prettyName = id.replace('SHARD_', '').replace(/_/g, ' ');
        const directUnitPrice = getUnitPrice(id);
        const marketCost = directMarketCost(id, qtyNeeded);
        const directCost = marketCost === null ? Infinity : marketCost;
        const recipes = recipesByOutput[id] || [];

        if (depth >= maxDepth || nodeCount >= maxNodes || seen.has(id) || recipes.length === 0) {
            return {
                id,
                name: prettyName,
                qty: qtyNeeded,
                qtyNeeded,
                action: directUnitPrice === null ? 'UNAVAILABLE' : 'BUY',
                unitPrice: directUnitPrice || 0,
                totalCost: directCost,
                directBuyCost: directCost,
                children: [],
                capped: depth >= maxDepth || nodeCount >= maxNodes,
                cycle: seen.has(id),
                stopReason: !recipes.length ? 'base-material' : (seen.has(id) ? 'cycle' : 'limit'),
            };
        }

        const nextSeen = new Set(seen);
        nextSeen.add(id);
        const candidateRecipes = forcedRecipe ? [forcedRecipe] : recipes;
        const rankedRecipes = candidateRecipes
            .map((recipe) => {
                const runsNeeded = Math.ceil(qtyNeeded / recipe.qtyYielded);
                return {
                    recipe,
                    runsNeeded,
                    producedQty: runsNeeded * recipe.qtyYielded,
                    estimatedCost: estimateRecipeDirectCost(recipe, runsNeeded),
                };
            })
            .sort((a, b) => {
                const aCost = Number.isFinite(a.estimatedCost) ? a.estimatedCost : Number.MAX_SAFE_INTEGER;
                const bCost = Number.isFinite(b.estimatedCost) ? b.estimatedCost : Number.MAX_SAFE_INTEGER;
                return aCost - bCost;
            });

        let bestCraft = null;

        for (const candidateRecipe of rankedRecipes.slice(0, MAX_RECURSIVE_RECIPE_CANDIDATES)) {
            const children = candidateRecipe.recipe.inputs.map((inp) => {
                const childQty = inp.qty * candidateRecipe.runsNeeded;
                const child = buildFullRecipeTree(inp.id, childQty, depth + 1, nextSeen);
                child.name = inp.name || child.name;
                return child;
            });
            if (children.some((child) => child.action === 'UNAVAILABLE' || !Number.isFinite(child.totalCost))) {
                continue;
            }

            const craftCost = children.reduce((sum, child) => sum + child.totalCost, (candidateRecipe.recipe.fee || 0) * candidateRecipe.runsNeeded);
            if (!bestCraft || craftCost < bestCraft.totalCost) {
                bestCraft = {
                    recipe: candidateRecipe.recipe,
                    runsNeeded: candidateRecipe.runsNeeded,
                    producedQty: candidateRecipe.producedQty,
                    totalCost: craftCost,
                    children,
                    estimatedCost: candidateRecipe.estimatedCost,
                };
            }
        }

        if (!bestCraft) {
            return {
                id,
                name: prettyName,
                qty: qtyNeeded,
                qtyNeeded,
                action: directUnitPrice === null ? 'UNAVAILABLE' : 'BUY',
                unitPrice: directUnitPrice || 0,
                totalCost: directCost,
                directBuyCost: directCost,
                children: [],
                stopReason: directUnitPrice === null ? 'not-on-bazaar' : 'no-valid-craft',
            };
        }

        return {
            id,
            name: bestCraft.recipe.outputName || prettyName,
            qty: bestCraft.producedQty,
            qtyNeeded,
            action: 'CRAFT',
            acquisitionHint: Number.isFinite(directCost) && directCost < bestCraft.totalCost ? 'DIRECT_BUY_CHEAPER' : 'CRAFT_CHEAPER',
            runsNeeded: bestCraft.runsNeeded,
            recipe: { outputName: bestCraft.recipe.outputName, qtyYielded: bestCraft.recipe.qtyYielded },
            recipeKey: recipeSignature(bestCraft.recipe),
            recipeInputs: recipeInputsForDisplay(bestCraft.recipe, bestCraft.runsNeeded),
            unitPrice: bestCraft.producedQty > 0 ? bestCraft.totalCost / bestCraft.producedQty : 0,
            totalCost: bestCraft.totalCost,
            directBuyCost: directCost,
            children: bestCraft.children,
            alternativesChecked: rankedRecipes.length,
            selectedEstimatedCost: bestCraft.estimatedCost,
            savedVsDirect: directCost - bestCraft.totalCost,
        };
    };

    const bz = rawBazaarCache[itemId];
    if (!bz) return res.status(404).json({ error: 'Item not found on Bazaar' });

    const directUnitPrice = getUnitPrice(itemId);
    const directBuyCost = directMarketCost(itemId, targetQty);
    const directBuy = directBuyCost === null ? Infinity : directBuyCost;
    const rootRecipes = recipesByOutput[itemId] || [];
    const forcedRootRecipe = requestedRecipeKey
        ? rootRecipes.find((recipe) => recipeSignature(recipe) === requestedRecipeKey)
        : null;
    const cheapestTree = buildBoundedRecipeTree(itemId, targetQty, 0, new Set(), forcedRootRecipe);
    const cheapestNodeCount = nodeCount;
    nodeCount = 0;
    const tree = buildFullRecipeTree(itemId, targetQty, 0, new Set(), forcedRootRecipe);
    const fullRecipeNodeCount = nodeCount;

    const alternativeKeys = new Set();
    const alternatives = [];
    const rootCandidates = rootRecipes
        .map((recipe) => {
            const runsNeeded = Math.ceil(targetQty / recipe.qtyYielded);
            return {
                recipe,
                recipeKey: recipeSignature(recipe),
                runsNeeded,
                estimatedCost: estimateRecipeDirectCost(recipe, runsNeeded),
            };
        })
        .sort((a, b) => {
            if (forcedRootRecipe && a.recipeKey === requestedRecipeKey) return -1;
            if (forcedRootRecipe && b.recipeKey === requestedRecipeKey) return 1;
            const aCost = Number.isFinite(a.estimatedCost) ? a.estimatedCost : Number.MAX_SAFE_INTEGER;
            const bCost = Number.isFinite(b.estimatedCost) ? b.estimatedCost : Number.MAX_SAFE_INTEGER;
            return aCost - bCost;
        });

    for (const candidate of rootCandidates) {
        if (alternatives.length >= alternativeLimit) break;
        if (alternativeKeys.has(candidate.recipeKey)) continue;
        nodeCount = 0;
        const altTree = buildFullRecipeTree(itemId, targetQty, 0, new Set(), candidate.recipe);
        nodeCount = 0;
        const altCheapestTree = buildBoundedRecipeTree(itemId, targetQty, 0, new Set(), candidate.recipe);
        if (altTree.action !== 'CRAFT' || !Number.isFinite(altTree.totalCost)) continue;
        alternativeKeys.add(candidate.recipeKey);
        alternatives.push({
            recipeKey: candidate.recipeKey,
            selected: forcedRootRecipe
                ? candidate.recipeKey === requestedRecipeKey
                : candidate.recipeKey === tree.recipeKey,
            recipeInputs: recipeInputsForDisplay(candidate.recipe, candidate.runsNeeded),
            outputQty: altTree.qty,
            totalCost: altTree.totalCost,
            unitPrice: altTree.unitPrice,
            cheapestTotalCost: altCheapestTree.totalCost,
            savings: directBuy - altTree.totalCost,
            savingsPercent: directBuy > 0 && Number.isFinite(directBuy)
                ? +(((directBuy - altTree.totalCost) / directBuy) * 100).toFixed(1)
                : null,
            tree: altTree,
        });
    }

    alternatives.sort((a, b) => a.totalCost - b.totalCost);
    if (forcedRootRecipe) {
        alternatives.sort((a, b) => Number(b.selected) - Number(a.selected) || a.totalCost - b.totalCost);
    }

    res.json({
        tree,
        cheapestTree,
        fullRecipeCost: tree.totalCost,
        cheapestCost: cheapestTree.totalCost,
        directBuyCost: directBuy,
        savings: directBuy - cheapestTree.totalCost,
        savingsPercent: directBuy > 0 ? ((directBuy - cheapestTree.totalCost) / directBuy * 100).toFixed(1) : 0,
        alternatives,
        nodeCount: cheapestNodeCount + fullRecipeNodeCount,
        maxDepth,
        capped: cheapestNodeCount >= maxNodes || fullRecipeNodeCount >= maxNodes,
    });
});

let moulberryCache = {};
let moulberryLastFetch = 0;
let accessoryRecipeCache = { time: 0, recipes: [], sourceCount: 0 };
let accessoryCatalogCache = { time: 0, items: [], sourceCount: 0 };
let forgeRecipeCache = { time: 0, recipes: [], sourceCount: 0 };
const accessoryOutputPriceCache = new Map();

const MAGIC_POWER_BY_RARITY = {
  COMMON: 3,
  UNCOMMON: 5,
  RARE: 8,
  EPIC: 12,
  LEGENDARY: 16,
  MYTHIC: 22,
  SPECIAL: 3,
  VERY_SPECIAL: 5,
};

app.get('/api/lowestbin', async (req, res) => {
  if (Date.now() - moulberryLastFetch > 60000 || Object.keys(moulberryCache).length === 0) {
    try {
      const mbRes = await timedGet('https://moulberry.codes/lowestbin.json');
      moulberryCache = mbRes.data;
      moulberryLastFetch = Date.now();
    } catch(e) {
      console.error('Failed to update Moulberry cache', e.message);
    }
  }
  res.json(moulberryCache);
});

const ACCESSORY_FILE_HINTS = [
  'ACCESSORY', 'TALISMAN', 'RING', 'ARTIFACT', 'RELIC', 'CHARM', 'CLOAK',
  'BELT', 'NECKLACE', 'BRACELET', 'GLOVES', 'GAUNTLET', 'BADGE', 'SEAL',
  'ORB', 'SCARF', 'CREST', 'COMPASS', 'PERSONAL_COMPACTOR', 'DELETOR',
  'SACK', 'ENRICHMENT', 'HEGEMONY', 'JACOBUS', 'BEASTMASTER', 'BAT_PERSON'
];

function cleanNeuName(name) {
  return String(name || '')
    .replace(/§./g, '')
    .replace(/\[[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function neuItemRarity(item) {
  const direct = String(item?.rarity || item?.tier || '').toUpperCase().replace(/\s+/g, '_');
  if (MAGIC_POWER_BY_RARITY[direct]) return direct;

  const stripCodes = (value) => cleanNeuName(String(value || '').replace(/§./g, ''));
  const text = [
    item?.displayname,
    item?.display_name,
    item?.name,
    ...(Array.isArray(item?.lore) ? item.lore : []),
  ].map(stripCodes).join(' ').toUpperCase();

  const match = text.match(/\b(VERY SPECIAL|SPECIAL|MYTHIC|LEGENDARY|EPIC|RARE|UNCOMMON|COMMON)\s+(ACCESSORY|HATCCESSORY|NECKLACE|CLOAK|BELT|BRACELET|GLOVES)\b/);
  return match ? match[1].replace(/\s+/g, '_') : '';
}

function isAccessoryLikeItem(item, fileBase) {
  const category = String(item.category || item.item_category || '').toUpperCase();
  const type = String(item.type || '').toUpperCase();
  const display = cleanNeuName(item.displayname || item.display_name || item.name).toUpperCase();
  const lore = Array.isArray(item.lore) ? item.lore.map(cleanNeuName).join(' ').toUpperCase() : '';
  const id = String(item.internalname || fileBase || '').toUpperCase();
  if (category.includes('ACCESSORY') || type.includes('ACCESSORY')) return true;
  if (lore.includes('ACCESSORY')) return true;
  return ACCESSORY_FILE_HINTS.some((hint) => id.includes(hint) || display.includes(hint.replace(/_/g, ' ')));
}

function parseNeuIngredient(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(':');
  const last = Number(parts[parts.length - 1]);
  if (parts.length > 1 && Number.isFinite(last)) {
    return { id: parts.slice(0, -1).join(':'), qty: last };
  }
  return { id: trimmed, qty: 1 };
}

function parseNeuRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object') return [];
  const counts = {};
  Object.values(recipe).forEach((slot) => {
    const parsed = parseNeuIngredient(slot);
    if (!parsed || !parsed.id || parsed.qty <= 0) return;
    counts[parsed.id] = (counts[parsed.id] || 0) + parsed.qty;
  });
  return Object.entries(counts).map(([id, qty]) => ({ id, qty }));
}

function parseForgeIngredients(inputs) {
  const counts = {};
  if (!Array.isArray(inputs)) return [];
  inputs.forEach((raw) => {
    const parsed = parseNeuIngredient(raw);
    if (!parsed || !parsed.id || parsed.qty <= 0) return;
    counts[parsed.id] = (counts[parsed.id] || 0) + parsed.qty;
  });
  return Object.entries(counts).map(([id, qty]) => ({ id, qty }));
}

async function fetchJsonOrNull(url) {
  try {
    const response = await axios.get(url, {
      timeout: 30000,
      headers: {
        'User-Agent': 'skyblock-flips-local-tool',
        'Accept': 'application/json',
      },
    });
    return response.data;
  } catch (error) {
    return null;
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await worker(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

async function loadAccessoryRecipes() {
  const fresh = accessoryRecipeCache.recipes.length > 0 && Date.now() - accessoryRecipeCache.time < ACCESSORY_RECIPE_CACHE_MS;
  if (fresh) return accessoryRecipeCache;

  const treeData = await fetchJsonOrNull(NEU_REPO_TREE_URL);
  const tree = Array.isArray(treeData?.tree) ? treeData.tree : [];
  const candidatePaths = tree
    .filter((entry) => entry.type === 'blob' && /^items\/.+\.json$/i.test(entry.path || ''))
    .filter((entry) => {
      const base = path.basename(entry.path, '.json').toUpperCase();
      return ACCESSORY_FILE_HINTS.some((hint) => base.includes(hint));
    })
    .slice(0, 700);

  const itemFiles = await mapLimit(candidatePaths, 8, async (entry) => {
    const fileName = path.basename(entry.path);
    const item = await fetchJsonOrNull(`${NEU_RAW_ITEM_URL}/${encodeURIComponent(fileName)}`);
    if (!item || !item.recipe) return null;
    const internalId = item.internalname || path.basename(fileName, '.json');
    if (!isAccessoryLikeItem(item, internalId)) return null;
    const ingredients = parseNeuRecipe(item.recipe);
    if (ingredients.length === 0) return null;
    return {
      id: internalId,
      name: cleanNeuName(item.displayname || item.display_name || internalId.replace(/_/g, ' ')),
      rarity: neuItemRarity(item),
      ingredients,
    };
  });

  const recipes = itemFiles.filter(Boolean);
  accessoryRecipeCache = { time: Date.now(), recipes, sourceCount: candidatePaths.length };
  return accessoryRecipeCache;
}

async function loadAccessoryCatalog() {
  const fresh = accessoryCatalogCache.items.length > 0 && Date.now() - accessoryCatalogCache.time < ACCESSORY_RECIPE_CACHE_MS;
  if (fresh) return accessoryCatalogCache;

  const treeData = await fetchJsonOrNull(NEU_REPO_TREE_URL);
  const tree = Array.isArray(treeData?.tree) ? treeData.tree : [];
  const candidatePaths = tree
    .filter((entry) => entry.type === 'blob' && /^items\/.+\.json$/i.test(entry.path || ''))
    .filter((entry) => {
      const base = path.basename(entry.path, '.json').toUpperCase();
      return ACCESSORY_FILE_HINTS.some((hint) => base.includes(hint));
    })
    .slice(0, 900);

  const itemFiles = await mapLimit(candidatePaths, 8, async (entry) => {
    const fileName = path.basename(entry.path);
    const item = await fetchJsonOrNull(`${NEU_RAW_ITEM_URL}/${encodeURIComponent(fileName)}`);
    if (!item) return null;
    const internalId = item.internalname || path.basename(fileName, '.json');
    if (!isAccessoryLikeItem(item, internalId)) return null;
    const rarity = neuItemRarity(item);
    const magicPower = MAGIC_POWER_BY_RARITY[rarity] || 0;
    if (magicPower <= 0) return null;
    const ingredients = parseNeuRecipe(item.recipe);
    return {
      id: internalId,
      name: cleanNeuName(item.displayname || item.display_name || internalId.replace(/_/g, ' ')),
      rarity,
      magicPower,
      soulbound: String(item.soulbound || item.coop_soulbound || '').toLowerCase() === 'true',
      museum: Boolean(item.museum),
      ingredients,
    };
  });

  const byId = new Map();
  itemFiles.filter(Boolean).forEach((item) => {
    if (!byId.has(item.id)) byId.set(item.id, item);
  });
  const items = Array.from(byId.values());
  accessoryCatalogCache = { time: Date.now(), items, sourceCount: candidatePaths.length };
  return accessoryCatalogCache;
}

function normalizeUuid(value) {
  return String(value || '').replace(/-/g, '').trim().toLowerCase();
}

async function resolveMinecraftUuid(player) {
  const raw = String(player || '').trim();
  if (!raw) return null;
  const normalized = normalizeUuid(raw);
  if (/^[0-9a-f]{32}$/.test(normalized)) return normalized;

  const response = await axios.get(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(raw)}`, {
    timeout: 10000,
  });
  return normalizeUuid(response.data?.id);
}

async function parseInventoryBlob(data) {
  if (!data || typeof data !== 'string') return null;
  try {
    const compressed = Buffer.from(data, 'base64');
    const inflated = zlib.gunzipSync(compressed);
    const parsed = await nbt.parse(inflated);
    return nbt.simplify(parsed.parsed);
  } catch (error) {
    return null;
  }
}

function collectInventoryBlobs(value, blobs = [], pathParts = []) {
  if (!value || typeof value !== 'object') return blobs;
  if (typeof value.data === 'string' && value.data.length > 32) {
    blobs.push({ path: pathParts.concat('data').join('.'), data: value.data });
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectInventoryBlobs(entry, blobs, pathParts.concat(String(index))));
    return blobs;
  }
  Object.entries(value).forEach(([key, child]) => {
    if (key === 'data') return;
    collectInventoryBlobs(child, blobs, pathParts.concat(key));
  });
  return blobs;
}

function collectItemIdsFromNbt(value, ids = []) {
  if (!value) return ids;
  if (Array.isArray(value)) {
    value.forEach((entry) => collectItemIdsFromNbt(entry, ids));
    return ids;
  }
  if (typeof value !== 'object') return ids;

  const extraId = value.tag?.ExtraAttributes?.id
    || value.ExtraAttributes?.id
    || value.tag?.value?.ExtraAttributes?.value?.id?.value
    || value.value?.tag?.value?.ExtraAttributes?.value?.id?.value;
  if (typeof extraId === 'string' && extraId.trim()) ids.push(extraId.trim().toUpperCase());

  Object.values(value).forEach((child) => collectItemIdsFromNbt(child, ids));
  return ids;
}

function selectSkyblockProfile(profiles, profileName, uuid) {
  const list = Array.isArray(profiles) ? profiles : [];
  if (profileName) {
    const wanted = String(profileName).trim().toLowerCase();
    const byName = list.find((profile) => String(profile.cute_name || '').toLowerCase() === wanted);
    if (byName) return byName;
  }
  return list.find((profile) => profile.selected)
    || list.slice().sort((a, b) => Number(b.members?.[uuid]?.last_save || 0) - Number(a.members?.[uuid]?.last_save || 0))[0]
    || null;
}

app.get('/api/player-accessories', async (req, res) => {
  try {
    if (!HYPIXEL_API_KEY) {
      return res.status(400).json({ error: 'Missing HYPIXEL_API_KEY on backend' });
    }

    const uuid = await resolveMinecraftUuid(req.query.player || req.query.uuid);
    if (!uuid) return res.status(400).json({ error: 'Missing or invalid player' });

    const response = await axios.get('https://api.hypixel.net/v2/skyblock/profiles', {
      timeout: 15000,
      params: { uuid },
      headers: { 'API-Key': HYPIXEL_API_KEY },
    });

    if (!response.data?.success) {
      return res.status(502).json({ error: response.data?.cause || 'Hypixel profile request failed' });
    }

    const profile = selectSkyblockProfile(response.data.profiles, req.query.profile, uuid);
    if (!profile) return res.status(404).json({ error: 'No SkyBlock profiles found for this player' });

    const member = profile.members?.[uuid];
    if (!member) return res.status(404).json({ error: 'Player was not found in selected profile' });

    const { items: accessoryCatalog } = await loadAccessoryCatalog();
    const accessoryIds = new Set(accessoryCatalog.map((item) => item.id.toUpperCase()));
    const blobs = collectInventoryBlobs(member);
    const foundIds = new Set();
    const parsedSources = [];
    const allParsedIds = new Set();
    let parsedBlobCount = 0;

    for (const blob of blobs) {
      const parsed = await parseInventoryBlob(blob.data);
      if (!parsed) continue;
      parsedBlobCount += 1;
      const allIds = collectItemIdsFromNbt(parsed);
      allIds.forEach((id) => allParsedIds.add(id));
      const ids = allIds.filter((id) => accessoryIds.has(id));
      if (ids.length > 0) ids.forEach((id) => foundIds.add(id));
      parsedSources.push({
        path: blob.path,
        itemIdCount: allIds.length,
        accessoryIdCount: ids.length,
        sampleItemIds: allIds.slice(0, 8),
      });
    }

    const rows = Array.from(foundIds)
      .map((id) => {
        const item = accessoryCatalog.find((entry) => entry.id.toUpperCase() === id);
        return {
          id,
          name: item?.name || displayItemName(id),
          rarity: item?.rarity || '',
          magicPower: item?.magicPower || 0,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      player: req.query.player || req.query.uuid,
      uuid,
      profileId: profile.profile_id,
      profileName: profile.cute_name,
      accessoryIds: rows.map((row) => row.id),
      rows,
      count: rows.length,
      availableProfiles: (response.data.profiles || []).map((entry) => ({
        profileId: entry.profile_id,
        profileName: entry.cute_name,
        selected: Boolean(entry.selected),
      })),
      diagnostics: {
        inventoryBlobCount: blobs.length,
        parsedBlobCount,
        parsedItemIdCount: allParsedIds.size,
        sampleParsedItemIds: Array.from(allParsedIds).slice(0, 20),
        inventoryApiLikelyDisabled: blobs.length === 0 || parsedBlobCount === 0,
      },
      parsedSources,
    });
  } catch (error) {
    const status = error.response?.status;
    const cause = error.response?.data?.cause || error.response?.data?.error || error.message;
    console.error('Crash in player-accessories:', cause);
    res.status(status === 403 ? 403 : 500).json({
      error: status === 403 ? 'Hypixel API key was rejected' : 'Failed to load player accessories',
      details: cause,
    });
  }
});

function isForgeCandidatePath(filePath) {
  const base = path.basename(filePath, '.json').toUpperCase();
  return [
    'AMBER', 'AUSPICIOUS', 'BEJEWELED', 'BEJEWELED_HANDLE', 'BLUE_CHEESE',
    'DIVAN', 'DRILL', 'DRILL_ENGINE', 'FUEL', 'FUEL_TANK', 'GEMSTONE',
    'GOLDEN_PLATE', 'JADE', 'JASPER', 'MITHRIL', 'MIXTURE', 'PERFECT',
    'PET_ITEM_TIER_BOOST', 'PLASMA', 'POLISHED', 'REFINED', 'RUBY',
    'SAPPHIRE', 'TITANIUM', 'TOPAZ', 'UMBER', 'VANGUARD'
  ].some((hint) => base.includes(hint));
}

async function loadForgeRecipes() {
  const fresh = forgeRecipeCache.recipes.length > 0 && Date.now() - forgeRecipeCache.time < FORGE_RECIPE_CACHE_MS;
  if (fresh) return forgeRecipeCache;

  const treeData = await fetchJsonOrNull(NEU_REPO_TREE_URL);
  const tree = Array.isArray(treeData?.tree) ? treeData.tree : [];
  const candidatePaths = tree
    .filter((entry) => entry.type === 'blob' && /^items\/.+\.json$/i.test(entry.path || ''))
    .filter((entry) => isForgeCandidatePath(entry.path || ''));

  const itemFiles = await mapLimit(candidatePaths, 8, async (entry) => {
    const fileName = path.basename(entry.path);
    const item = await fetchJsonOrNull(`${NEU_RAW_ITEM_URL}/${encodeURIComponent(fileName)}`);
    if (!item || !Array.isArray(item.recipes)) return [];

    const outputId = item.internalname || path.basename(fileName, '.json');
    const outputName = cleanNeuName(item.displayname || item.display_name || outputId.replace(/_/g, ' '));
    const rarity = String(item.rarity || item.tier || '').toUpperCase();

    return item.recipes
      .filter((recipe) => recipe?.type === 'forge')
      .map((recipe, index) => {
        const ingredients = parseForgeIngredients(recipe.inputs);
        if (ingredients.length === 0) return null;
        return {
          id: `${recipe.overrideOutputId || outputId}:${index}`,
          outputId: recipe.overrideOutputId || outputId,
          name: outputName,
          rarity,
          count: Number(recipe.count || 1),
          durationSeconds: Number(recipe.duration || 0),
          requirement: cleanNeuName(item.crafttext || ''),
          ingredients,
        };
      })
      .filter(Boolean);
  });

  const recipes = itemFiles.flat().filter(Boolean);
  forgeRecipeCache = { time: Date.now(), recipes, sourceCount: candidatePaths.length };
  return forgeRecipeCache;
}

async function ensureLowestBinCache() {
  if (Date.now() - moulberryLastFetch <= 60000 && Object.keys(moulberryCache).length > 0) return moulberryCache;
  try {
    const mbRes = await axios.get('https://moulberry.codes/lowestbin.json', { timeout: 30000 });
    moulberryCache = mbRes.data || {};
    moulberryLastFetch = Date.now();
  } catch (error) {
    console.error('Failed to update accessory LBIN cache:', error.message);
  }
  return moulberryCache;
}

function priceCraftIngredient(ingredient, lbinData, inMode = 'insta-buy') {
  if (ingredient.id === 'SKYBLOCK_COIN') {
    return {
      ...ingredient,
      name: 'Coins',
      source: 'coin-cost',
      unitPrice: 1,
      totalCost: ingredient.qty,
      missing: false,
    };
  }

  const bazaarCost = marketCostForQty(ingredient.id, ingredient.qty, inMode);
  if (bazaarCost !== null) {
    return {
      ...ingredient,
      name: displayItemName(ingredient.id),
      source: 'bazaar',
      unitPrice: bazaarCost / ingredient.qty,
      totalCost: bazaarCost,
      missing: false,
    };
  }

  const lbin = Number(lbinData[ingredient.id] || 0);
  if (Number.isFinite(lbin) && lbin > 0) {
    return {
      ...ingredient,
      name: displayItemName(ingredient.id),
      source: 'lowest-bin',
      unitPrice: lbin,
      totalCost: lbin * ingredient.qty,
      missing: false,
    };
  }

  return {
    ...ingredient,
    name: displayItemName(ingredient.id),
    source: 'missing',
    unitPrice: 0,
    totalCost: 0,
    missing: true,
  };
}

async function getForgeOutputPrice(itemId, lbinData, outMode = 'sell-order') {
  const bz = rawBazaarCache[itemId];
  if (bz?.quick_status) {
    const price = outMode === 'insta-sell'
      ? Number(bz.quick_status.sellPrice || 0)
      : Number(bz.quick_status.buyPrice || 0);
    if (price > 0) return { price, source: outMode === 'insta-sell' ? 'bazaar-instasell' : 'bazaar-sell-order' };
  }
  return getAccessoryOutputPrice(itemId, lbinData);
}

async function getAccessoryOutputPrice(itemId, lbinData) {
  const lbin = Number(lbinData[itemId] || 0);
  if (Number.isFinite(lbin) && lbin > 0) return { price: lbin, source: 'lowest-bin' };

  const cached = accessoryOutputPriceCache.get(itemId);
  if (cached && Date.now() - cached.time < 10 * 60 * 1000) return cached.value;

  try {
    const config = {};
    if (SKYCOFL_API_KEY) config.headers = { 'Authorization': SKYCOFL_API_KEY };
    const response = await axios.get(`https://sky.coflnet.com/api/item/price/${encodeURIComponent(itemId)}`, {
      timeout: 10000,
      ...config,
    });
    const price = Number(response.data?.median || response.data?.mode || response.data?.min || 0);
    const value = Number.isFinite(price) && price > 0
      ? { price, source: 'skycofl' }
      : { price: 0, source: 'missing' };
    accessoryOutputPriceCache.set(itemId, { time: Date.now(), value });
    return value;
  } catch (error) {
    const value = { price: 0, source: 'missing' };
    accessoryOutputPriceCache.set(itemId, { time: Date.now(), value });
    return value;
  }
}

app.get('/api/accessory-flips', async (req, res) => {
  try {
    await refreshRawBazaarCache();
    const lbinData = await ensureLowestBinCache();
    const { recipes, sourceCount, time } = await loadAccessoryRecipes();
    const minProfit = Number(req.query.minProfit || 0);
    const minRoi = Number(req.query.minRoi || 0);
    const maxResults = Math.min(300, Math.max(10, parseInt(req.query.limit, 10) || 100));
    const feeRate = Math.min(0.1, Math.max(0, Number(req.query.feeRate || 0.02)));
    const inMode = req.query.inMode || 'insta-buy';
    const rarity = String(req.query.rarity || 'all').toUpperCase();

    const pricedRows = await mapLimit(recipes, 8, async (recipe) => {
      const outputPricing = await getAccessoryOutputPrice(recipe.id, lbinData);
      const outputPrice = outputPricing.price;
      const ingredients = recipe.ingredients.map((ingredient) => priceCraftIngredient(ingredient, lbinData, inMode));
      const missing = ingredients.filter((ingredient) => ingredient.missing);
      const craftCost = ingredients.reduce((sum, ingredient) => sum + ingredient.totalCost, 0);
      const netRevenue = outputPrice * (1 - feeRate);
      const profit = netRevenue - craftCost;
      const roi = craftCost > 0 ? (profit / craftCost) * 100 : 0;

      return {
        id: recipe.id,
        name: recipe.name,
        rarity: recipe.rarity,
        outputPrice,
        outputPriceSource: outputPricing.source,
        netRevenue,
        craftCost,
        profit,
        roi,
        feeRate,
        complete: outputPrice > 0 && missing.length === 0 && craftCost > 0,
        missing: missing.map((ingredient) => ingredient.id),
        ingredients,
      };
    });

    const rows = pricedRows
      .filter((row) => row.complete)
      .filter((row) => rarity === 'ALL' || row.rarity === rarity)
      .filter((row) => row.profit >= minProfit && row.roi >= minRoi)
      .sort((a, b) => b.profit - a.profit)
      .slice(0, maxResults);

    res.json({
      rows,
      updatedAt: Date.now(),
      recipeCacheAgeMs: Date.now() - time,
      recipesScanned: recipes.length,
      sourceCandidates: sourceCount,
      feeRate,
      lbinAvailable: Object.keys(lbinData).length > 0,
    });
  } catch (error) {
    console.error('Crash in accessory-flips:', error.message);
    res.status(500).json({ error: 'Failed to calculate accessory flips', details: error.message });
  }
});

app.get('/api/magic-power', async (req, res) => {
  try {
    await refreshRawBazaarCache();
    const lbinData = await ensureLowestBinCache();
    const { items, sourceCount, time } = await loadAccessoryCatalog();
    const maxResults = Math.min(500, Math.max(10, parseInt(req.query.limit, 10) || 150));
    const rarity = String(req.query.rarity || 'all').toUpperCase();
    const maxCoinsPerMp = Number(req.query.maxCoinsPerMp || 0);
    const minMagicPower = Number(req.query.minMagicPower || 0);
    const includeSoulbound = req.query.includeSoulbound === 'true';
    const includeCraft = req.query.includeCraft !== 'false';
    const inMode = req.query.inMode || 'insta-buy';
    const excludedIds = new Set(String(req.query.excludeIds || '')
      .split(',')
      .map((id) => id.trim().toUpperCase())
      .filter(Boolean));

    const pricedRows = await mapLimit(items, 8, async (item) => {
      const directPricing = await getAccessoryOutputPrice(item.id, lbinData);
      const directCost = directPricing.price > 0 ? directPricing.price : Infinity;

      let craftCost = Infinity;
      let ingredients = [];
      let missing = [];
      if (includeCraft && item.ingredients.length > 0) {
        ingredients = item.ingredients.map((ingredient) => priceCraftIngredient(ingredient, lbinData, inMode));
        missing = ingredients.filter((ingredient) => ingredient.missing).map((ingredient) => ingredient.id);
        if (missing.length === 0) {
          craftCost = ingredients.reduce((sum, ingredient) => sum + ingredient.totalCost, 0);
        }
      }

      const bestCost = Math.min(directCost, craftCost);
      const bestMethod = craftCost < directCost ? 'craft' : 'buy';
      const coinsPerMagicPower = item.magicPower > 0 ? bestCost / item.magicPower : Infinity;

      return {
        ...item,
        directCost: Number.isFinite(directCost) ? directCost : 0,
        directSource: directPricing.source,
        craftCost: Number.isFinite(craftCost) ? craftCost : 0,
        bestCost,
        bestMethod,
        coinsPerMagicPower,
        ingredients,
        missing,
        complete: Number.isFinite(bestCost) && bestCost > 0,
      };
    });

    const rows = pricedRows
      .filter((row) => row.complete)
      .filter((row) => !excludedIds.has(row.id.toUpperCase()))
      .filter((row) => includeSoulbound || !row.soulbound)
      .filter((row) => rarity === 'ALL' || row.rarity === rarity)
      .filter((row) => row.magicPower >= minMagicPower)
      .filter((row) => maxCoinsPerMp <= 0 || row.coinsPerMagicPower <= maxCoinsPerMp)
      .sort((a, b) => a.coinsPerMagicPower - b.coinsPerMagicPower || a.bestCost - b.bestCost)
      .slice(0, maxResults)
      .map((row) => ({
        ...row,
        bestCost: Math.round(row.bestCost),
        coinsPerMagicPower: Math.round(row.coinsPerMagicPower),
      }));

    res.json({
      rows,
      updatedAt: Date.now(),
      catalogCacheAgeMs: Date.now() - time,
      accessoriesScanned: items.length,
      sourceCandidates: sourceCount,
      lbinAvailable: Object.keys(lbinData).length > 0,
      magicPowerByRarity: MAGIC_POWER_BY_RARITY,
    });
  } catch (error) {
    console.error('Crash in magic-power:', error.message);
    res.status(500).json({ error: 'Failed to calculate magic power optimizer', details: error.message });
  }
});

app.get('/api/forge-flips', async (req, res) => {
  try {
    await refreshRawBazaarCache();
    const lbinData = await ensureLowestBinCache();
    const { recipes, sourceCount, time } = await loadForgeRecipes();
    const minProfit = Number(req.query.minProfit || 0);
    const minRoi = Number(req.query.minRoi || 0);
    const minCoinsPerHour = Number(req.query.minCoinsPerHour || 0);
    const maxResults = Math.min(300, Math.max(10, parseInt(req.query.limit, 10) || 100));
    const feeRate = Math.min(0.1, Math.max(0, Number(req.query.feeRate || 0.02)));
    const inMode = req.query.inMode || 'insta-buy';
    const outMode = req.query.outMode || 'sell-order';
    const maxHours = Number(req.query.maxHours || 0);

    const pricedRows = await mapLimit(recipes, 8, async (recipe) => {
      const outputPricing = await getForgeOutputPrice(recipe.outputId, lbinData, outMode);
      const outputPrice = outputPricing.price;
      const ingredients = recipe.ingredients.map((ingredient) => priceCraftIngredient(ingredient, lbinData, inMode));
      const missing = ingredients.filter((ingredient) => ingredient.missing);
      const craftCost = ingredients.reduce((sum, ingredient) => sum + ingredient.totalCost, 0);
      const grossRevenue = outputPrice * recipe.count;
      const netRevenue = grossRevenue * (1 - feeRate);
      const profit = netRevenue - craftCost;
      const roi = craftCost > 0 ? (profit / craftCost) * 100 : 0;
      const durationHours = recipe.durationSeconds > 0 ? recipe.durationSeconds / 3600 : 0;
      const coinsPerHour = durationHours > 0 ? profit / durationHours : profit;

      return {
        ...recipe,
        outputPrice,
        outputPriceSource: outputPricing.source,
        grossRevenue,
        netRevenue,
        craftCost,
        profit,
        roi,
        durationHours,
        coinsPerHour,
        feeRate,
        complete: outputPrice > 0 && missing.length === 0 && craftCost > 0,
        missing: missing.map((ingredient) => ingredient.id),
        ingredients,
      };
    });

    const rows = pricedRows
      .filter((row) => row.complete)
      .filter((row) => row.profit >= minProfit && row.roi >= minRoi && row.coinsPerHour >= minCoinsPerHour)
      .filter((row) => maxHours <= 0 || row.durationHours <= maxHours)
      .sort((a, b) => b.coinsPerHour - a.coinsPerHour || b.profit - a.profit)
      .slice(0, maxResults);

    res.json({
      rows,
      updatedAt: Date.now(),
      recipeCacheAgeMs: Date.now() - time,
      recipesScanned: recipes.length,
      sourceCandidates: sourceCount,
      feeRate,
      outMode,
      inMode,
      lbinAvailable: Object.keys(lbinData).length > 0,
    });
  } catch (error) {
    console.error('Crash in forge-flips:', error.message);
    res.status(500).json({ error: 'Failed to calculate forge flips', details: error.message });
  }
});

// --- Background Polling ---
let isPollingBazaar = false;
let isPollingAuctions = false;
let isPollingItems = false;

async function pollBazaar() {
  if (isPollingBazaar) return;
  isPollingBazaar = true;
  try {
    const url = 'https://api.hypixel.net/v2/skyblock/bazaar';
    // If user provided a key, maybe add it, but this endpoint is public
    const res = await timedGet(url);
    if (res.data.success) {
      rawBazaarCache = res.data.products;
      rawBazaarLastFetch = Date.now();
      if (ENABLE_SUPABASE_MARKET_SYNC) await getDb().updateBazaar(res.data.products);
      console.log(`[${new Date().toLocaleTimeString()}] Updated Bazaar data${ENABLE_SUPABASE_MARKET_SYNC ? ' + Supabase market sync' : ' (live cache only)'}`);
    }
  } catch (error) {
    console.error('Error polling Bazaar:', error.message);
  } finally {
    isPollingBazaar = false;
  }
}

async function pollAuctions() {
  if (isPollingAuctions) return;
  isPollingAuctions = true;
  try {
    const pagesToFetch = [0, 1, 2];
    const liveRows = [];
    for (const page of pagesToFetch) {
      const url = `https://api.hypixel.net/v2/skyblock/auctions?page=${page}`;
      // In a real prod with a key, pass it as a header "API-Key"
      const res = await timedGet(url);
      if (res.data.success && res.data.auctions) {
        liveRows.push(...res.data.auctions.filter(auc => auc.bin).map(auc => ({
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
        })));
        if (ENABLE_SUPABASE_MARKET_SYNC) await getDb().updateAuctions(res.data.auctions);
      }
    }
    liveAuctionsCache = liveRows
      .filter(auction => auction.end > Date.now())
      .sort((a, b) => (b.start || 0) - (a.start || 0))
      .slice(0, 1000);
    liveAuctionsLastFetch = Date.now();
    console.log(`[${new Date().toLocaleTimeString()}] Updated Auctions data${ENABLE_SUPABASE_MARKET_SYNC ? ' + Supabase market sync' : ' (live cache only)'}`);
  } catch (error) {
    console.error('Error polling Auctions:', error.message);
  } finally {
    isPollingAuctions = false;
  }
}

async function pollItems() {
  if (isPollingItems) return;
  isPollingItems = true;
  try {
    const url = 'https://api.hypixel.net/v2/resources/skyblock/items';
    const res = await timedGet(url);
    if (res.data.success && res.data.items) {
      npcSellPriceCache = Object.fromEntries(
        res.data.items
          .filter((item) => item.id && item.npc_sell_price !== undefined)
          .map((item) => [item.id, Number(item.npc_sell_price || 0)])
      );
      if (ENABLE_SUPABASE_MARKET_SYNC) {
        await getDb().updateItems(res.data.items);
      }
      console.log(`[${new Date().toLocaleTimeString()}] Updated NPC price cache${ENABLE_SUPABASE_MARKET_SYNC ? ' + Supabase market sync' : ''}`);
    }
  } catch (error) {
    console.error('Error polling Items:', error.message);
  } finally {
    isPollingItems = false;
  }
}

setInterval(pollBazaar, POLL_BAZAAR_MS); 
setInterval(pollAuctions, POLL_AUCTIONS_MS); 
setInterval(pollItems, POLL_ITEMS_MS);

// Initial poll on startup
pollBazaar();
pollAuctions();
pollItems();

app.listen(port, '0.0.0.0', () => {
  console.log(`Backend server running on port ${port}`);
});
