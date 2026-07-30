// api/import-recipe.ts — Vercel serverless function
// POST { url: string } or { text: string }  →  { recipe, source, extractedFrom }
//
// Flow: fetch page server-side (no CORS problem) → pull schema.org/Recipe
// JSON-LD if present → Claude restructures it into the recipe tree schema →
// validate → return. Falls back to raw page text when there's no JSON-LD.
//
// Env: ANTHROPIC_API_KEY (read automatically by the SDK)

import Anthropic from '@anthropic-ai/sdk';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const anthropic = new Anthropic();
const MODEL = 'claude-sonnet-5';

// Give the function room for a page fetch plus up to two Claude calls (the
// default 10s limit times out on long recipes and returns an empty 500).
export const config = { maxDuration: 60 };

/* ---------- schema the renderer expects ---------- */
const SCHEMA_DOC = `{
  "title": string,
  "eyebrow": string,          // short vibe line, e.g. "One pot · vegetarian"
  "tagline": string,          // one-sentence description
  "serves": number,
  "active": string,           // e.g. "20 min"
  "total": string,
  "vessel": string,           // main pot/pan
  "prep": string,             // optional single setup line shown above the grid
  "ingredients": [            // ORDER MATTERS — see rules
    { "id": string, "name": string, "note": string?,
      "us": { "q": number, "u": string }?,      // q=0 or omitted = "to taste"
      "metric": { "q": number, "u": string }? }
  ],
  "steps": [
    { "id": string,           // "s1", "s2", ...
      "verb": string,         // 2-4 words shown in the grid cell
      "detail": string,       // timing/technique, e.g. "8-10 min · stir often"
      "seconds": number,      // timer for cook mode; 0 if untimed
      "title": string,        // full sentence for the cook-mode stage bar
      "inputs": [string] }    // ingredient ids AND/OR earlier step ids
  ],
  "notes": [ { "h": string, "p": string } ],   // tips, storage, substitutions
  "tags": [string],           // 3-6 short lowercase tags for browsing/filtering
  "credit": string
}`;

const RULES = `Rules:
1. Every ingredient must appear in exactly one step's inputs. A step that uses
   the output of an earlier step lists that step's id as an input.
2. CONTIGUITY (critical): order the ingredients list so that the full set of
   ingredients under each step (transitively, through step inputs) forms an
   unbroken block of consecutive rows. List ingredients in the order they
   first enter the pot. For a recipe with parallel components (a sauce made
   separately, then combined), group each component's ingredients together.
3. Convert quantities to both us and metric using sensible cooking conversions.
   Garnish/serving items with no real quantity: omit us/metric entirely.
4. seconds = the lower bound of the step's time range in seconds; 0 if untimed.
5. Move tips, storage, and substitution advice out of the instructions and
   into notes. Keep step verbs terse.
6. PARALLEL COMPONENTS: when a component is made separately and only added at
   the end (a sauce, glaze, topping, dressing, streusel), its mixing step's
   inputs must be ONLY that component's own ingredients — never another step.
   Do not make the sauce step consume the main mixture just because the sauce
   is later poured on it. Combine the components in a LATER step (assemble,
   bake, top, serve) that lists both step ids as its inputs. Example: a
   meatloaf has s_loaf (loaf ingredients), s_sauce (sauce ingredients only),
   then s_bake with inputs [s_loaf, s_sauce].
7. tags: 3-6 short lowercase tags for browsing and filtering — meal type
   (weeknight, dinner, breakfast), dietary (vegetarian, vegan, gluten-free),
   cuisine (mexican, italian, thai), main ingredient (chicken, beans, pasta),
   and method/effort (one-pot, sheet-pan, no-cook, make-ahead, slow-cooker).
   Keep each to 1-2 words, generic enough that other recipes would share them.
8. Respond with ONLY the JSON object. No markdown fences, no preamble.`;

/* ---------- JSON-LD extraction ---------- */
function findRecipeNode(node: any): any | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findRecipeNode(n);
      if (r) return r;
    }
    return null;
  }
  const t = node['@type'];
  const types = Array.isArray(t) ? t : [t];
  if (types.includes('Recipe')) return node;
  if (node['@graph']) return findRecipeNode(node['@graph']);
  return null;
}

