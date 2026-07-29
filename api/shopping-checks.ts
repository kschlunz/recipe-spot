// api/shopping-checks.ts — the shared "ticked off" state for the shopping list.
// A checked item is stored by its normalized name key, so both people in the
// household see the same checkmarks while shopping.
//
//   GET    /api/shopping-checks              → { checked: string[] }
//   POST   /api/shopping-checks  { key }     → tick one item
//   DELETE /api/shopping-checks?key=milk     → untick one item
//   DELETE /api/shopping-checks?all=1        → untick everything

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

function client(res: VercelResponse): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    res.status(500).json({ error: 'Supabase not configured' });
    return null;
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

const norm = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabase = client(res);
  if (!supabase) return;

  if (req.method === 'GET') {
    const { data, error } = await supabase.from('shopping_checked').select('item_key');
    if (error) return res.status(500).json({ error: error.message });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ checked: (data ?? []).map((r: any) => r.item_key) });
  }

  if (req.method === 'POST') {
    const key = norm((req.body ?? {}).key);
    if (!key) return res.status(400).json({ error: 'Provide an item key.' });
    const { error } = await supabase
      .from('shopping_checked')
      .upsert({ item_key: key }, { onConflict: 'item_key' });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    if (req.query.all) {
      const { error } = await supabase.from('shopping_checked').delete().neq('item_key', '');
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    const key = norm(req.query.key);
    if (!key) return res.status(400).json({ error: 'Provide ?key=… or ?all=1.' });
    const { error } = await supabase.from('shopping_checked').delete().eq('item_key', key);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
