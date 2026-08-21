// api/meal-plan.ts — the weekly meal plan. Each day can hold a free-text note
// plus any number of recipes (dinner + a dessert). Persistent until cleared.
// Everything flows through the service-role key like the rest of the API.
//
//   GET    /api/meal-plan                          → { plan: { mon: {recipes:[…], note}, … } }
//   POST   /api/meal-plan  { day, add: slug }       → add a recipe to a day  → { id }
//   POST   /api/meal-plan  { item_id, servings }    → set one dish's servings
//   POST   /api/meal-plan  { day, note }            → set a day's note
//   DELETE /api/meal-plan?item=<id>                 → remove one dish
//   DELETE /api/meal-plan?day=wed                   → clear one day (recipes + note)
//   DELETE /api/meal-plan?all=1                     → clear the whole week

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
type DayKey = (typeof DAYS)[number];
const isDay = (d: unknown): d is DayKey => typeof d === 'string' && (DAYS as readonly string[]).includes(d);

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
    type Recipe = {
      id: string;
      slug: string;
      title: string;
      eyebrow?: string;
      tagline?: string;
      serves?: number;
      servings: number | null;
      calories?: number | null;
      cost?: number | null;
      cookedOn?: string | null;
    };
    type Entry = { recipes: Recipe[]; note: string };
    const plan: Record<string, Entry> = {};
    DAYS.forEach((d) => (plan[d] = { recipes: [], note: '' }));

    // Notes live on meal_plan (one row per day).
    const { data: noteRows, error: nErr } = await supabase.from('meal_plan').select('day, note');
    if (nErr) return res.status(500).json({ error: nErr.message });
    for (const row of noteRows ?? []) {
      const entry = plan[(row as any).day];
      if (entry) entry.note = (row as any).note ?? '';
    }

    // Recipes live on meal_plan_recipes (many rows per day).
    const { data: rows, error } = await supabase
      .from('meal_plan_recipes')
      .select('id, day, recipe_slug, servings, position, created_at')
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });

    // Which planned dishes are checked off as cooked (by meal_plan_recipes id).
    // Resilient: if the cook_log table isn't there yet, just treat none as cooked.
    const itemIds = [...new Set((rows ?? []).map((r: any) => r.id))];
    const cookedByItem = new Map<string, string>();
    if (itemIds.length > 0) {
      const { data: logRows } = await supabase
        .from('cook_log')
        .select('item_id, cooked_on')
        .in('item_id', itemIds);
      for (const lr of logRows ?? []) {
        const iid = (lr as any).item_id;
        if (iid) cookedByItem.set(iid, (lr as any).cooked_on);
      }
    }

    const slugs = [...new Set((rows ?? []).map((r: any) => r.recipe_slug))];
    const bySlug = new Map<string, any>();
    if (slugs.length > 0) {
      // Try to include nutrition for day-card calories; fall back if the column
      // isn't there yet.
      let recipesData: any[] | null = null;
      let rErr: any = null;
      ({ data: recipesData, error: rErr } = await supabase
        .from('recipes')
        .select('slug, title, data, nutrition, cost')
        .in('slug', slugs));
      if (rErr) {
        // nutrition and/or cost column not there yet — fall back to the base set.
        ({ data: recipesData, error: rErr } = await supabase
          .from('recipes')
          .select('slug, title, data')
          .in('slug', slugs));
      }
      if (rErr) return res.status(500).json({ error: rErr.message });
      (recipesData ?? []).forEach((r: any) => bySlug.set(r.slug, r));
    }

    for (const row of rows ?? []) {
      const entry = plan[(row as any).day];
      if (!entry) continue;
      const r = bySlug.get((row as any).recipe_slug);
      if (!r) continue; // recipe was deleted; skip the orphan
      entry.recipes.push({
        id: (row as any).id,
        slug: r.slug,
        title: r.title,
        eyebrow: r.data?.eyebrow ?? '',
        tagline: r.data?.tagline ?? '',
        serves: Number(r.data?.serves) || undefined,
        servings: (row as any).servings ?? null,
        calories: Number(r.nutrition?.calories) || null,
        cost: Number(r.cost) || null,
        cookedOn: cookedByItem.get((row as any).id) ?? null,
      });
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ plan });
  }

  if (req.method === 'POST') {
    const body = req.body ?? {};

    // Add a recipe to a day.
    if ('add' in body) {
      const day = body.day;
      const slug = typeof body.add === 'string' ? body.add : '';
      if (!isDay(day) || !slug) {
        return res.status(400).json({ error: 'Provide a valid day and recipe slug.' });
      }
      // Append after any existing dishes on that day.
      const { data: existing } = await supabase
        .from('meal_plan_recipes')
        .select('position')
        .eq('day', day)
        .order('position', { ascending: false })
        .limit(1);
      const position = ((existing?.[0] as any)?.position ?? -1) + 1;
      const { data: inserted, error } = await supabase
        .from('meal_plan_recipes')
        .insert({ day, recipe_slug: slug, position })
        .select('id')
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ id: (inserted as any).id });
    }

    // Move a dish to another day (drag-and-drop). Appends to the end of the
    // target day so the moved dish lands last.
    if ('item_id' in body && isDay(body.day)) {
      const id = typeof body.item_id === 'string' ? body.item_id : '';
      if (!id) return res.status(400).json({ error: 'Provide a valid item_id.' });
      const day = body.day;
      const { data: existing } = await supabase
        .from('meal_plan_recipes')
        .select('position')
        .eq('day', day)
        .order('position', { ascending: false })
        .limit(1);
      const position = ((existing?.[0] as any)?.position ?? -1) + 1;
      const { error } = await supabase.from('meal_plan_recipes').update({ day, position }).eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    // Set one dish's servings.
    if ('item_id' in body) {
      const id = typeof body.item_id === 'string' ? body.item_id : '';
      if (!id) return res.status(400).json({ error: 'Provide a valid item_id.' });
      const servings =
        body.servings == null ? null : Math.max(1, Math.round(Number(body.servings) || 0)) || null;
      const { error } = await supabase.from('meal_plan_recipes').update({ servings }).eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    // Set a day's note.
    if ('note' in body) {
      const day = body.day;
      if (!isDay(day)) return res.status(400).json({ error: 'Provide a valid day (mon–sun).' });
      const note = typeof body.note === 'string' ? body.note.trim() : '';
      if (!note) {
        const { error } = await supabase.from('meal_plan').delete().eq('day', day);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ ok: true });
      }
      const { error } = await supabase
        .from('meal_plan')
        .upsert({ day, note, updated_at: new Date().toISOString() }, { onConflict: 'day' });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Nothing to do — send add, item_id, or note.' });
  }

  if (req.method === 'DELETE') {
    const all = req.query.all;
    const item = typeof req.query.item === 'string' ? req.query.item : '';
    const day = typeof req.query.day === 'string' ? req.query.day : '';

    if (all) {
      const { error: e1 } = await supabase.from('meal_plan_recipes').delete().in('day', [...DAYS]);
      const { error: e2 } = await supabase.from('meal_plan').delete().in('day', [...DAYS]);
      const error = e1 || e2;
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    if (item) {
      const { error } = await supabase.from('meal_plan_recipes').delete().eq('id', item);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    if (isDay(day)) {
      const { error: e1 } = await supabase.from('meal_plan_recipes').delete().eq('day', day);
      const { error: e2 } = await supabase.from('meal_plan').delete().eq('day', day);
      const error = e1 || e2;
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'Provide ?item=<id>, ?day=mon–sun, or ?all=1.' });
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