function extractJsonLd(html: string): any | null {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const r = findRecipeNode(JSON.parse(m[1].trim()));
      if (r) return r;
    } catch {
      /* malformed block — keep scanning */
    }
  }
  return null;
}

// schema.org NutritionInformation is defined per serving. Pull calories +
// macros out of it when a page provides them. Values look like "520 calories"
// or "12 g", so grab the first number. Returns null if there's nothing usable.
function parseSourceNutrition(n: any): { calories: number; protein: number; carbs: number; fat: number; source: 'source' } | null {
  if (!n || typeof n !== 'object') return null;
  const num = (v: any) => {
    const m = String(Array.isArray(v) ? v[0] : (v ?? '')).replace(/,/g, '').match(/[\d.]+/);
    return m ? Math.round(parseFloat(m[0])) : 0;
  };
  const calories = num(n.calories);
  const protein = num(n.proteinContent);
  const carbs = num(n.carbohydrateContent);
  const fat = num(n.fatContent);
  if (!calories && !protein && !carbs && !fat) return null;
  return { calories, protein, carbs, fat, source: 'source' };
}

function instructionsToText(ins: any): string {
  if (!ins) return '';
  if (typeof ins === 'string') return ins;
  if (Array.isArray(ins))
    return ins
      .map((i) =>
        typeof i === 'string'
          ? i
          : i['@type'] === 'HowToSection'
            ? `${i.name || ''}\n${instructionsToText(i.itemListElement)}`
            : i.text || i.name || '',
      )
      .filter(Boolean)
      .join('\n');
  return ins.text || '';
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

// Pull an Open Graph meta value (used to read the caption of a social post).
function metaContent(html: string, prop: string): string {
  const a = html.match(
    new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i'),
  );
  if (a) return decodeEntities(a[1]);
  const b = html.match(
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i'),
  );
  return b ? decodeEntities(b[1]) : '';
}

const SOCIAL = /(instagram\.com|tiktok\.com|youtube\.com|youtu\.be|facebook\.com|fb\.watch|pinterest\.)/i;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 20000); // plenty for any recipe, keeps the prompt sane
}

/* ---------- validation (mirror of the renderer's buildGrid) ---------- */
function validateRecipe(r: any): string | null {
  if (!r?.ingredients?.length || !r?.steps?.length) return 'Missing ingredients or steps.';
  const leaf: Record<string, number> = {};
  r.ingredients.forEach((g: any, i: number) => (leaf[g.id] = i));
  const byId: Record<string, any> = {};
  r.steps.forEach((s: any) => (byId[s.id] = s));
  const memo: Record<string, number[]> = {};
  const leaves = (sid: string, seen: Set<string>): number[] => {
    if (memo[sid]) return memo[sid];
    if (seen.has(sid)) throw new Error(`step loop at ${sid}`);
    seen.add(sid);
    let out: number[] = [];
    for (const inp of byId[sid].inputs || []) {
      if (inp in leaf) out.push(leaf[inp]);
      else if (byId[inp]) out = out.concat(leaves(inp, seen));
      else throw new Error(`unknown input "${inp}" in ${sid}`);
    }
    out = [...new Set(out)].sort((a, b) => a - b);
    memo[sid] = out;
    return out;
  };
  try {
    for (const s of r.steps) {
      const L = leaves(s.id, new Set());
      if (!L.length) return `step ${s.id} has no ingredients`;
      if (L[L.length - 1] - L[0] + 1 !== L.length) return `step ${s.id} spans non-contiguous ingredients`;
    }
  } catch (e: any) {
    return e.message;
  }
  return null;
}

/* ---------- Claude call ---------- */
type ImageInput = { mediaType: string; data: string };

async function convert(sourceLabel: string, material: string, image?: ImageInput): Promise<any> {
  const content: Anthropic.ContentBlockParam[] = [];
  if (image) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: image.mediaType as any, data: image.data },
    });
  }
  content.push({
    type: 'text',
    text: `Source (${sourceLabel}):\n\n${material || 'Read the recipe from the attached photo.'}`,
  });

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: `You convert recipes into a strict JSON schema for a Cooking for
Engineers-style tabular renderer, where ingredients are tree leaves and each
step merges its inputs.\n\nSchema:\n${SCHEMA_DOC}\n\n${RULES}`,
    messages: [{ role: 'user', content }],
  });
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .replace(/```json|```/g, '')
    .trim();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      'The model returned malformed JSON (the recipe may be unusually long). Try again, or paste the recipe text directly.',
    );
  }
}

