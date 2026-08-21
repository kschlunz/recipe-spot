// api/cook-log.ts — the cooking log: a running history of meals actually
// cooked, checked off from the weekly plan. Separate from favorites, and
// persistent (survives clearing the week or deleting the recipe).
//
//   GET    /api/cook-log                      → { log: [{ id, slug, title, cookedOn, day }], count }
//   POST   /api/cook-log  { slug, title?, item_id?, day?, cooked_on? } → { id, cookedOn }
//   DELETE /api/cook-log?item=<item_id>       → un-check: remove log rows for a planned item
//   DELETE /api/cook-log?id=<log_id>          → remove one history entry
//
// Everything flows through the service-role key like the rest of the API.

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

// A valid YYYY-MM-DD date string, or undefined.
function cleanDate(v: unknown): string | undefined {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabase = client(res);
  if (!supabase) return;

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('cook_log')
      .select('id, recipe_slug, title, cooked_on, day')
      .order('cooked_on', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    const log = (data ?? []).map((r: any) => ({
      id: r.id,
      slug: r.recipe_slug,
      title: r.title ?? r.recipe_slug,
      cookedOn: r.cooked_on,
      day: r.day ?? null,
    }));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ log, count: log.length });
  }

  if (req.method === 'POST') {
    const body = req.body ?? {};
    const slug = typeof body.slug === 'string' ? body.slug : '';
    if (!slug) return res.status(400).json({ error: 'Provide a recipe slug.' });
    const row: Record<string, unknown> = {
      recipe_slug: slug,
      title: typeof body.title === 'string' && body.title ? body.title : null,
      item_id: typeof body.item_id === 'string' && body.item_id ? body.item_id : null,
      day: typeof body.day === 'string' && body.day ? body.day : null,
    };
    const cooked = cleanDate(body.cooked_on);
    if (cooked) row.cooked_on = cooked; // else the column default (today, UTC) applies
    const { data, error } = await supabase
      .from('cook_log')
      .insert(row)
      .select('id, cooked_on')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ id: (data as any).id, cookedOn: (data as any).cooked_on });
  }

  if (req.method === 'DELETE') {
    const item = typeof req.query.item === 'string' ? req.query.item : '';
    const id = typeof req.query.id === 'string' ? req.query.id : '';
    if (item) {
      const { error } = await supabase.from('cook_log').delete().eq('item_id', item);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    if (id) {
      const { error } = await supabase.from('cook_log').delete().eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'Provide ?item=<id> or ?id=<log id>.' });
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
