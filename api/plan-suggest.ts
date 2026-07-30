// api/plan-suggest.ts — the weekly randomizer. Given a set of empty days, pick a
// healthy, varied set of recipes to fill them. Claude does the choosing: it
// leans the week toward vegetables/legumes/fish/lean protein/whole grains and
// away from heavy fried/dessert-y dishes, and avoids repeating the same main
// protein or cuisine. Falls back to a plain shuffle if the model is unavailable.
//
//   POST /api/plan-suggest  { days: ['mon','wed', …] }
//     → { picks: [{ day, slug, title, eyebrow, tagline, serves }], note? }

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

// Ask Claude for an ordered list of slugs; fall back to a shuffle on any trouble.
async function chooseSlugs(recipes: any[], n: number): Promise<string[]> {
  const shuffled = shuffle(recipes); // vary input order so repeat taps differ
  if (!process.env.ANTHROPIC_API_KEY) return shuffled.slice(0, n).map((r) => r.slug);
  try {
    const list = shuffled
      .map((r) => {
        const tags = (r.tags ?? []).join(', ');
        const ings = ((r.data?.ingredients ?? []) as any[])
          .map((g) => g.name)
          .filter(Boolean)
          .slice(0, 10)
          .join(', ');
        return `slug: ${r.slug}\n  title: ${r.title}\n  tags: ${tags}\n  ingredients: ${ings}`;
      })
      .join('\n');
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      temperature: 1,
      system:
        'You plan a healthy, varied week of weeknight DINNERS. From the recipes given, choose exactly N ' +
        'that are (1) health-leaning overall — favor vegetables, legumes, fish and lean protein, whole ' +
        'grains, and salads; go easy on heavy fried dishes — and (2) varied: avoid repeating the same ' +
        'main protein or cuisine across your picks. These must be main meals — never choose a dessert, ' +
        'sweet, or baked treat. Respond with ONLY a JSON array of exactly N recipe slugs, ' +
        'most-recommended first, using only slugs from the list.',
      messages: [{ role: 'user', content: `N = ${n}\n\nRecipes:\n${list}` }],
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

  const { data: recipes, error } = await supabase.from('recipes').select('slug, title, data, tags');
  if (error) return res.status(500).json({ error: error.message });
  if (!recipes || recipes.length === 0) {
    return res.status(200).json({ picks: [], note: 'No saved recipes yet — import a few first.' });
  }

  // Only main meals are eligible for a dinner day — desserts are filtered out
  // up front. If somehow everything is a dessert, fall back to the full list so
  // the button still does something.
  const mains = recipes.filter((r: any) => !isDessert(r));
  const pool = mains.length > 0 ? mains : recipes;

  const n = Math.min(days.length, pool.length);
  const slugs = await chooseSlugs(pool, n);
  const bySlug = new Map(recipes.map((r: any) => [r.slug, r]));

  const picks = slugs.map((slug, i) => {
    const r = bySlug.get(slug);
    return {
      day: days[i],
      slug,
      title: r.title,
      eyebrow: r.data?.eyebrow ?? '',
      tagline: r.data?.tagline ?? '',
      serves: Number(r.data?.serves) || undefined,
    };
  });

  const short = days.length - picks.length;
  const note =
    short > 0
      ? `Only ${pool.length} main-dish recipe${pool.length === 1 ? '' : 's'} to choose from (desserts are skipped), so ${short} day${short === 1 ? '' : 's'} stayed open. Import a few more savory recipes!`
      : undefined;

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ picks, note });
}
