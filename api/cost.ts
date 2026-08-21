// api/cost.ts — estimate the total grocery cost (USD) to make a recipe from its
// ingredient list, using Claude, and store it on the recipe row.
//
//   POST /api/cost  { slug }  → { cost: number, saved: boolean }
//
// A rough US-grocery estimate of buying the ingredients — labeled "estimated"
// in the UI. Returns the estimate even if the `cost` column isn't there yet.

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Cost estimation is not configured.' });
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
  const lines = ((recipe.ingredients ?? []) as any[])
    .map((g) => {
      const amt = g.us && g.us.q ? `${g.us.q} ${g.us.u ?? ''}` : g.metric && g.metric.q ? `${g.metric.q} ${g.metric.u ?? ''}` : '';
      return `- ${amt} ${g.name ?? ''}${g.note ? ` (${g.note})` : ''}`.replace(/\s+/g, ' ').trim();
    })
    .join('\n');

  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 120,
      system:
        'You estimate what it costs to buy the ingredients for a recipe at a typical US grocery store, ' +
        'in US dollars. Given the ingredient list with amounts, estimate the TOTAL cost to make the ' +
        'recipe once. Count only the amount the recipe uses (e.g. a few cloves of garlic, not a whole ' +
        'head), and assume common pantry staples (salt, pepper, water, basic oil) are already on hand. ' +
        'Respond with ONLY a JSON object: {"total": <number>} — dollars, no currency symbol, no text.',
      messages: [{ role: 'user', content: `Ingredients:\n${lines}` }],
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
    const cost = Math.round((Number(parsed.total) || 0) * 100) / 100;
    if (!(cost > 0)) throw new Error('no usable estimate');

    const { error: upErr } = await supabase.from('recipes').update({ cost }).eq('slug', slug);
    return res.status(200).json({ cost, saved: !upErr });
  } catch (e) {
    return res.status(502).json({ error: `Could not estimate cost: ${(e as Error).message}` });
  }
}