/* ---------- handler ---------- */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { url, text, image, imageMediaType } = req.body ?? {};
  if (!url && !text && !image) return res.status(400).json({ error: 'Provide url, text, or image.' });

  try {
    let material = text as string | undefined;
    let extractedFrom = 'pasted text';
    let img: ImageInput | undefined;
    let sourceNutrition: ReturnType<typeof parseSourceNutrition> = null;

    if (image) {
      extractedFrom = 'photo';
      material = '';
      img = { mediaType: typeof imageMediaType === 'string' ? imageMediaType : 'image/jpeg', data: image };
    } else if (url) {
      // Fail fast if the page hangs (paywalled/bot-blocking sites often stall)
      // so the request returns a clean message instead of timing out.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 9000);
      let page: Response;
      try {
        page = await fetch(url, {
          headers: {
            // some blogs 403 the default fetch UA; a browser UA usually passes
            'user-agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
            accept: 'text/html',
          },
          signal: controller.signal,
        });
      } catch {
        return res.status(422).json({
          error:
            "Couldn't reach that page — it may be slow, paywalled, or blocking automated requests (NYT Cooking, some Cloudflare sites). Paste the recipe text instead.",
        });
      } finally {
        clearTimeout(timer);
      }
      if (!page.ok) {
        return res.status(422).json({
          error: `Couldn't fetch that page (HTTP ${page.status}) — likely paywalled or blocking bots. Paste the recipe text instead.`,
        });
      }
      const html = await page.text();
      const ld = extractJsonLd(html);
      if (ld) {
        extractedFrom = 'schema.org JSON-LD';
        sourceNutrition = parseSourceNutrition(ld.nutrition);
        material = JSON.stringify({
          name: ld.name,
          description: ld.description,
          recipeYield: ld.recipeYield,
          prepTime: ld.prepTime,
          cookTime: ld.cookTime,
          totalTime: ld.totalTime,
          recipeIngredient: ld.recipeIngredient,
          recipeInstructions: instructionsToText(ld.recipeInstructions),
        });
      } else if (SOCIAL.test(url)) {
        // Instagram/TikTok/etc. don't share recipe data — the best we can read
        // is the post caption from the Open Graph preview tags.
        const caption = [metaContent(html, 'og:title'), metaContent(html, 'og:description')]
          .filter(Boolean)
          .join('\n');
        if (caption.trim().length < 40) {
          return res.status(422).json({
            error:
              "Instagram and TikTok don't share the recipe with apps — it's usually in the video or behind a login. Copy the caption (the text under the reel) and paste it in the box below.",
          });
        }
        extractedFrom = 'social post caption';
        material = caption;
      } else {
        extractedFrom = 'page text (no JSON-LD found)';
        material = stripHtml(html);
      }
    }

    let recipe = await convert(extractedFrom, material ?? '', img);

    // one repair pass if the tree is invalid (text-only — the model already
    // read the photo, and it now just needs to fix the tree structure)
    let problem = validateRecipe(recipe);
    if (problem) {
      recipe = await convert(
        extractedFrom,
        `${material}\n\nYour previous attempt failed validation: "${problem}". ` +
          `Previous attempt:\n${JSON.stringify(recipe)}\n\nFix it. Remember the contiguity rule.`,
      );
      problem = validateRecipe(recipe);
      if (problem) {
        return res.status(422).json({ error: `Conversion failed validation: ${problem}`, draft: recipe });
      }
    }

    // Tags live in their own column, not in the recipe tree — lift them out.
    const tags = Array.isArray(recipe.tags)
      ? recipe.tags.filter((t: any) => typeof t === 'string' && t.trim()).map((t: string) => t.trim().toLowerCase())
      : [];
    delete recipe.tags;

    return res.status(200).json({ recipe, tags, source: url ?? null, extractedFrom, nutrition: sourceNutrition });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}
