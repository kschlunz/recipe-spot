import { useEffect, useMemo, useRef, useState } from 'react';
import type { Recipe, Ingredient } from '../data/recipe';
import { beep, buildGrid, fmtClock, frac, metricRound, type Span } from '../lib/recipeGrid';

type Props = {
  recipe: Recipe;
};

// The tabular renderer: a read + cook view for a single recipe. Every rowspan
// is computed by buildGrid from the recipe tree.
export default function RecipeView({ recipe }: Props) {
  const [mult, setMult] = useState(1);
  const [units, setUnits] = useState<'us' | 'si'>('us');
  const [struck, setStruck] = useState<Set<string>>(() => new Set());
  const [step, setStep] = useState(-1);
  const [remain, setRemain] = useState<number | null>(null); // null = no timer, -1 = rung
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const grid = useMemo(() => {
    try {
      return { spans: buildGrid(recipe) as Span[], err: null as string | null };
    } catch (e) {
      return { spans: null as Span[] | null, err: (e as Error).message };
    }
  }, [recipe]);

  // A new recipe resets cook state.
  useEffect(() => {
    setStruck(new Set());
    setStep(-1);
    setMult(1);
  }, [recipe]);

  const cooking = step >= 0;
  const spans = grid.spans || [];
  const nRows = recipe.ingredients.length;
  const nCols = spans.length;

  /* timer */
  useEffect(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (!cooking) {
      setRemain(null);
      return;
    }
    const sec = spans[step]?.step.seconds || 0;
    if (!sec) {
      setRemain(null);
      return;
    }
    setRemain(sec);
    tickRef.current = setInterval(() => {
      setRemain((r) => {
        if (r === null || r <= 1) {
          if (tickRef.current) clearInterval(tickRef.current);
          tickRef.current = null;
          if (r !== null && r <= 1) beep();
          return -1;
        }
        return r - 1;
      });
    }, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, cooking]);

  const goTo = (i: number) => setStep(Math.max(0, Math.min(nCols - 1, i)));
  const exitCook = () => setStep(-1);

  const qtyFor = (g: Ingredient): string | null => {
    const pick = units === 'us' ? g.us || g.metric : g.metric || g.us;
    if (!pick || !pick.q) return null;
    const isUS = pick === g.us;
    return isUS
      ? frac(pick.q * mult) + ' ' + (pick.u || '')
      : metricRound(pick.q * mult) + ' ' + (pick.u || '');
  };

  const hotRows = cooking && spans[step] ? [spans[step].min, spans[step].max] : null;
  const rowHot = (r: number) => hotRows && r >= hotRows[0] && r <= hotRows[1];

  type Cell =
    | { kind: 'gap'; key: string; rowSpan: number }
    | { kind: 'step'; key: string; sp: Span; j: number; rowSpan: number };

  /* build cell layout: for each column, a step cell at min plus gap runs */
  const cellsAt = (r: number): Cell[] => {
    const out: Cell[] = [];
    spans.forEach((sp, j) => {
      if (r === 0 && sp.min > 0) out.push({ kind: 'gap', key: `g-top-${j}`, rowSpan: sp.min });
      if (r === sp.min) out.push({ kind: 'step', key: sp.step.id, sp, j, rowSpan: sp.count });
      if (r === sp.max + 1 && sp.max < nRows - 1)
        out.push({ kind: 'gap', key: `g-bot-${j}`, rowSpan: nRows - 1 - sp.max });
    });
    return out;
  };

  const servesOpts = [0.5, 1, 1.5].map((m) => ({ m, label: Math.round((recipe.serves || 4) * m) }));

  return (
    <div className="rg-root">
      {recipe.eyebrow && <p className="eyebrow">{recipe.eyebrow}</p>}
      <h1>{recipe.title}</h1>
      {recipe.tagline && <p className="deck">{recipe.tagline}</p>}
      <p className="meta">
        <span>
          Serves <b>{Math.round((recipe.serves || 4) * mult)}</b>
        </span>
        {recipe.active && (
          <span>
            Active <b>{recipe.active}</b>
          </span>
        )}
        {recipe.total && (
          <span>
            Total <b>{recipe.total}</b>
          </span>
        )}
        {recipe.vessel && (
          <span>
            Vessel <b>{recipe.vessel}</b>
          </span>
        )}
      </p>

      <div className="controls">
        <div className="group">
          <span>Serves</span>
          {servesOpts.map((o) => (
            <button key={o.m} aria-pressed={mult === o.m} onClick={() => setMult(o.m)}>
              {o.label}
            </button>
          ))}
        </div>
        <div className="group">
          <span>Units</span>
          <button aria-pressed={units === 'us'} onClick={() => setUnits('us')}>
            US
          </button>
          <button aria-pressed={units === 'si'} onClick={() => setUnits('si')}>
            Metric
          </button>
        </div>
        <div className="group grow">
          <button className="go" onClick={() => goTo(0)} disabled={!!grid.err}>
            Start cooking
          </button>
        </div>
      </div>

      {grid.err && (
        <div className="json-panel">
          <p className="json-err">{grid.err}</p>
        </div>
      )}

      {cooking && spans[step] && (
        <div className="stage-bar">
          <span className="stage-n">
            Stage {step + 1} of {nCols}
          </span>
          <span className="stage-t">{spans[step].step.title || spans[step].step.verb}</span>
          <button onClick={() => goTo(step - 1)}>Back</button>
          <button onClick={() => goTo(step + 1)}>Next</button>
          <button onClick={exitCook}>Exit</button>
          <span className={'clock' + (remain === -1 ? ' ring' : '')}>
            {remain === null ? 'no timer' : remain === -1 ? 'time' : fmtClock(remain)}
          </span>
        </div>
      )}

      {!grid.err && (
        <div className="scroll">
          <table className={cooking ? 'dim' : ''} style={{ minWidth: 560 + nCols * 96 }}>
            <colgroup>
              <col style={{ width: '29%' }} />
              {spans.map((_, j) => (
                <col key={j} style={{ width: 71 / nCols + '%' }} />
              ))}
            </colgroup>
            <tbody>
              {recipe.prep && (
                <tr>
                  <td className="prep" colSpan={nCols + 1}>
                    {recipe.prep}
                  </td>
                </tr>
              )}
              {recipe.ingredients.map((g, r) => {
                const q = qtyFor(g);
                return (
                  <tr key={g.id} className={rowHot(r) ? 'hot' : ''}>
                    <td
                      className={'ing' + (struck.has(g.id) ? ' off' : '')}
                      onClick={() => {
                        const next = new Set(struck);
                        if (next.has(g.id)) next.delete(g.id);
                        else next.add(g.id);
                        setStruck(next);
                      }}
                    >
                      {q && <span className="q">{q}</span>}
                      {q ? ' ' : ''}
                      {g.name}
                      {g.note && <span className="note"> — {g.note}</span>}
                    </td>
                    {cellsAt(r).map((c) =>
                      c.kind === 'gap' ? (
                        <td key={c.key} className="gap" rowSpan={c.rowSpan} />
                      ) : (
                        <td
                          key={c.key}
                          className={'op' + (cooking && step === c.j ? ' hot' : '')}
                          rowSpan={c.rowSpan}
                          onClick={() => goTo(c.j)}
                        >
                          <b>{c.sp.step.verb}</b>
                          {c.sp.step.detail && <span>{c.sp.step.detail}</span>}
                        </td>
                      ),
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {recipe.notes && recipe.notes.length > 0 && (
        <section className="notes">
          <h2>Notes from the pot</h2>
          <div className="grid">
            {recipe.notes.map((n, i) => (
              <div className="note-item" key={i}>
                <h3>{n.h}</h3>
                <p>{n.p}</p>
              </div>
            ))}
          </div>
          {recipe.credit && <p className="credit">{recipe.credit}</p>}
        </section>
      )}
    </div>
  );
}
