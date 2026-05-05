const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const db = require('./database.js');

const app = express();
app.use(cors());
app.use(express.json());
const port = 3000;

let HYPIXEL_API_KEY = process.env.HYPIXEL_API_KEY || '';
const SKYCOFL_API_KEY = process.env.SKYCOFL_API_KEY || '';
const HTTP_TIMEOUT_MS = 8000;
const FUSION_CACHE_MS = 15000;

const timedGet = (url, config = {}) => axios.get(url, { timeout: HTTP_TIMEOUT_MS, ...config });

// --- Admin Settings Routes ---
app.get('/api/settings/apikey', (req, res) => {
    res.json({ apikey: HYPIXEL_API_KEY });
});

app.post('/api/settings/apikey', (req, res) => {
    const newKey = req.body.apikey;
    if (!newKey) return res.status(400).json({ error: 'No key provided' });
    
    HYPIXEL_API_KEY = newKey;
    process.env.HYPIXEL_API_KEY = newKey;

    try {
        const envPath = path.join(__dirname, '.env');
        if (fs.existsSync(envPath)) {
            let envContext = fs.readFileSync(envPath, 'utf8');
            if (envContext.includes('HYPIXEL_API_KEY=')) {
                envContext = envContext.replace(/HYPIXEL_API_KEY=.*/, `HYPIXEL_API_KEY=${newKey}`);
            } else {
                envContext += `\nHYPIXEL_API_KEY=${newKey}\n`;
            }
            fs.writeFileSync(envPath, envContext, 'utf8');
        } else {
            fs.writeFileSync(envPath, `HYPIXEL_API_KEY=${newKey}\n`, 'utf8');
        }
        res.json({ success: true, message: 'API Key updated!' });
    } catch (err) {
        console.error('Error writing .env:', err);
        res.status(500).json({ error: 'Failed to write to .env', details: err.message });
    }
});

app.post('/api/settings/restart', (req, res) => {
    res.json({ success: true, message: 'Rebooting...' });
    setTimeout(() => {
        console.log("Remote restart triggered from UI. Exiting process.");
        process.exit(1);
    }, 500);
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
    if (row && row.average_bin > 0 && Date.now() - row.lastUpdated < 3600000) {
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
      const coflRes = await timedGet(`https://sky.coflnet.com/api/item/price/${itemId}`, config);
      const average = Math.floor(coflRes.data.median || coflRes.data.mode || coflRes.data.min || 0);
      db.updateSkyCoflHistory([{ id: itemId, average_bin: average, sales_last_day: coflRes.data.volume || 0 }]);
      res.json({ average_bin: average, sales_last_day: coflRes.data.volume || 0 });
    } catch (error) {
      console.error(`SkyCofl fetch failed for ${itemId}:`, error.message);
      res.status(500).json({ error: 'Failed to fetch from SkyCofl' });
    }
  });
});

// Raw Live Proxy for Hypixel to parse 'sellMovingWeek'
let rawBazaarCache = {};
let rawBazaarLastFetch = 0;
let rawBazaarRefreshPromise = null;
const bestFusionsCache = new Map();
const batchOptimizeCache = new Map();

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

// --- SETTINGS ENDPOINTS ---
app.get('/api/settings/apikey', (req, res) => {
    res.json({ apikey: process.env.HYPIXEL_API_KEY || '' });
});

app.post('/api/settings/apikey', (req, res) => {
    const { apikey } = req.body;
    if (apikey !== undefined) {
        process.env.HYPIXEL_API_KEY = apikey;
        const envPath = require('path').join(__dirname, '.env');
        try {
            let envContent = '';
            const fs = require('fs');
            if (fs.existsSync(envPath)) {
                envContent = fs.readFileSync(envPath, 'utf8');
                envContent = envContent.replace(/^HYPIXEL_API_KEY=.*$/m, `HYPIXEL_API_KEY=${apikey}`);
                if (!envContent.includes('HYPIXEL_API_KEY=')) envContent += `\nHYPIXEL_API_KEY=${apikey}`;
            } else {
                envContent = `HYPIXEL_API_KEY=${apikey}`;
            }
            fs.writeFileSync(envPath, envContent);
        } catch(e) {}
    }
    res.json({ success: true });
});

app.post('/api/settings/restart', (req, res) => {
    res.json({ success: true });
    setTimeout(() => process.exit(0), 1000);
});

