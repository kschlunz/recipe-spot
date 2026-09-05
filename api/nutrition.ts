// api/nutrition.ts — estimate per-serving nutrition for a recipe from its
// ingredient list, AND assess whether it's heart-healthy (Mediterranean / AHA
// guidelines), using Claude, and store both on the recipe row.
//
//   POST /api/nutrition  { slug }
//     → { nutrition: {calories,protein,carbs,fat}, heartHealthy: boolean,
//         heartReason: string, saved: boolean }
//
// Nutrition numbers are per single serving. Heart-healthy is a yes/no verdict
// against the Mediterranean diet (Mayo Clinic) and the AHA diet & lifestyle
// recommendations: plant-forward, olive oil, fish/lean protein, whole grains,
// legumes, nuts; low in saturated/trans fat, sodium, red/processed meat,
// refined carbs, and added sugar. Both are folded into this one endpoint so the
// project stays under the serverless-function limit.

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

  // Pull existing nutrition too (may have come from the source page) so we don't
  // overwrite it with an estimate. Fall back if the column isn't there yet.
  let row: any = null;
  let error: any = null;
  ({ data: row, error } = await supabase
    .from('recipes')
    .select('slug, title, data, nutrition')
    .eq('slug', slug)
    .maybeSingle());
  if (error) {
    ({ data: row, error } = await supabase
      .from('recipes')
      .select('slug, title, data')
      .eq('slug', slug)
      .maybeSingle());
  }
  if (error) return res.status(500).json({ error: error.message });
  if (!row) return res.status(404).json({ error: 'Recipe not found' });

  const recipe = row.data ?? {};
  const existingNutrition = row.nutrition && typeof row.nutrition === 'object' ? row.nutrition : null;
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
      max_tokens: 500,
      system:
        'You are a registered-dietitian assistant. Given a recipe (ingredient list + servings) do TWO things.\n\n' +
        '1) Estimate nutrition PER SERVING using standard food composition values (divide totals by servings).\n\n' +
        '2) Decide if the dish is HEART-HEALTHY by the Mediterranean diet (Mayo Clinic) and the American Heart ' +
        'Association diet & lifestyle recommendations. Heart-healthy dishes are plant-forward and rich in ' +
        'vegetables, fruits, whole grains, legumes, nuts/seeds; use healthy fats (olive oil) and lean proteins ' +
        'especially fish/poultry; and are LOW in saturated fat, trans fat, sodium, added sugar, refined grains, ' +
        'and red or processed meat. Mark heart_healthy false for dishes built on red/processed meat, lots of ' +
        'butter/cream/cheese, deep-frying, refined-carb or high-added-sugar bases, or desserts/sweets. Judge the ' +
        'dish as a whole; small amounts of cheese or butter are fine in an otherwise plant-forward, olive-oil dish.\n\n' +
        'Respond with ONLY a JSON object: {"calories":<int kcal>,"protein":<int g>,"carbs":<int g>,"fat":<int g>,' +
        '"heart_healthy":<true|false>,"heart_reason":"<one short sentence, max ~15 words>"}. Per one serving, ' +
        'integers, no ranges, no units in numeric values, no extra text.',
      messages: [{ role: 'user', content: `Servings: ${serves}\n\nIngredients:\n${lines}` }],
    });
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .replace(/```json|```/g, '')
      .trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('empty response from the model');
    const parsed = JSON.parse(match[0]);

    // Keep source-provided nutrition if we already have it; else use the estimate.
    const nutrition =
      existingNutrition ?? {
        calories: num(parsed.calories),
        protein: num(parsed.protein),
        carbs: num(parsed.carbs),
        fat: num(parsed.fat),
        source: 'estimated' as const,
      };
    const heartHealthy = parsed.heart_healthy === true;
    const heartReason = typeof parsed.heart_reason === 'string' ? parsed.heart_reason.trim().slice(0, 200) : '';

    // Persist. Save nutrition only if it was missing (don't clobber the source's
    // own numbers). Save the heart verdict separately so a missing nutrition
    // column can't stop the heart columns saving, and vice versa. If a column
    // isn't there yet (schema not run), just report saved:false.
    let nutritionSaved = true;
    if (!existingNutrition) {
      const { error: nErr } = await supabase.from('recipes').update({ nutrition }).eq('slug', slug);
      nutritionSaved = !nErr;
    }
    const { error: hErr } = await supabase
      .from('recipes')
      .update({ heart_healthy: heartHealthy, heart_reason: heartReason })
      .eq('slug', slug);
    const saved = nutritionSaved && !hErr;

    return res.status(200).json({ nutrition, heartHealthy, heartReason, saved });
  } catch (e) {
    return res.status(502).json({ error: `Could not estimate nutrition: ${(e as Error).message}` });
  }
}
