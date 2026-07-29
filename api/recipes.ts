// api/recipes.ts — CRUD for recipes against Supabase, through the service-role
// key (RLS stays on with no public policies, so all access flows through here).
//
//   GET  /api/recipes            → list of card summaries
//   GET  /api/recipes?slug=foo   → one full recipe row
//   POST /api/recipes            → { recipe, source_url?, tags? } → { slug }
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (falls back to VITE_SUPABASE_ANON_KEY)

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

function slugify(title: string): string {
  return (
    String(title)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'recipe'
  );
}

async function uniqueSlug(supabase: SupabaseClient, base: string): Promise<string> {
  let slug = base;
  for (let n = 2; n < 1000; n++) {
    const { data, error } = await supabase.from('recipes').select('slug').eq('slug', slug).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return slug;
    slug = `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabase = client(res);
  if (!supabase) return;

  if (req.method === 'GET') {
    const slug = typeof req.query.slug === 'string' ? req.query.slug : '';

    if (slug) {
      const { data, error } = await supabase
        .from('recipes')
        .select('slug, title, data, source_url, tags, created_at, updated_at')
        .eq('slug', slug)
        .maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (!data) return res.status(404).json({ error: 'Recipe not found' });
      res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
      return res.status(200).json({ recipe: data });
    }

    const { data, error } = await supabase
      .from('recipes')
      .select('slug, title, data, tags')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });

    const recipes = (data ?? []).map((row: any) => ({
      slug: row.slug,
      title: row.title,
      eyebrow: row.data?.eyebrow ?? '',
      tagline: row.data?.tagline ?? '',
      tags: row.tags ?? [],
    }));
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    return res.status(200).json({ total: recipes.length, recipes });
  }

  if (req.method === 'POST') {
    const { recipe, source_url, tags } = req.body ?? {};
    if (!recipe || !recipe.title || !Array.isArray(recipe.ingredients) || !Array.isArray(recipe.steps)) {
      return res.status(400).json({ error: 'Provide a valid recipe with title, ingredients, and steps.' });
    }

    try {
      const slug = await uniqueSlug(supabase, slugify(recipe.title));
      const { error } = await supabase.from('recipes').insert({
        slug,
        title: recipe.title,
        data: recipe,
        source_url: source_url ?? null,
        tags: Array.isArray(tags) ? tags : [],
      });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json({ slug });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'PATCH') {
    const { slug, recipe, tags } = req.body ?? {};
    if (!slug || !recipe || !recipe.title || !Array.isArray(recipe.ingredients) || !Array.isArray(recipe.steps)) {
      return res.status(400).json({ error: 'Provide slug and a valid recipe with title, ingredients, and steps.' });
    }
    const update: Record<string, unknown> = { data: recipe, title: recipe.title };
    if (Array.isArray(tags)) update.tags = tags;
    const { error } = await supabase.from('recipes').update(update).eq('slug', slug);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, slug });
  }

  if (req.method === 'DELETE') {
    const slug = typeof req.query.slug === 'string' ? req.query.slug : '';
    if (!slug) return res.status(400).json({ error: 'Provide ?slug=.' });
    // meal_plan rows referencing this recipe are removed via ON DELETE CASCADE.
    const { error } = await supabase.from('recipes').delete().eq('slug', slug);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
