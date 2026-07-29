// api/cook-notes.ts — the per-recipe cooking log, through the service-role key.
//
//   GET    /api/cook-notes?slug=the-stew   → { notes: [{ id, body, created_at }] }
//   POST   /api/cook-notes  { slug, body } → { note }
//   DELETE /api/cook-notes?id=...          → { ok }

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabase = client(res);
  if (!supabase) return;

  if (req.method === 'GET') {
    const slug = typeof req.query.slug === 'string' ? req.query.slug : '';
    if (!slug) return res.status(400).json({ error: 'Provide ?slug=.' });
    const { data, error } = await supabase
      .from('cook_notes')
      .select('id, body, created_at')
      .eq('recipe_slug', slug)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ notes: data ?? [] });
  }

  if (req.method === 'POST') {
    const { slug, body } = req.body ?? {};
    const text = typeof body === 'string' ? body.trim() : '';
    if (!slug || !text) return res.status(400).json({ error: 'Provide slug and a non-empty body.' });
    const { data, error } = await supabase
      .from('cook_notes')
      .insert({ recipe_slug: slug, body: text })
      .select('id, body, created_at')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ note: data });
  }

  if (req.method === 'DELETE') {
    const id = typeof req.query.id === 'string' ? req.query.id : '';
    if (!id) return res.status(400).json({ error: 'Provide ?id=.' });
    const { error } = await supabase.from('cook_notes').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
