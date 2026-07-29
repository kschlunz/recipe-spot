// api/shopping.ts — roll up ingredients from the week's planned recipes into a
// deduped, serving-scaled shopping list, plus groceries pulled from free-text
// day notes ("Kate grills chicken and makes veggies"). GET only.
//
//   GET /api/shopping → { items: […], noteItems: […], recipes }
//     items     — one line per ingredient from the week's planned recipes
//     noteItems — groceries pulled from free-text day notes, kept separate so
//                 you can see what you added by hand
//
// Grouping: one line per ingredient NAME. Quantities are summed per unit, so
// "1 cup" + "1 cup" → "2 cup", while mismatched units stay side by side
// ("1 cup + 200 g") rather than being force-converted. Each planned dish is
// scaled by its chosen servings ÷ the recipe's own serves.
//
// Notes: a day can also carry a free-text note. Notes that mean "no groceries"
// (leftovers, eat out, takeout) are skipped; anything else is read by Claude,
// which extracts the grocery items. Those show up in their own "your notes"
// list (minus anything a planned recipe already covers).

import Anthropic from '@anthropic-ai/sdk';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { maxDuration: 30 };

const anthropic = new Anthropic();
const NOTE_MODEL = 'claude-haiku-4-5';

// Notes that obviously need nothing bought — skip before ever calling the model.
const NOTE_SKIP =
  /^(left ?overs?|eat(ing)? out|out to eat|dinner out|take[- ]?out|takeaway|order (in|out)|delivery|dining out|restaurant|fend for yourself|nothing|none|n\/a|tbd|\?+)\.?$/i;

function client(res: VercelResponse): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    res.status(500).json({ error: 'Supabase not configured' });
    return null;
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

type Group = {
  name: string;
  note: string;
  units: Map<string, number>;
  toTaste: boolean;
  sources: Set<string>;
};

async function groceriesFromNotes(notes: string[]): Promise<string[]> {
  const usable = notes.map((n) => n.trim()).filter((n) => n && !NOTE_SKIP.test(n));
  if (usable.length === 0 || !process.env.ANTHROPIC_API_KEY) return [];
  try {
    const msg = await anthropic.messages.create({
      model: NOTE_MODEL,
      max_tokens: 500,
      system:
        'You turn short weeknight dinner notes into a grocery shopping list. ' +
        'You are given a numbered list of notes. For each note that describes a meal cooked at home, ' +
        'output the grocery items needed to make it. Skip any note that means no shopping is needed ' +
        '(leftovers, eating out, takeout, ordering in, a restaurant). Use simple lowercase ingredient ' +
        'names, no quantities, no brands, no duplicates. Respond with ONLY a JSON array of strings ' +
        '(e.g. ["chicken breasts","mixed vegetables"]). If nothing is needed, respond with [].',
      messages: [{ role: 'user', content: usable.map((n, i) => `${i + 1}. ${n}`).join('\n') }],
    });
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .replace(/```json|```/g, '')
      .trim();
    const arr = JSON.parse(text);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string' && x.trim()).map((s) => s.trim()) : [];
  } catch {
    return []; // best-effort — never let note parsing break the list
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const supabase = client(res);
  if (!supabase) return;

  // Recipes are a list per day (meal_plan_recipes); notes live on meal_plan.
  const { data: planned, error } = await supabase
    .from('meal_plan_recipes')
    .select('recipe_slug, servings');
  if (error) return res.status(500).json({ error: error.message });

  const { data: noteRows, error: nErr } = await supabase.from('meal_plan').select('note');
  if (nErr) return res.status(500).json({ error: nErr.message });
  const notes = (noteRows ?? []).map((r: any) => r.note).filter((n: any): n is string => !!n);

  const groups = new Map<string, Group>();
  const recipeTitles = new Set<string>();

  // --- recipes ---
  if ((planned ?? []).length > 0) {
    const slugs = [...new Set((planned ?? []).map((r: any) => r.recipe_slug))];
    const { data: recipes, error: rErr } = await supabase
      .from('recipes')
      .select('slug, title, data')
      .in('slug', slugs);
    if (rErr) return res.status(500).json({ error: rErr.message });

    const bySlug = new Map<string, any>();
    (recipes ?? []).forEach((r: any) => bySlug.set(r.slug, r));

    for (const row of planned ?? []) {
      const r = bySlug.get((row as any).recipe_slug);
      if (!r) continue;
      const title = r.title as string;
      recipeTitles.add(title);
      const base = Number(r.data?.serves) || 0;
      const target = (row as any).servings ? Number((row as any).servings) : 0;
      const scale = base && target ? target / base : 1;

      for (const g of (r.data?.ingredients ?? []) as any[]) {
        const name = String(g.name ?? '').trim();
        if (!name) continue;
        const key = name.toLowerCase();
        let grp = groups.get(key);
        if (!grp) {
          grp = { name, note: g.note ?? '', units: new Map(), toTaste: false, sources: new Set() };
          groups.set(key, grp);
        }
        grp.sources.add(title);
        if (!grp.note && g.note) grp.note = g.note;
        if (g.us && g.us.q) {
          const u = String(g.us.u ?? '');
          grp.units.set(u, (grp.units.get(u) ?? 0) + Number(g.us.q) * scale);
        } else {
          grp.toTaste = true;
        }
      }
    }
  }

  const items = [...groups.values()]
    .map((grp) => ({
      name: grp.name,
      note: grp.note,
      amounts: [...grp.units.entries()].map(([u, q]) => ({ q, u })),
      toTaste: grp.toTaste,
      sources: [...grp.sources],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // --- groceries extracted from day notes, kept in their own "your notes" list ---
  // Drop anything a planned recipe already covers, so this list is only the
  // things you added by hand.
  const seenName = new Set(groups.keys());
  const noteNames = await groceriesFromNotes(notes);
  const noteItems = [...new Set(noteNames.map((n) => n.trim()).filter(Boolean))]
    .filter((name) => !seenName.has(name.toLowerCase()))
    .map((name) => ({ name, note: '', amounts: [] as { q: number; u: string }[], toTaste: false, sources: ['your notes'] }))
    .sort((a, b) => a.name.localeCompare(b.name));

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ items, noteItems, recipes: [...recipeTitles] });
}
