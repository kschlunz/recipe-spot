// api/shopping.ts — roll up ingredients from the week's planned recipes into a
// deduped shopping list. GET only.
//
//   GET /api/shopping → { items: [{ name, note, us, sources }], recipes: [titles] }
//
// Same US quantities the recipes carry (no serving-scaling yet). Identical
// name+unit lines are summed; everything else is listed separately, tagged with
// the recipes it came from. "To taste" / garnish items (no quantity) list once.

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

type Item = {
  name: string;
  note: string;
  us: { q: number; u: string } | null;
  sources: string[];
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const supabase = client(res);
  if (!supabase) return;

  const { data: rows, error } = await supabase.from('meal_plan').select('recipe_slug');
  if (error) return res.status(500).json({ error: error.message });

  const slugs = [...new Set((rows ?? []).filter((r: any) => r.recipe_slug).map((r: any) => r.recipe_slug))];
  if (slugs.length === 0) return res.status(200).json({ items: [], recipes: [] });

  const { data: recipes, error: rErr } = await supabase
    .from('recipes')
    .select('title, data')
    .in('slug', slugs);
  if (rErr) return res.status(500).json({ error: rErr.message });

  const map = new Map<string, Item>();
  const recipeTitles: string[] = [];

  for (const row of recipes ?? []) {
    const title = (row as any).title as string;
    recipeTitles.push(title);
    const ings = ((row as any).data?.ingredients ?? []) as any[];
    for (const g of ings) {
      const name = String(g.name ?? '').trim();
      if (!name) continue;
      const us = g.us && g.us.q ? { q: Number(g.us.q), u: String(g.us.u ?? '') } : null;
      const key = name.toLowerCase() + '|' + (us ? us.u.toLowerCase() : '');
      const existing = map.get(key);
      if (existing) {
        if (us && existing.us) existing.us.q += us.q;
        if (!existing.sources.includes(title)) existing.sources.push(title);
      } else {
        map.set(key, { name, note: g.note ?? '', us, sources: [title] });
      }
    }
  }

  const items = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ items, recipes: recipeTitles });
}
