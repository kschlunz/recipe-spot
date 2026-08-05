import { useEffect, useMemo, useRef, useState } from 'react';
import type { Recipe, Ingredient, Nutrition } from '../data/recipe';
import { beep, buildGrid, fmtClock, frac, metricRound, type Span } from '../lib/recipeGrid';
import { formatHeat } from '../lib/heat';

type Props = {
  recipe: Recipe;
  nutrition?: Nutrition | null;
};

// The tabular renderer: a read + cook view for a single recipe. Every rowspan
// is computed by buildGrid from the recipe tree.
export default function RecipeView({ recipe, nutrition }: Props) {
  const [mult, setMult] = useState(1);
  const [units, setUnits] = useState<'us' | 'si'>('us');
  const [struck, setStruck] = useState<Set<string>>(() => new Set());
  const [step, setStep] = useState(-1);
  const [remain, setRemain] = useState<number | null>(null); // null = no timer, -1 = rung
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasOriginal = !!recipe.sourceSteps?.length;
  // Imported recipes default to the source's exact steps (the grid can misread a
  // recipe); the toggle switches to the tabular grid.
  const [view, setView] = useState<'grid' | 'original'>(hasOriginal ? 'original' : 'grid');

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
    setView(recipe.sourceSteps?.length ? 'original' : 'grid');
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

  const toggleStruck = (id: string) => {
    const next = new Set(struck);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setStruck(next);
  };

  // For the mobile stacked view: the ingredients that first enter the pot at a
  // given step (its leaf inputs), and whether it also folds in an earlier step.
  const ingById = useMemo(() => {
    const m: Record<string, Ingredient> = {};
    recipe.ingredients.forEach((g) => (m[g.id] = g));
    return m;
  }, [recipe]);

  const enteringFor = (sp: Span) => {
    const entering = (sp.step.inputs || []).filter((id) => ingById[id]).map((id) => ingById[id]);
    const carries = (sp.step.inputs || []).some((id) => !ingById[id]);
    return { entering, carries };
  };

  // Heat per step — only what the parser explicitly set (no guessing).
  const heatById = useMemo(() => {
    const m: Record<string, string | null> = {};
    recipe.steps.forEach((s) => (m[s.id] = s.heat && s.heat.trim() ? s.heat.trim() : null));
    return m;
  }, [recipe]);

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

      {nutrition && (
        <div className="nutrition">
          <span className="nl">Per serving</span>
          <span>
            <b>{nutrition.calories}</b> cal
          </span>
          <span>
            <b>{nutrition.protein}g</b> protein
          </span>
          <span>
            <b>{nutrition.carbs}g</b> carbs
          </span>
          <span>
            <b>{nutrition.fat}g</b> fat
          </span>
          <span className="est">{nutrition.source === 'source' ? 'from source' : 'estimated'}</span>
        </div>
      )}

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
        {hasOriginal && (
          <div className="group">
            <span>View</span>
            <button aria-pressed={view === 'original'} onClick={() => setView('original')}>
              Original
            </button>
            <button aria-pressed={view === 'grid'} onClick={() => setView('grid')}>
              Grid
            </button>
          </div>
        )}
        <div className="group grow">
          <button className="go" onClick={() => goTo(0)} disabled={!!grid.err || view === 'original'}>
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
          {heatById[spans[step].step.id] && (
            <span className="stage-heat">🔥 {formatHeat(heatById[spans[step].step.id]!)}</span>
          )}
          <button onClick={() => goTo(step - 1)}>Back</button>
          <button onClick={() => goTo(step + 1)}>Next</button>
          <button onClick={exitCook}>Exit</button>
          <span className={'clock' + (remain === -1 ? ' ring' : '')}>
            {remain === null ? 'no timer' : remain === -1 ? 'time' : fmtClock(remain)}
          </span>
        </div>
      )}

      {view === 'original' && recipe.sourceSteps && (
        <div className="original">
          <section className="stack-block">
            <h2 className="stack-h">Ingredients</h2>
            {recipe.ingredients.map((g) => {
              const q = qtyFor(g);
              return (
                <div
                  key={g.id}
                  className={'stack-ing' + (struck.has(g.id) ? ' off' : '')}
                  onClick={() => toggleStruck(g.id)}
                >
                  {q && <span className="q">{q}</span>}
                  {q ? ' ' : ''}
                  {g.name}
                  {g.note && <span className="note"> — {g.note}</span>}
                </div>
              );
            })}
          </section>
          <section className="stack-block">
            <h2 className="stack-h">Steps</h2>
            <ol className="orig-steps">
              {recipe.sourceSteps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
            <p className="orig-note">Steps shown exactly as the source wrote them.</p>
          </section>
        </div>
      )}

      {view === 'grid' && !grid.err && (
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
                      onClick={() => toggleStruck(g.id)}
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
                          {heatById[c.sp.step.id] && (
                            <span className="op-heat">🔥 {formatHeat(heatById[c.sp.step.id]!)}</span>
                          )}
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

      {view === 'grid' && !grid.err && (
        <div className={'stack' + (cooking ? ' dim' : '')}>
          <section className="stack-block">
            <h2 className="stack-h">Ingredients</h2>
            {recipe.ingredients.map((g, r) => {
              const q = qtyFor(g);
              return (
                <div
                  key={g.id}
                  className={
                    'stack-ing' + (struck.has(g.id) ? ' off' : '') + (rowHot(r) ? ' hot' : '')
                  }
                  onClick={() => toggleStruck(g.id)}
                >
                  {q && <span className="q">{q}</span>}
                  {q ? ' ' : ''}
                  {g.name}
                  {g.note && <span className="note"> — {g.note}</span>}
                </div>
              );
            })}
          </section>

          <section className="stack-block">
            <h2 className="stack-h">Steps</h2>
            <ol className="stack-steps">
              {spans.map((sp, j) => {
                const { entering, carries } = enteringFor(sp);
                return (
                  <li
                    key={sp.step.id}
                    className={'stack-step' + (cooking && step === j ? ' hot' : '')}
                    onClick={() => goTo(j)}
                  >
                    <div className="s-top">
                      <b>{sp.step.verb}</b>
                      {sp.step.detail && <span className="s-detail">{sp.step.detail}</span>}
                      {heatById[sp.step.id] && (
                        <span className="s-heat">🔥 {formatHeat(heatById[sp.step.id]!)}</span>
                      )}
                    </div>
                    {(carries || entering.length > 0) && (
                      <div className="s-ings">
                        {carries && <span className="carry">everything so far</span>}
                        {entering.map((g) => {
                          const q = qtyFor(g);
                          return (
                            <span key={g.id} className="chip">
                              {q && <span className="q">{q}</span>}
                              {q ? ' ' : ''}
                              {g.name}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
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
