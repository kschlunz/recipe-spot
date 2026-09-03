// api/trip.ts — the trip planner: a standalone week away (Saturday–Saturday, 8
// day slots) with meals per day, who's responsible for each, and a shared notes
// field. A single persistent board, like the weekly meal plan. Everything flows
// through the service-role key like the rest of the API.
//
//   GET    /api/trip                                   → { info:{title,startDate,notes}, meals:[…] }
//   POST   /api/trip  { title?|start_date?|notes? }     → update the trip info (any subset)
//   POST   /api/trip  { day_index, meal?, who? }         → add a meal to a day → { id }
//   POST   /api/trip  { meal_id, meal?, who? }           → edit a meal
//   DELETE /api/trip?meal=<id>                           → remove one meal
//   DELETE /api/trip?all=1                               → clear all meals

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

const cleanDate = (v: unknown): string | null =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabase = client(res);
  if (!supabase) return;

  if (req.method === 'GET') {
    const { data: info } = await supabase
      .from('trip_info')
      .select('title, start_date, notes')
      .eq('id', 1)
      .maybeSingle();
    const { data: meals, error } = await supabase
      .from('trip_meals')
      .select('id, day_index, meal, who, position, created_at')
      .order('day_index', { ascending: true })
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) {
      // Tables not created yet — respond gracefully so the page still loads and
      // can point the user at the one-time database setup.
      if (/does not exist/i.test(error.message)) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
          info: { title: '', startDate: null, notes: '' },
          meals: [],
          needsSetup: true,
        });
      }
      return res.status(500).json({ error: error.message });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      info: {
        title: (info as any)?.title ?? '',
        startDate: (info as any)?.start_date ?? null,
        notes: (info as any)?.notes ?? '',
      },
      meals: (meals ?? []).map((m: any) => ({
        id: m.id,
        dayIndex: m.day_index,
        meal: m.meal ?? '',
        who: m.who ?? '',
      })),
    });
  }

  if (req.method === 'POST') {
    const body = req.body ?? {};

    // Edit an existing meal.
    if ('meal_id' in body) {
      const id = typeof body.meal_id === 'string' ? body.meal_id : '';
      if (!id) return res.status(400).json({ error: 'Provide a valid meal_id.' });
      const update: Record<string, unknown> = {};
      if ('meal' in body) update.meal = typeof body.meal === 'string' ? body.meal : '';
      if ('who' in body) update.who = typeof body.who === 'string' ? body.who : '';
      if (Object.keys(update).length === 0) return res.status(400).json({ error: 'Nothing to update.' });
      const { error } = await supabase.from('trip_meals').update(update).eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    // Add a meal to a day.
    if ('day_index' in body) {
      const day = Number(body.day_index);
      if (!Number.isInteger(day) || day < 0 || day > 7) {
        return res.status(400).json({ error: 'Provide a day_index between 0 and 7.' });
      }
      const { data: existing } = await supabase
        .from('trip_meals')
        .select('position')
        .eq('day_index', day)
        .order('position', { ascending: false })
        .limit(1);
      const position = ((existing?.[0] as any)?.position ?? -1) + 1;
      const { data: inserted, error } = await supabase
        .from('trip_meals')
        .insert({
          day_index: day,
          meal: typeof body.meal === 'string' ? body.meal : '',
          who: typeof body.who === 'string' ? body.who : '',
          position,
        })
        .select('id')
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ id: (inserted as any).id });
    }

    // Otherwise: update the trip info (any subset of title / start_date / notes).
    const info: Record<string, unknown> = { id: 1, updated_at: new Date().toISOString() };
    if ('title' in body) info.title = typeof body.title === 'string' ? body.title : '';
    if ('notes' in body) info.notes = typeof body.notes === 'string' ? body.notes : '';
    if ('start_date' in body) info.start_date = cleanDate(body.start_date);
    if (Object.keys(info).length <= 2) return res.status(400).json({ error: 'Nothing to update.' });
    const { error } = await supabase.from('trip_info').upsert(info, { onConflict: 'id' });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const meal = typeof req.query.meal === 'string' ? req.query.meal : '';
    const all = req.query.all;
    if (all) {
      const { error } = await supabase.from('trip_meals').delete().gte('day_index', 0);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    if (meal) {
      const { error } = await supabase.from('trip_meals').delete().eq('id', meal);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'Provide ?meal=<id> or ?all=1.' });
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
