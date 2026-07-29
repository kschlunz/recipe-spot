// api/shopping.ts — roll up ingredients from the week's planned recipes into a
// deduped, serving-scaled shopping list. GET only.
//
//   GET /api/shopping → { items: [{ name, note, amounts:[{q,u}], toTaste, sources }], recipes }
//
// Grouping: one line per ingredient NAME. Quantities are summed per unit, so
// "1 cup" + "1 cup" → "2 cup", while mismatched units stay side by side
// ("1 cup + 200 g") rather than being force-converted. Each planned day is
// scaled by its chosen servings ÷ the recipe's own serves. A recipe planned on
// two days is counted twice. "To taste" / garnish items (no quantity) are
// flagged once.

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

type Group = {
  name: string;
  note: string;
  units: Map<string, number>; // unit → summed quantity
  toTaste: boolean;
  sources: Set<string>;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const supabase = client(res);
  if (!supabase) return;

  const { data: rows, error } = await supabase.from('meal_plan').select('recipe_slug, servings');
  if (error) return res.status(500).json({ error: error.message });

  const planned = (rows ?? []).filter((r: any) => r.recipe_slug);
  if (planned.length === 0) return res.status(200).json({ items: [], recipes: [] });

  const slugs = [...new Set(planned.map((r: any) => r.recipe_slug))];
  const { data: recipes, error: rErr } = await supabase
    .from('recipes')
    .select('slug, title, data')
    .in('slug', slugs);
  if (rErr) return res.status(500).json({ error: rErr.message });

  const bySlug = new Map<string, any>();
  (recipes ?? []).forEach((r: any) => bySlug.set(r.slug, r));

  const groups = new Map<string, Group>();
  const recipeTitles = new Set<string>();

  for (const row of planned) {
    const r = bySlug.get((row as any).recipe_slug);
    if (!r) continue;
    const title = r.title as string;
    recipeTitles.add(title);

    const base = Number(r.data?.serves) || 0;
    const target = (row as any).servings ? Number((row as any).servings) : 0;
    const scale = base && target ? target / base : 1;

    for (const g of (r.data?.ingredients ?? []) as any[]) {
      const name = String(g.name ?? '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      let grp = groups.get(key);
      if (!grp) {
        grp = { name, note: g.note ?? '', units: new Map(), toTaste: false, sources: new Set() };
        groups.set(key, grp);
      }
      grp.sources.add(title);
      if (!grp.note && g.note) grp.note = g.note;
      if (g.us && g.us.q) {
        const u = String(g.us.u ?? '');
        grp.units.set(u, (grp.units.get(u) ?? 0) + Number(g.us.q) * scale);
      } else {
        grp.toTaste = true;
      }
    }
  }

  const items = [...groups.values()]
    .map((grp) => ({
      name: grp.name,
      note: grp.note,
      amounts: [...grp.units.entries()].map(([u, q]) => ({ q, u })),
      toTaste: grp.toTaste,
      sources: [...grp.sources],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ items, recipes: [...recipeTitles] });
}
