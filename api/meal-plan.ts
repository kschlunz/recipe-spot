// api/meal-plan.ts — the weekly meal plan (one recipe per day, persistent until
// cleared), through the service-role key like the rest of the API.
//
//   GET    /api/meal-plan            → { plan: { mon: {...}|null, ... } }
//   POST   /api/meal-plan            → { day, recipe_slug }  (assign/replace)
//   DELETE /api/meal-plan?day=wed    → clear one day
//   DELETE /api/meal-plan?all=1      → clear the whole week

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

function client(res: VercelResponse): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    res.status(500).json({ error: 'Supabase not configured' });
    return null;
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabase = client(res);
  if (!supabase) return;

  if (req.method === 'GET') {
    const plan: Record<string, { slug: string; title: string; eyebrow?: string; tagline?: string } | null> = {};
    DAYS.forEach((d) => (plan[d] = null));

    const { data: rows, error } = await supabase.from('meal_plan').select('day, recipe_slug');
    if (error) return res.status(500).json({ error: error.message });

    const slugs = [...new Set((rows ?? []).map((r: any) => r.recipe_slug))];
    if (slugs.length > 0) {
      const { data: recipes, error: rErr } = await supabase
        .from('recipes')
        .select('slug, title, data')
        .in('slug', slugs);
      if (rErr) return res.status(500).json({ error: rErr.message });

      const bySlug = new Map<string, any>();
      (recipes ?? []).forEach((r: any) => bySlug.set(r.slug, r));
      for (const row of rows ?? []) {
        const r = bySlug.get((row as any).recipe_slug);
        if (r) {
          plan[(row as any).day] = {
            slug: r.slug,
            title: r.title,
            eyebrow: r.data?.eyebrow ?? '',
            tagline: r.data?.tagline ?? '',
          };
        }
      }
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ plan });
  }

  if (req.method === 'POST') {
    const { day, recipe_slug } = req.body ?? {};
    if (!DAYS.includes(day) || !recipe_slug) {
      return res.status(400).json({ error: 'Provide a valid day (mon–sun) and recipe_slug.' });
    }
    const { error } = await supabase
      .from('meal_plan')
      .upsert({ day, recipe_slug, updated_at: new Date().toISOString() }, { onConflict: 'day' });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const all = req.query.all;
    const day = typeof req.query.day === 'string' ? req.query.day : '';

    if (all) {
      const { error } = await supabase.from('meal_plan').delete().in('day', [...DAYS]);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    if (DAYS.includes(day as (typeof DAYS)[number])) {
      const { error } = await supabase.from('meal_plan').delete().eq('day', day);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'Provide ?day=mon–sun or ?all=1.' });
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
