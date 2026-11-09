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

// Shared shopping-list checkmarks used to live at /api/shopping-checks. They're
// merged in here (routed via a vercel.json rewrite to ?resource=checks) to stay
// under the Hobby-plan serverless-function limit. A checked item is stored by
// its normalized name key, so both people in the household see the same ticks.
const norm = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

async function handleChecks(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient) {
  if (req.method === 'GET') {
    const { data, error } = await supabase.from('shopping_checked').select('item_key');
    if (error) return res.status(500).json({ error: error.message });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ checked: (data ?? []).map((r: any) => r.item_key) });
  }

  if (req.method === 'POST') {
    const key = norm((req.body ?? {}).key);
    if (!key) return res.status(400).json({ error: 'Provide an item key.' });
    const { error } = await supabase
      .from('shopping_checked')
      .upsert({ item_key: key }, { onConflict: 'item_key' });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    if (req.query.all) {
      const { error } = await supabase.from('shopping_checked').delete().neq('item_key', '');
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    const key = norm(req.query.key);
    if (!key) return res.status(400).json({ error: 'Provide ?key=… or ?all=1.' });
    const { error } = await supabase.from('shopping_checked').delete().eq('item_key', key);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}

// Saved Walmart picks (routed via a vercel.json rewrite from /api/shopping-picks
// to ?resource=picks, for the same function-limit reason as the checkmarks).
// A pick remembers which Walmart product the household buys for an ingredient,
// keyed by the cleaned ingredient name, so the list can be sent to a Walmart
// cart by item ID.
//
//   GET    /api/shopping-picks                → { picks: { <key>: { itemId, label } } }
//   POST   /api/shopping-picks { key, link }  → { itemId, label }
//   DELETE /api/shopping-picks?key=<key>      → { ok }

// Walmart's own link shortener (what the app's share sheet can hand out).
const WALMART_SHORT_HOSTS = new Set(['walmrt.us']);
const isWalmartHost = (h: string) => h === 'walmart.com' || h.endsWith('.walmart.com');

// The table hasn't been created yet (Postgres and PostgREST word this differently).
const tableMissing = (msg: string) => /does not exist|could not find the table/i.test(msg);
const PICKS_SETUP =
  'Saved picks need a one-time database setup: run the walmart_picks block from supabase-schema.sql in Supabase.';

type Pick = { itemId: string; label: string };

// Pull the item ID (and a readable name, when the URL carries one) out of a
// Walmart product URL: /ip/<name>/<id> or /ip/<id>.
function pickFromUrl(u: URL): Pick | null {
  if (!isWalmartHost(u.hostname)) return null;
  const m = u.pathname.match(/\/ip\/(?:([^/]+)\/)?(\d{4,})(?:\/|$)/);
  if (!m) return null;
  let label = '';
  try {
    label = decodeURIComponent(m[1] ?? '').replace(/-+/g, ' ').trim().slice(0, 120);
  } catch {
    /* odd escaping — the ID is what matters */
  }
  return { itemId: m[2], label };
}

// Accepts whatever was pasted: a bare item ID, a product URL, share text with a
// URL in it, or a Walmart short link (followed, a few hops at most, and only
// while it stays on Walmart's own hosts).
async function resolvePick(raw: string): Promise<Pick | null> {
  const text = raw.trim();
  if (/^\d{4,}$/.test(text)) return { itemId: text, label: '' };
  const found = text.match(/https?:\/\/[^\s<>"']+/i);
  let href = found ? found[0] : /^[\w.-]+\.[a-z]{2,}\//i.test(text) ? `https://${text}` : '';
  for (let hop = 0; href && hop < 4; hop++) {
    let u: URL;
    try {
      u = new URL(href);
    } catch {
      return null;
    }
    const direct = pickFromUrl(u);
    if (direct) return direct;
    if (u.protocol !== 'https:' || !(WALMART_SHORT_HOSTS.has(u.hostname) || isWalmartHost(u.hostname))) return null;
    try {
      const r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
      const next = r.headers.get('location');
      href = next ? new URL(next, u).toString() : '';
    } catch {
      return null;
    }
  }
  return null;
}

async function handlePicks(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient) {
  if (req.method === 'GET') {
    const { data, error } = await supabase.from('walmart_picks').select('item_key, item_id, label');
    res.setHeader('Cache-Control', 'no-store');
    if (error) {
      // Not set up yet: let the list load and point at the one-time setup.
      if (tableMissing(error.message)) return res.status(200).json({ picks: {}, needsSetup: true });
      return res.status(500).json({ error: error.message });
    }
    const picks: Record<string, Pick> = {};
    for (const r of data ?? []) picks[(r as any).item_key] = { itemId: (r as any).item_id, label: (r as any).label ?? '' };
    return res.status(200).json({ picks });
  }

  if (req.method === 'POST') {
    const body = req.body ?? {};
    const key = norm(body.key).slice(0, 200);
    const link = typeof body.link === 'string' ? body.link.slice(0, 2000) : '';
    if (!key || !link.trim()) return res.status(400).json({ error: 'Provide an item key and a Walmart link.' });
    const pick = await resolvePick(link);
    if (!pick) {
      return res.status(400).json({
        error: "Couldn't find a Walmart product in that. Open the product in Walmart, copy its link, and paste it here.",
      });
    }
    const { error } = await supabase
      .from('walmart_picks')
      .upsert(
        { item_key: key, item_id: pick.itemId, label: pick.label, updated_at: new Date().toISOString() },
        { onConflict: 'item_key' },
      );
    if (error) {
      if (tableMissing(error.message)) return res.status(409).json({ error: PICKS_SETUP, needsSetup: true });
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json(pick);
  }

  if (req.method === 'DELETE') {
    const key = norm(req.query.key);
    if (!key) return res.status(400).json({ error: 'Provide ?key=….' });
    const { error } = await supabase.from('walmart_picks').delete().eq('item_key', key);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}

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

// Dried spices, seasonings, and pantry herbs — the stuff you usually already
// have on the shelf. Heuristic (name match); fresh herbs and produce are
// deliberately excluded so they stay on the main buy list.
const SPICE_RE =
  /\b(salt|seasoning|italian seasoning|cajun|creole|old bay|taco seasoning|curry powder|garam masala|five[- ]?spice|za'?atar|ras el hanout|herbes de provence|cumin|turmeric|paprika|cinnamon|nutmeg|cardamom|allspice|cloves?|coriander|cayenne|chili powder|chile powder|chili flakes?|red pepper flakes?|crushed red pepper|fennel seeds?|mustard seeds?|mustard powder|dry mustard|caraway|celery seeds?|celery salt|saffron|sumac|fenugreek|mace|star anise|anise|onion powder|garlic powder|ground ginger|peppercorns?|black pepper|white pepper|oregano|thyme|rosemary|sage|marjoram|bay leaf|bay leaves|tarragon)\b/i;

function isSpice(name: string): boolean {
  const n = name.toLowerCase();
  if (/\bfresh\b/.test(n)) return false; // fresh herbs / produce
  if (/bell pepper/.test(n)) return false; // a vegetable, not the spice
  if (/\bgarlic\b/.test(n) && !/garlic powder/.test(n)) return false; // fresh garlic
  if (/\bginger\b/.test(n) && !/ground ginger/.test(n)) return false; // fresh ginger
  return SPICE_RE.test(n);
}

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
  const supabase = client(res);
  if (!supabase) return;

  // Shared shopping-list checkmarks (formerly /api/shopping-checks).
  if (req.query.resource === 'checks') return handleChecks(req, res, supabase);
  // Saved Walmart picks.
  if (req.query.resource === 'picks') return handlePicks(req, res, supabase);

  // The shopping list itself is GET-only.
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

  const allRecipeItems = [...groups.values()]
    .map((grp) => ({
      name: grp.name,
      note: grp.note,
      amounts: [...grp.units.entries()].map(([u, q]) => ({ q, u })),
      toTaste: grp.toTaste,
      sources: [...grp.sources],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Spices/seasonings get their own section — the user usually has these.
  const spices = allRecipeItems.filter((it) => isSpice(it.name));
  const items = allRecipeItems.filter((it) => !isSpice(it.name));

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
  return res.status(200).json({ items, spices, noteItems, recipes: [...recipeTitles] });
}
