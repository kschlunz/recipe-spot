// api/plan-suggest.ts — fill the week's empty days with recipes that SHARE
// INGREDIENTS, to cut food waste and shopping. Claude picks recipes whose
// ingredients overlap with each other and with anything already planned this
// week — so extra veggies/herbs get used across meals. Still health-leaning and
// dessert-free. Falls back to a plain shuffle if the model is unavailable.
//
//   POST /api/plan-suggest  { days: ['mon','wed', …] }
//     → { picks: [{ day, slug, title, eyebrow, tagline, serves, calories }], note?, overlap? }

import Anthropic from '@anthropic-ai/sdk';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { maxDuration: 30 };

const anthropic = new Anthropic();
const MODEL = 'claude-sonnet-5';
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

// Desserts/sweets are never dinner-day picks. This is a hard filter applied
// before the model ever sees the list (and in the shuffle fallback), so a soft
// "prefer healthy" prompt can't be overridden by a small library or padding.
// Chosen to catch obvious sweets while sparing savory homonyms (crab cake, etc.).
const DESSERT_RE =
  /\b(desserts?|blondies?|brownies?|cookies?|cupcakes?|cheesecake|cobbler|crumble|custard|mousse|gelato|sorbet|frosting|icing|doughnuts?|donuts?|scones?|fudge|fudgy|ice ?cream|sweet treats?)\b/i;

function isDessert(r: any): boolean {
  const hay = `${r.title ?? ''} ${r.data?.eyebrow ?? ''} ${(r.tags ?? []).join(' ')}`;
  return DESSERT_RE.test(hay);
}

function client(res: VercelResponse): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    res.status(500).json({ error: 'Supabase not configured' });
    return null;
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Ultra-common staples don't count as meaningful ingredient overlap.
const STAPLE_RE =
  /^(kosher salt|sea salt|salt|black pepper|white pepper|pepper|olive oil|vegetable oil|oil|water|butter|unsalted butter|sugar|granulated sugar|all[- ]purpose flour|flour)$/i;
const ingNames = (r: any): string[] =>
  ((r?.data?.ingredients ?? []) as any[]).map((g) => String(g?.name ?? '').trim().toLowerCase()).filter(Boolean);

// Ingredients shared by 2+ of the given recipes (staples excluded), ranked by
// how many recipes use them — the "reused across meals" summary.
function sharedIngredients(recipes: any[]): string[] {
  const count = new Map<string, number>();
  for (const r of recipes) {
    for (const name of new Set(ingNames(r))) {
      if (STAPLE_RE.test(name)) continue;
      count.set(name, (count.get(name) ?? 0) + 1);
    }
  }
  return [...count.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([name]) => name);
}

