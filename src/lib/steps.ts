// Split verbatim recipe steps that arrived as one blob with inline numbering
// ("1. Do this 2. Then that 3. …") into separate steps. Some sources (esp.
// social captions) give all instructions as a single string with no line breaks.
// No lookbehind is used, so it's safe on older Safari.

const MARKER = /\d{1,2}[.)]\s+/g;

function splitInlineSteps(s: string): string[] {
  const stripLead = (x: string) => x.replace(/^\s*\d{1,2}[.)]\s+/, '').trim();

  // Find "N." / "N)" markers that start a step: a 1–2 digit number NOT preceded
  // by another digit (so "350." or "1.5" isn't a false marker).
  const cuts: Array<[number, number]> = [];
  MARKER.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARKER.exec(s)) !== null) {
    const prev = m.index > 0 ? s[m.index - 1] : '';
    if (/\d/.test(prev)) continue; // part of a larger number, not a step marker
    cuts.push([m.index, m.index + m[0].length]);
  }
  if (cuts.length < 2) return [stripLead(s)].filter(Boolean);

  const parts: string[] = [];
  let cursor = 0;
  for (const [start, end] of cuts) {
    parts.push(s.slice(cursor, start));
    cursor = end;
  }
  parts.push(s.slice(cursor));
  return parts.map((p) => stripLead(p)).filter(Boolean);
}

// Normalize a list of verbatim steps, splitting any inline-numbered blobs.
export function splitSteps(steps: string[]): string[] {
  return (steps ?? []).flatMap((s) => splitInlineSteps(String(s)));
}
