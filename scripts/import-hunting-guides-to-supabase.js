const fs = require('fs');
const path = require('path');
module.paths.push(path.join(__dirname, '..', 'backend', 'node_modules'));
require('dotenv').config({ path: path.join(__dirname, '..', 'backend', '.env') });
require('dotenv').config({ path: path.join(__dirname, '.env.render.local') });

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const guidesPath = path.join(__dirname, '..', 'backend', 'hunting_guides.json');

function decodeJwtPayload(token) {
  try {
    const [, payload] = String(token || '').split('.');
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in backend/.env or scripts/.env.render.local');
  process.exit(1);
}

const keyPayload = decodeJwtPayload(supabaseKey);
if (keyPayload?.role && keyPayload.role !== 'service_role') {
  console.error(`SUPABASE_SERVICE_KEY is using role "${keyPayload.role}", but this import needs the secret service_role key.`);
  console.error('In Supabase, go to Project Settings -> API -> Project API keys -> service_role secret, then put that value in backend/.env as SUPABASE_SERVICE_KEY.');
  process.exit(1);
}

if (!fs.existsSync(guidesPath)) {
  console.error(`Missing guide file: ${guidesPath}`);
  process.exit(1);
}

const guides = JSON.parse(fs.readFileSync(guidesPath, 'utf8'));
if (!Array.isArray(guides)) {
  console.error('hunting_guides.json must contain an array');
  process.exit(1);
}

const rows = guides.map((guide) => ({
  id: guide.id,
  data: guide,
  created_at: Number(guide.createdAt || Date.now()),
  updated_at: Number(guide.updatedAt || Date.now()),
}));

const supabase = createClient(supabaseUrl, supabaseKey);

(async () => {
  const { error } = await supabase
    .from('hunting_guides')
    .upsert(rows, { onConflict: 'id' });

  if (error) {
    console.error('Failed to import hunting guides:', error.message);
    if (/row-level security|RLS/i.test(error.message)) {
      console.error('This usually means SUPABASE_SERVICE_KEY is the public anon key instead of the secret service_role key.');
      console.error('Replace SUPABASE_SERVICE_KEY with the service_role secret key, then rerun this script.');
    }
    console.error('Make sure scripts/supabase-hunting-guides.sql has been run in Supabase SQL Editor first.');
    process.exit(1);
  }

  console.log(`Imported ${rows.length} hunting guide${rows.length === 1 ? '' : 's'} to Supabase.`);
})();
