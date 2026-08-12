// api/cook-from.ts — "In the Fridge": given the ingredients a cook has on hand,
// rank their saved recipes by what they can mostly make now, with what they'd
// still need to buy. Claude does the matching so equivalents count
// ("chicken" ↔ "chicken thighs", "tomato" ↔ "cherry tomatoes").
//
//   POST /api/cook-from  { have: string[] }
//     → { matches: [{ slug, title, eyebrow, photoUrl, uses:[…], missing:[…] }] }

import Anthropic from '@anthropic-ai/sdk';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { maxDuration: 30 };

const anthropic = new Anthropic();
const MODEL = 'claude-haiku-4-5';

function client(res: VercelResponse): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    res.status(500).json({ error: 'Supabase not configured' });
    return null;
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

const ingNames = (r: any): string[] =>
  ((r?.data?.ingredients ?? []) as any[]).map((g) => String(g?.name ?? '').trim()).filter(Boolean);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Ingredient matching is not configured.' });
  }

  const have: string[] = Array.isArray((req.body ?? {}).have)
    ? (req.body.have as any[]).map((s) => String(s).trim()).filter(Boolean).slice(0, 40)
    : [];
  if (have.length === 0) return res.status(400).json({ error: 'Tell me what you have first.' });

  const supabase = client(res);
  if (!supabase) return;

  // Try to include the photo for result cards; fall back if not selectable.
  let recipes: any[] | null = null;
  let error: any = null;
  ({ data: recipes, error } = await supabase.from('recipes').select('slug, title, data, photo_url'));
  if (error) ({ data: recipes, error } = await supabase.from('recipes').select('slug, title, data'));
  if (error) return res.status(500).json({ error: error.message });
  if (!recipes || recipes.length === 0) {
    return res.status(200).json({ matches: [], note: 'No saved recipes yet — import a few first.' });
  }

  const bySlug = new Map(recipes.map((r: any) => [r.slug, r]));
  const list = recipes
    .map((r: any) => `slug: ${r.slug}\n  title: ${r.title}\n  ingredients: ${ingNames(r).join(', ')}`)
    .join('\n');

  let matches: Array<{ slug: string; uses: string[]; missing: string[] }> = [];
  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1200,
      system:
        "You match a cook's on-hand ingredients to their saved recipes. Given the ingredients they HAVE " +
        'and a list of recipes (each with its ingredient list), return the recipes they can mostly make ' +
        'right now — those that use the most of what they have with the fewest missing important ' +
        'ingredients. Treat obvious equivalents as matches (e.g. "chicken" ↔ "chicken thighs", "tomato" ' +
        '↔ "cherry tomatoes", "scallion" ↔ "green onion", "greens" ↔ "kale"). Ignore common pantry ' +
        'staples (salt, pepper, oil, water, butter, flour, sugar) when deciding what is missing. Only ' +
        'include a recipe if it uses at least one HAVE item. For each, list which HAVE items it uses and ' +
        'the important ingredients still needed to buy. Rank best-match first (most used, fewest missing), ' +
        'up to 10. Respond with ONLY a JSON array: ' +
        '[{"slug": string, "uses": [string], "missing": [string]}].',
      messages: [{ role: 'user', content: `HAVE:\n${have.join(', ')}\n\nRECIPES:\n${list}` }],
    });
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .replace(/```json|```/g, '')
      .trim();
    const arr = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? text);
    if (Array.isArray(arr)) matches = arr;
  } catch (e) {
    return res.status(502).json({ error: `Couldn't match recipes: ${(e as Error).message}` });
  }

  const out = matches
    .filter((m) => m && bySlug.has(m.slug))
    .slice(0, 10)
    .map((m) => {
      const r = bySlug.get(m.slug);
      const clean = (a: any) =>
        Array.isArray(a) ? [...new Set(a.map((x) => String(x).trim()).filter(Boolean))] : [];
      return {
        slug: m.slug,
        title: r.title,
        eyebrow: r.data?.eyebrow ?? '',
        tagline: r.data?.tagline ?? '',
        photoUrl: r.photo_url ?? null,
        uses: clean(m.uses),
        missing: clean(m.missing),
      };
    });

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ matches: out });
}
