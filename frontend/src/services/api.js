const API_URL = 'http://localhost:3000/api';

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
