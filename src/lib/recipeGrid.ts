// Grid computation — the Cooking-for-Engineers rowspan math, derived from the
// recipe tree. Ingredients are leaves; each step merges its inputs. Every
// rowspan is computed here — nothing is hand-positioned. The one hard
// constraint: each step's transitive ingredient set must be a contiguous block
// of rows (list ingredients in the order they enter the pot).

import type { Recipe, Step } from '../data/recipe';

export type Span = { step: Step; min: number; max: number; count: number };

export function buildGrid(recipe: Recipe): Span[] {
  if (!recipe || !Array.isArray(recipe.ingredients) || !Array.isArray(recipe.steps))
    throw new Error('Recipe needs "ingredients" and "steps" arrays.');

  const leafIdx: Record<string, number> = {};
  recipe.ingredients.forEach((g, i) => {
    if (!g.id) throw new Error(`Ingredient ${i + 1} is missing an "id".`);
    if (leafIdx[g.id] !== undefined) throw new Error(`Duplicate ingredient id "${g.id}".`);
    leafIdx[g.id] = i;
  });

  const stepById: Record<string, Step> = {};
  recipe.steps.forEach((s) => {
    if (!s.id) throw new Error('Every step needs an "id".');
    stepById[s.id] = s;
  });

  const memo: Record<string, number[]> = {};
  const visiting: Record<string, boolean> = {};
  function leaves(sid: string): number[] {
    if (memo[sid]) return memo[sid];
    if (visiting[sid]) throw new Error(`Steps form a loop at "${sid}".`);
    visiting[sid] = true;
    const s = stepById[sid];
    let out: number[] = [];
    for (const inp of s.inputs || []) {
      if (inp in leafIdx) out.push(leafIdx[inp]);
      else if (stepById[inp]) out = out.concat(leaves(inp));
      else throw new Error(`Step "${sid}" refers to unknown input "${inp}".`);
    }
    out = [...new Set(out)].sort((a, b) => a - b);
    visiting[sid] = false;
    memo[sid] = out;
    return out;
  }

  return recipe.steps.map((s) => {
    const L = leaves(s.id);
    if (!L.length) throw new Error(`Step "${s.id}" has no ingredients under it.`);
    const min = L[0];
    const max = L[L.length - 1];
    if (max - min + 1 !== L.length)
      throw new Error(
        `Step "${s.id}" (${s.verb || s.id}) covers a broken block of rows. Reorder the ingredient list so everything this step touches sits together.`,
      );
    return { step: s, min, max, count: max - min + 1 };
  });
}

/* ---------- quantity + clock formatting ---------- */
const EIGHTHS = ['', '1/8', '1/4', '3/8', '1/2', '5/8', '3/4', '7/8'];

export function frac(x: number): string {
  let w = Math.floor(x + 1e-6);
  let e = Math.round((x - w) * 8);
  if (e === 8) {
    w++;
    e = 0;
  }
  const s = (w ? w : '') + (w && e ? ' ' : '') + EIGHTHS[e];
  return s || '0';
}

export const metricRound = (v: number): number =>
  v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;

export const fmtClock = (n: number): string =>
  Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0');

export function beep(): void {
  try {
    const AudioCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtor();
    [0, 0.35, 0.7].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.28);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.3);
    });
  } catch {
    /* audio unavailable — fail silent */
  }
}
