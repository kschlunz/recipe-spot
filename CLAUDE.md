# Recipe.Spot

A household recipe app for two people sharing one set of data: save recipes, plan the week, build a shopping list, cook from it. Used mostly on phones, installed to the home screen.

## Tech stack

- React 18 + TypeScript, built with Vite. Hash routing in `src/App.tsx` (`#/plan`, `#/r/<slug>`); no router library.
- Tailwind is imported, but almost all styling is hand-written classes in `src/index.css`.
- Vercel serverless functions in `api/`, one file per endpoint.
- Supabase: Postgres plus a public `recipe-photos` storage bucket.
- Anthropic SDK for recipe import, nutrition, cost, plan suggestions, fridge matching and reading day notes. The model ID is a constant at the top of each `api/` file that uses one.

## Layout

- `src/components/` — one file per screen (`IndexScreen`, `RecipePage`, `PlanScreen`, `ShoppingScreen`, `FridgeScreen`, `TripScreen`, `CookedScreen`, `ImportScreen`) plus small shared pieces.
- `src/hooks/` — data hooks that wrap the API (`useRecipes`, `useMealPlan`, `useTrip`, `useStaples`, …).
- `src/lib/` — pure helpers (`recipeGrid`, `heat`, `pickup`, `walmart`, `tags`, `share`).
- `src/data/recipe.ts` — the `Recipe` type: ingredients are leaves, each step lists its inputs.
- `api/` — serverless functions. Each has a header comment listing its routes.
- `supabase-schema.sql` — every table, safe to re-run.

## Things to know before changing anything

- **The API has 12 functions, which is the Vercel Hobby limit.** Do not add a file to `api/`. Fold a new endpoint into an existing function behind a `?resource=` switch and add a rewrite in `vercel.json`, the way `/api/shopping-checks` and `/api/shopping-staples` route into `api/shopping.ts`.
- **Database changes are manual.** Nothing runs migrations. Add the table to `supabase-schema.sql` with `create table if not exists`, and tell the user to run that block in Supabase → SQL Editor. Until they do, the feature must degrade instead of breaking the page: return `needsSetup: true` when the table is missing and show the setup notice (see the trip planner and staples).
- **All data access goes through the API with the service-role key.** RLS is on with no public policies, so the browser never talks to Supabase directly and no env var needs a `VITE_` prefix.
- **There is no login.** The API does not check who is calling. Do not add anything that would be dangerous for a stranger with the URL to reach, and do not assume a user identity exists.
- **State is shared by the household.** Checkmarks, the plan, staples and the trip are single shared boards, not per-user. Hooks update optimistically, reload on failure, and refresh when the app regains focus (`useRefreshOnFocus`).
- **`api/` cannot import from `src/`.** Keep shared logic on one side; where both need a value (such as an item key), compute it in the browser and send it.

## Design

- Paper-and-ink look: off-white background, near-black rules, turmeric and kale green accents. Colors are CSS variables at the top of `src/index.css`; use them instead of new hex values.
- Bricolage Grotesque for headings, Space Mono for labels, buttons and amounts, Instrument Sans for body text.
- Square corners, 2px borders, no shadows except the card hover.
- Check every screen at phone width. Rows and headers must wrap, never scroll sideways.

## Working here

- `npm run build` type-checks the app and the API, then builds. Run it before committing.
- `npm run dev` serves the front end only; `/api` routes do not exist locally, so test UI against mocked responses.
- There is no test suite or CI.
- Merging to `main` deploys to production on Vercel.
