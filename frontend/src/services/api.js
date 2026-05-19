export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api').replace(/\/$/, '');

export const fetchBazaar = async () => {
  const res = await fetch(`${API_URL}/bazaar`);
  if (!res.ok) throw new Error('Fetch failed');
  return res.json();
};

export const fetchAuctions = async () => {
  const res = await fetch(`${API_URL}/auctions`);
  if (!res.ok) throw new Error('Fetch failed');
  return res.json();
};

export const fetchSkyCoflHistory = async (itemId) => {
  const res = await fetch(`${API_URL}/skycofl-fetch/${encodeURIComponent(itemId)}`);
  if (!res.ok) throw new Error('Fetch failed');
  return res.json();
};

export const fetchAccessoryFlips = async (params = {}) => {
  const query = new URLSearchParams(params);
  const res = await fetch(`${API_URL}/accessory-flips?${query.toString()}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.details || body.error || 'Fetch failed');
  }
  return res.json();
};

export const fetchForgeFlips = async (params = {}) => {
  const query = new URLSearchParams(params);
  const res = await fetch(`${API_URL}/forge-flips?${query.toString()}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.details || body.error || 'Fetch failed');
  }
  return res.json();
};