// Ask Claude for an ordered list of slugs that overlap on ingredients; fall back
// to a shuffle on any trouble.
async function chooseSlugs(recipes: any[], n: number, planned: any[]): Promise<string[]> {
  const shuffled = shuffle(recipes); // vary input order so ties break differently
  if (!process.env.ANTHROPIC_API_KEY) return shuffled.slice(0, n).map((r) => r.slug);
  try {
    const list = shuffled
      .map((r) => {
        const tags = (r.tags ?? []).join(', ');
        const ings = ingNames(r).slice(0, 14).join(', ');
        const cal = Number(r.nutrition?.calories) || 0;
        const calLine = cal ? `\n  calories_per_serving: ${cal}` : '';
        return `slug: ${r.slug}\n  title: ${r.title}\n  tags: ${tags}\n  ingredients: ${ings}${calLine}`;
      })
      .join('\n');
    const plannedIngs = [...new Set(planned.flatMap(ingNames))].filter((x) => !STAPLE_RE.test(x));
    const plannedLine = plannedIngs.length
      ? `Already planned this week — REUSE these ingredients where you can:\n${plannedIngs.join(', ')}\n\n`
      : '';
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      temperature: 0.6,
      system:
        'You plan weeknight DINNERS that SHARE INGREDIENTS, to cut food waste and shopping. From the ' +
        'recipes given, choose exactly N to fill the empty days so that your picks — together with any ' +
        'recipes already planned this week — reuse the same ingredients across multiple meals. Prioritize ' +
        'overlap on FRESH PRODUCE (vegetables, herbs, greens) and other perishables that would otherwise ' +
        'be bought and go to waste; a shared pantry staple (salt, oil, flour) does not count. Prefer sets ' +
        'where several recipes share multiple ingredients. Keep the picks health-leaning, and never choose ' +
        'a dessert, sweet, or baked treat. Respond with ONLY a JSON array of exactly N recipe slugs, ' +
        'best-overlap first, using only slugs from the list.',
      messages: [{ role: 'user', content: `${plannedLine}N = ${n}\n\nRecipes to choose from:\n${list}` }],
    });
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .replace(/```json|```/g, '')
      .trim();
    const arr = JSON.parse(text);
    const valid = new Set(recipes.map((r) => r.slug));
    const picks = Array.isArray(arr) ? arr.filter((s) => typeof s === 'string' && valid.has(s)) : [];
    const seen = new Set<string>();
    const deduped = picks.filter((s) => (seen.has(s) ? false : (seen.add(s), true)));
    // Top up from the shuffle if the model returned too few.
    for (const r of shuffled) {
      if (deduped.length >= n) break;
      if (!seen.has(r.slug)) {
        deduped.push(r.slug);
        seen.add(r.slug);
      }
    }
    return deduped.slice(0, n);
  } catch {
    return shuffled.slice(0, n).map((r) => r.slug);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const supabase = client(res);
  if (!supabase) return;

  const days: string[] = Array.isArray((req.body ?? {}).days)
    ? (req.body.days as string[]).filter((d) => DAYS.includes(d))
    : [];
  if (days.length === 0) return res.status(400).json({ error: 'Provide the days to fill.' });

  // Include nutrition (for calorie balancing) with a graceful fallback if the
  // column isn't there yet.
  let recipes: any[] | null = null;
  let error: any = null;
  ({ data: recipes, error } = await supabase.from('recipes').select('slug, title, data, tags, nutrition'));
  if (error && /nutrition/i.test(error.message)) {
    ({ data: recipes, error } = await supabase.from('recipes').select('slug, title, data, tags'));
  }
  if (error) return res.status(500).json({ error: error.message });
  if (!recipes || recipes.length === 0) {
    return res.status(200).json({ picks: [], note: 'No saved recipes yet — import a few first.' });
  }

  const bySlug = new Map(recipes.map((r: any) => [r.slug, r]));

  // What's already on the week — so the fills overlap with it too.
  const { data: plannedRows } = await supabase.from('meal_plan_recipes').select('recipe_slug');
  const plannedSlugs = new Set((plannedRows ?? []).map((r: any) => r.recipe_slug));
  const planned = [...plannedSlugs].map((s) => bySlug.get(s)).filter(Boolean);

  // Only main meals are eligible for a dinner day — desserts are filtered out
  // up front, along with anything already on the plan. If somehow everything is
  // filtered out, fall back so the button still does something.
  const mains = recipes.filter((r: any) => !isDessert(r) && !plannedSlugs.has(r.slug));
  const pool = mains.length > 0 ? mains : recipes.filter((r: any) => !isDessert(r));

  const n = Math.min(days.length, pool.length);
  const slugs = await chooseSlugs(pool, n, planned);

  const picks = slugs.map((slug, i) => {
    const r = bySlug.get(slug);
    return {
      day: days[i],
      slug,
      title: r.title,
      eyebrow: r.data?.eyebrow ?? '',
      tagline: r.data?.tagline ?? '',
      serves: Number(r.data?.serves) || undefined,
      calories: Number(r.nutrition?.calories) || null,
    };
  });

  // The ingredients that now get reused across the week (picks + already planned).
  const overlap = sharedIngredients([...picks.map((p) => bySlug.get(p.slug)), ...planned]);

  const short = days.length - picks.length;
  const note =
    short > 0
      ? `Only ${pool.length} main-dish recipe${pool.length === 1 ? '' : 's'} to choose from (desserts are skipped), so ${short} day${short === 1 ? '' : 's'} stayed open. Import a few more savory recipes!`
      : undefined;

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ picks, note, overlap });
}