app.get('/api/bazaar-live', async (req, res) => {
  res.json(await refreshRawBazaarCache());
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
                customData.forEach(recipeObj => {
                    flattenedRecipes.push(recipeObj);
                    if (!recipesByOutput[recipeObj.outputInternalId]) {
                        recipesByOutput[recipeObj.outputInternalId] = [];
                    }
                    recipesByOutput[recipeObj.outputInternalId].push(recipeObj);
                });
                console.log(`[SkyShards] Loaded ${customData.length} custom recipes from custom_recipes.json`);
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

    if (filterManipulated && inMode === 'insta-buy') {
        const spread = bz.quick_status.buyPrice / Math.max(1, bz.quick_status.sellPrice);
        if (spread > 1.5) return null;
    }

    const directCost = marketCostForQty(itemId, qtyNeeded, inMode);
    if (directCost === null) return null;

    let best = {
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
    };

    if (depth >= 5 || seen.has(itemId) || !recipesByOutput[itemId]) {
        memo.set(memoKey, best);
        return best;
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

    const candidate = rankedRecipes[0];
    if (!candidate) {
        memo.set(memoKey, best);
        return best;
    }

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

    if (valid && craftCost < directCost) {
        best = {
            cost: craftCost,
            rawMaterials,
            action: 'CRAFT',
            recipeUsed: candidate.recipe,
            runsNeeded: candidate.runsNeeded,
        };
    }

    memo.set(memoKey, best);
    return best;
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
        if (spread > 1.5) return null;
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
    const sortMode = req.query.sortMode || 'total'; // 'total' or 'absolute'
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
        
        // Anti-Manipulation: output spread filter only applies for insta-sell
        if (filterManipulated && outMode === 'insta-sell') {
            const outSpread = outBz.quick_status.buyPrice / Math.max(1, outBz.quick_status.sellPrice);
            if (outSpread > 1.5) return;
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

            if (filterManipulated && inMode === 'insta-buy') {
                const spread = inBz.quick_status.buyPrice / Math.max(1, inBz.quick_status.sellPrice);
                if (spread > 1.5) { allValid = false; break; }
            }

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

        const bzTaxRate = 0.0125; // 1.25% Hypixel Bazaar Sales Tax
        const netOutputPricePerShard = grossOutputPricePerShard * (1 - bzTaxRate);
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
        const netRevenuePerCraft   = grossOutputPricePerShard * effectiveYieldPerCraft * (1 - bzTaxRate);

        const grossProfitPerCraft = grossRevenuePerCraft - inputCostPerCraft;
        const netProfitPerCraft   = netRevenuePerCraft   - inputCostPerCraft;

        // Bot displays GROSS profit PER SHARD on the left (448.6K), NET on the right (85.2M)
        const grossProfitPerShard = grossProfitPerCraft / effectiveYieldPerCraft;
        const netProfitPerShard   = netProfitPerCraft / effectiveYieldPerCraft;

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
            marketSell: outBz.quick_status.sellPrice
        };

        const existing = bestByOutput.get(rec.outputInternalId);
        if (!existing || candidate[sortMode === 'absolute' ? 'absoluteProfit' : 'totalProfit'] > existing[sortMode === 'absolute' ? 'absoluteProfit' : 'totalProfit']) {
            bestByOutput.set(rec.outputInternalId, candidate);
        }
    });

    results = Array.from(bestByOutput.values())
        .sort((a, b) => sortMode === 'absolute' ? b.absoluteProfit - a.absoluteProfit : b.totalProfit - a.totalProfit)
        .slice(0, 50); // Top 50 profitable fusions

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
    const bzTaxRate = 0.0125;
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

        if (filterManipulated && outMode === 'insta-sell') {
            const outSpread = outBz.quick_status.buyPrice / Math.max(1, outBz.quick_status.sellPrice);
            if (outSpread > 1.5) return;
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

            if (filterManipulated && inMode === 'insta-buy') {
                const spread = inBz.quick_status.buyPrice / Math.max(1, inBz.quick_status.sellPrice);
                if (spread > 1.5) {
                    allValid = false;
                    return;
                }
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
        const netOutputPricePerCraft = grossOutputPricePerCraft * (1 - bzTaxRate);
        const inputCostPerCraft = totalInputCost + rec.fee;

        // Volume = 2-day safe sell window (matches reference bot: floor(buyMovingWeek / 48))
        const safeShardsSellable = Math.floor(outBz.quick_status.buyMovingWeek / 48);
        const maxVolume = uncapped ? Math.max(1, safeShardsSellable) : Math.max(1, Math.min(200, safeShardsSellable));

        // Bot profit model: profit per craft (no tax):
        const profitPerCraftRun = netOutputPricePerCraft - inputCostPerCraft;
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
        const trueNetRevenue = (isInstaSell ? walkBook(c.id, totalYield, false, fallbackOut) : fallbackOut * totalYield) * (1 - bzTaxRate);

        const profit = trueNetRevenue - trueInvestment;
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
    const maxNodes = 500;
    let nodeCount = 0;

    const getUnitPrice = (id) => {
        const bz = rawBazaarCache[id];
        if (!bz) return 0;
        return (inMode === 'buy-order') ? bz.quick_status.sellPrice : bz.quick_status.buyPrice;
    };

    const estimateRecipeDirectCost = (recipe, runsNeeded) => {
        return recipe.inputs.reduce((sum, inp) => {
            return sum + (getUnitPrice(inp.id) * inp.qty * runsNeeded);
        }, (recipe.fee || 0) * runsNeeded);
    };

    const buildBoundedRecipeTree = (id, qtyNeeded, depth, seen = new Set()) => {
        nodeCount++;
        const prettyName = id.replace('SHARD_', '').replace(/_/g, ' ');
        const directUnitPrice = getUnitPrice(id);
        const directCost = directUnitPrice * qtyNeeded;
        const recipes = recipesByOutput[id] || [];

        if (depth >= maxDepth || nodeCount >= maxNodes || seen.has(id) || recipes.length === 0) {
            return {
                id,
                name: prettyName,
                qty: qtyNeeded,
                qtyNeeded,
                action: 'BUY',
                unitPrice: directUnitPrice,
                totalCost: directCost,
                children: [],
                capped: depth >= maxDepth || nodeCount >= maxNodes,
                cycle: seen.has(id),
                stopReason: seen.has(id) ? 'cycle' : (depth >= maxDepth ? 'max-depth' : (nodeCount >= maxNodes ? 'node-limit' : 'no-recipe')),
            };
        }

        const nextSeen = new Set(seen);
        nextSeen.add(id);
        const rankedRecipes = recipes
            .map((recipe) => {
                const runsNeeded = Math.ceil(qtyNeeded / recipe.qtyYielded);
                return {
                    recipe,
                    runsNeeded,
                    producedQty: runsNeeded * recipe.qtyYielded,
                    estimatedCost: estimateRecipeDirectCost(recipe, runsNeeded),
                };
            })
            .sort((a, b) => a.estimatedCost - b.estimatedCost);

        const bestDirectRecipe = rankedRecipes[0];
        let bestCraft = null;

        if (bestDirectRecipe) {
            const children = bestDirectRecipe.recipe.inputs.map((inp) => {
                const childQty = inp.qty * bestDirectRecipe.runsNeeded;
                const child = buildBoundedRecipeTree(inp.id, childQty, depth + 1, nextSeen);
                child.name = inp.name || child.name;
                return child;
            });
            const craftCost = children.reduce((sum, child) => sum + child.totalCost, (bestDirectRecipe.recipe.fee || 0) * bestDirectRecipe.runsNeeded);
            bestCraft = {
                recipe: bestDirectRecipe.recipe,
                runsNeeded: bestDirectRecipe.runsNeeded,
                producedQty: bestDirectRecipe.producedQty,
                totalCost: craftCost,
                children,
                estimatedCost: bestDirectRecipe.estimatedCost,
            };
        }

        if (!bestCraft || bestCraft.totalCost >= directCost) {
            return {
                id,
                name: prettyName,
                qty: qtyNeeded,
                qtyNeeded,
                action: 'BUY',
                unitPrice: directUnitPrice,
                totalCost: directCost,
                children: [],
                directBuyCost: directCost,
                bestCraftCost: bestCraft ? bestCraft.totalCost : null,
                alternativesChecked: rankedRecipes.length,
                stopReason: bestCraft ? 'direct-buy-cheaper' : 'no-valid-craft',
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
    const directBuy = directUnitPrice * targetQty;
    const tree = buildBoundedRecipeTree(itemId, targetQty, 0);

    res.json({
        tree,
        directBuyCost: directBuy,
        savings: directBuy - tree.totalCost,
        savingsPercent: directBuy > 0 ? ((directBuy - tree.totalCost) / directBuy * 100).toFixed(1) : 0,
        nodeCount,
        maxDepth,
        capped: nodeCount >= maxNodes,
    });
});

let moulberryCache = {};
let moulberryLastFetch = 0;

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
      await db.updateBazaar(res.data.products);
      console.log(`[${new Date().toLocaleTimeString()}] Updated Bazaar data`);
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
    // Only fetch first few pages to save rate limit and time (Pages 0, 1, 2)
    const pagesToFetch = [0, 1, 2];
    for (const page of pagesToFetch) {
      const url = `https://api.hypixel.net/v2/skyblock/auctions?page=${page}`;
      // In a real prod with a key, pass it as a header "API-Key"
      const res = await timedGet(url);
      if (res.data.success && res.data.auctions) {
        await db.updateAuctions(res.data.auctions);
      }
    }
    console.log(`[${new Date().toLocaleTimeString()}] Updated Auctions data`);
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
      await db.updateItems(res.data.items);
      console.log(`[${new Date().toLocaleTimeString()}] Updated Items data with NPC prices`);
    }
  } catch (error) {
    console.error('Error polling Items:', error.message);
  } finally {
    isPollingItems = false;
  }
}

// 1 minute interval for Hypixel rate limit safety (300 req / 5 mins limit = 60 req/min limit)
setInterval(pollBazaar, 60000); 
setInterval(pollAuctions, 60000); 
// 1 hour interval for static items
setInterval(pollItems, 3600000);

// Initial poll on startup
pollBazaar();
pollAuctions();
pollItems();

app.listen(port, () => {
  console.log(`Backend server running on http://localhost:${port}`);
});
