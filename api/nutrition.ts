// api/nutrition.ts — estimate per-serving nutrition for a recipe from its
// ingredient list, using Claude, and store it on the recipe row.
//
//   POST /api/nutrition  { slug }  → { nutrition: { calories, protein, carbs, fat } }
//
// Estimates only — labeled as such in the UI. Numbers are per single serving,
// so they don't change with the recipe's serving multiplier.

import Anthropic from '@anthropic-ai/sdk';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { maxDuration: 30 };

const anthropic = new Anthropic();
// Fast, non-reasoning model — returns the JSON directly. (A reasoning model can
// spend a small token budget on thinking and leave no text to parse, which
// surfaced as "Unexpected end of JSON input".)
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

const num = (v: any) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Nutrition estimation is not configured.' });
  }

  const slug = typeof (req.body ?? {}).slug === 'string' ? req.body.slug : '';
  if (!slug) return res.status(400).json({ error: 'Provide a recipe slug.' });

  const supabase = client(res);
  if (!supabase) return;

  const { data: row, error } = await supabase
    .from('recipes')
    .select('slug, title, data')
    .eq('slug', slug)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!row) return res.status(404).json({ error: 'Recipe not found' });

  const recipe = (row as any).data ?? {};
  const serves = Number(recipe.serves) || 4;
  const lines = ((recipe.ingredients ?? []) as any[])
    .map((g) => {
      const amt = g.us && g.us.q ? `${g.us.q} ${g.us.u ?? ''}` : g.metric && g.metric.q ? `${g.metric.q} ${g.metric.u ?? ''}` : '';
      return `- ${amt} ${g.name ?? ''}${g.note ? ` (${g.note})` : ''}`.replace(/\s+/g, ' ').trim();
    })
    .join('\n');

  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      system:
        'You estimate recipe nutrition. Given a full ingredient list and how many servings the recipe ' +
        'makes, estimate the nutrition PER SERVING using standard food composition values. Divide totals ' +
        'by the number of servings. Respond with ONLY a JSON object of numbers: ' +
        '{"calories": <kcal>, "protein": <g>, "carbs": <g>, "fat": <g>}. Integers, per one serving, no ' +
        'ranges, no text, no units in the values.',
      messages: [{ role: 'user', content: `Servings: ${serves}\n\nIngredients:\n${lines}` }],
    });
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .replace(/```json|```/g, '')
      .trim();
    // Pull out just the JSON object, in case the model adds any stray text.
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('empty response from the model');
    const parsed = JSON.parse(match[0]);
    const nutrition = {
      calories: num(parsed.calories),
      protein: num(parsed.protein),
      carbs: num(parsed.carbs),
      fat: num(parsed.fat),
      source: 'estimated' as const,
    };

    // Persist it. If the `nutrition` column doesn't exist yet (schema not run),
    // don't fail — still return the estimate so the page can show it this
    // session, and flag that it wasn't saved.
    const { error: upErr } = await supabase.from('recipes').update({ nutrition }).eq('slug', slug);
    const saved = !upErr;

    return res.status(200).json({ nutrition, saved });
  } catch (e) {
    return res.status(502).json({ error: `Could not estimate nutrition: ${(e as Error).message}` });
  }
}
