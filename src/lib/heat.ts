// Cooking heat: display formatting, a rough level→temp map, and carry-forward.

const HEAT_TEMPS: Record<string, string> = {
  'medium-high': '~400°F',
  'medium high': '~400°F',
  'medium-low': '~300°F',
  'medium low': '~300°F',
  high: '~450°F',
  medium: '~350°F',
  low: '~250°F',
};
// Longest/most specific levels first so "medium-high" wins over "high"/"medium".
const LEVELS = ['medium-high', 'medium high', 'medium-low', 'medium low', 'high', 'medium', 'low'];

// Turn raw heat into a display string, appending an approximate temperature for
// vague levels ("medium-high" → "medium-high (~400°F)"). Leaves explicit temps
// and cues untouched.
export function formatHeat(heat: string): string {
  const h = heat.trim();
  if (!h) return '';
  if (/\d\s*°|\d\s*deg|\bF\b|\bC\b/i.test(h)) return h; // already an explicit temp
  const key = h.toLowerCase();
  for (const lvl of LEVELS) {
    if (key.includes(lvl)) return `${h} (${HEAT_TEMPS[lvl]})`;
  }
  return h;
}

// Parse a timer (seconds) from a verbatim step's text — the lower bound of the
// first duration it mentions ("45 to 55 minutes" → 45 min, "1 hour" → 3600).
// Returns 0 when there's no clear duration.
export function parseDurationSeconds(text: string): number {
  if (!text) return 0;
  const t = text.toLowerCase();
  let m = t.match(/(\d+(?:\.\d+)?)\s*(?:to|through|–|—|-)?\s*(?:\d+(?:\.\d+)?)?\s*(?:hours?|hrs?)\b/);
  if (m) return Math.round(parseFloat(m[1]) * 3600);
  m = t.match(/(\d+(?:\.\d+)?)\s*(?:to|through|–|—|-)?\s*(?:\d+(?:\.\d+)?)?\s*(?:minutes?|mins?)\b/);
  if (m) return Math.round(parseFloat(m[1]) * 60);
  m = t.match(/(\d+)\s*(?:to|through|–|—|-)?\s*(?:\d+)?\s*(?:seconds?|secs?)\b/);
  if (m) return parseInt(m[1], 10);
  return 0;
}

// Does a step apply heat, judged from its wording? Used only for carry-forward.
const COOK_RE =
  /\b(grill|sear|roast|broil|bake|fry|saut|simmer|boil|char|toast|griddle|braise|poach|steam|blister|crisp|cook|heat|preheat)\b/i;
export function isCookingStep(s: { verb?: string; title?: string; detail?: string }): boolean {
  return COOK_RE.test(`${s.verb ?? ''} ${s.title ?? ''} ${s.detail ?? ''}`);
}

// Effective heat for each step: its own if stated, else the last stated heat
// when the step looks like a cooking step (so a later grill step that doesn't
// restate the heat still shows it). Returns a parallel array.
export function effectiveHeats(
  steps: { heat?: string; verb?: string; title?: string; detail?: string }[],
): (string | null)[] {
  let last = '';
  return steps.map((s) => {
    if (s.heat && s.heat.trim()) {
      last = s.heat.trim();
      return last;
    }
    if (last && isCookingStep(s)) return last;
    return null;
  });
}
