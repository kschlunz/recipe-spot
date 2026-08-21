-- Recipe Spot · Supabase schema
-- Run this once in the Supabase SQL editor. Reads and writes all flow through
-- the Vercel serverless functions using the service-role key, so RLS is enabled
-- with no public policies.

create table if not exists public.recipes (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  title       text not null,
  data        jsonb not null,          -- the full recipe in the shared schema
  source_url  text,
  tags        text[] default '{}',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists recipes_title_idx
  on public.recipes using gin (to_tsvector('simple', title));

-- Optional dish photo per recipe (uploaded to the recipe-photos bucket below).
alter table public.recipes add column if not exists photo_url text;

-- Household favorite flag (the heart on cards and the recipe page).
alter table public.recipes add column if not exists favorite boolean not null default false;

-- Estimated per-serving nutrition: { calories, protein, carbs, fat }.
alter table public.recipes add column if not exists nutrition jsonb;

-- Estimated total grocery cost to make the recipe, in USD.
alter table public.recipes add column if not exists cost numeric;

-- Public storage bucket for dish photos. Uploads happen through the serverless
-- functions with the service-role key; reads are public.
insert into storage.buckets (id, name, public)
values ('recipe-photos', 'recipe-photos', true)
on conflict (id) do nothing;

drop policy if exists "Public read recipe photos" on storage.objects;
create policy "Public read recipe photos" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'recipe-photos');

-- Row level security: enabled with NO public policies. The anon/authenticated
-- browser client cannot read or write; only the service-role key (used by the
-- serverless functions) bypasses RLS.
alter table public.recipes enable row level security;

-- keep updated_at current on writes
create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists recipes_touch_updated_at on public.recipes;
create trigger recipes_touch_updated_at
  before update on public.recipes
  for each row execute function public.touch_updated_at();

-- Seed row one: The Stew.
insert into public.recipes (slug, title, tags, data)
values (
  'the-stew',
  'The Stew',
  array['weeknight', 'vegetarian', 'one-pot'],
  '{
    "title": "The Stew",
    "eyebrow": "One pot · vegetarian · reheats better than it cooks",
    "tagline": "Spiced chickpeas with coconut, turmeric, and whatever greens you have.",
    "serves": 4,
    "active": "20 min",
    "total": "55 min",
    "vessel": "Dutch oven",
    "prep": "Set a large Dutch oven over medium-high heat",
    "ingredients": [
      { "id": "oil", "name": "olive oil", "note": "plus more for drizzling", "us": { "q": 0.25, "u": "cup" }, "metric": { "q": 60, "u": "mL" } },
      { "id": "onion", "name": "yellow onion", "note": "chopped", "us": { "q": 1, "u": "large" }, "metric": { "q": 300, "u": "g" } },
      { "id": "ginger", "name": "fresh ginger", "note": "finely chopped", "us": { "q": 1, "u": "Tbs" }, "metric": { "q": 15, "u": "g" } },
      { "id": "garlic", "name": "garlic", "note": "minced", "us": { "q": 4, "u": "cloves" }, "metric": { "q": 12, "u": "g" } },
      { "id": "turmeric", "name": "ground turmeric", "us": { "q": 1.5, "u": "tsp" }, "metric": { "q": 5, "u": "g" } },
      { "id": "chili", "name": "crushed red pepper", "note": "optional", "us": { "q": 0.5, "u": "tsp" }, "metric": { "q": 1, "u": "g" } },
      { "id": "chickpeas", "name": "chickpeas", "note": "15 oz each · drained and rinsed", "us": { "q": 2, "u": "cans" }, "metric": { "q": 850, "u": "g" } },
      { "id": "coconut", "name": "full-fat coconut milk", "note": "15 oz each", "us": { "q": 2, "u": "cans" }, "metric": { "q": 800, "u": "mL" } },
      { "id": "stock", "name": "vegetable stock", "us": { "q": 2, "u": "cups" }, "metric": { "q": 480, "u": "mL" } },
      { "id": "salt", "name": "kosher salt", "note": "then taste", "us": { "q": 1.5, "u": "tsp" }, "metric": { "q": 9, "u": "g" } },
      { "id": "pepper", "name": "black pepper", "us": { "q": 0.5, "u": "tsp" }, "metric": { "q": 1, "u": "g" } },
      { "id": "kale", "name": "kale leaves", "note": "torn · chard or collards work too", "us": { "q": 2, "u": "cups" }, "metric": { "q": 100, "u": "g" } },
      { "id": "mint", "name": "mint leaves", "note": "or cilantro", "us": { "q": 1, "u": "cup" }, "metric": { "q": 25, "u": "g" } },
      { "id": "serve", "name": "yogurt and pita", "note": "to serve" }
    ],
    "steps": [
      { "id": "s1", "verb": "cook onion", "detail": "5–6 min", "seconds": 330, "title": "Soften the onion", "inputs": ["oil", "onion"] },
      { "id": "s2", "verb": "toast spices", "detail": "2 min · stir often", "seconds": 120, "title": "Toast ginger, garlic, turmeric, chili", "inputs": ["s1", "ginger", "garlic", "turmeric", "chili"] },
      { "id": "s3", "verb": "fry, then crush", "detail": "8–10 min · reserve 1 cup", "seconds": 540, "title": "Fry the chickpeas, then crush them", "inputs": ["s2", "chickpeas"] },
      { "id": "s4", "verb": "scrape, lid on, simmer", "detail": "25–30 min · medium-low", "seconds": 1650, "title": "Simmer with the lid on", "inputs": ["s3", "coconut", "stock", "salt", "pepper"] },
      { "id": "s5", "verb": "wilt", "detail": "5 min", "seconds": 300, "title": "Wilt the greens", "inputs": ["s4", "kale"] },
      { "id": "s6", "verb": "ladle", "detail": "garnish · serve", "seconds": 0, "title": "Garnish and serve", "inputs": ["s5", "mint", "serve"] }
    ],
    "notes": [
      { "h": "Crush the chickpeas", "p": "Press a good third of them against the side of the pot with a wooden spoon. The released starch is the entire thickening mechanism — skip it and you have soup." },
      { "h": "Season in layers", "p": "Salt at every stage. This version front-loads less, so taste before serving. If you are not using Diamond Crystal, start with a third less." },
      { "h": "Simmer to your thickness", "p": "It starts soupy and tightens over about half an hour. Pull it early for brothy, push it longer for spoon-standing." },
      { "h": "Full fat only", "p": "Light coconut milk splits and thins out. Two cans of the real thing is what makes the body." },
      { "h": "Make ahead", "p": "Cook through the simmer, then stop. Add greens only when you reheat — they go grey and slack if they sit in the pot." },
      { "h": "Keeping", "p": "Five days in the fridge, two months frozen. Thaw overnight, reheat gently, add a splash of stock to loosen." }
    ],
    "credit": "Adapted from Alison Roman''s spiced chickpea stew with coconut and turmeric. Laid out in the tabular style of Michael Chu''s Cooking for Engineers."
  }'::jsonb
)
on conflict (slug) do nothing;

-- Weekly meal plan. Each day can hold a free-text note ("Kate grills chicken",
-- "leftovers", "eat out") AND any number of recipes. The note lives in
-- meal_plan (one row per day); the recipes live in meal_plan_recipes (many rows
-- per day). Persistent until cleared.
-- (Run this block too if you already created the recipes table earlier.)
create table if not exists public.meal_plan (
  day         text primary key check (day in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')),
  recipe_slug text references public.recipes(slug) on delete set null,
  note        text,
  servings    integer,   -- legacy day-level servings; recipe servings now live on meal_plan_recipes
  updated_at  timestamptz default now()
);

-- RLS on, no public policies: all access flows through the serverless functions.
alter table public.meal_plan enable row level security;

-- One row per recipe planned on a day. Multiple recipes per day are allowed
-- (dinner + a dessert, say). Each carries its own target servings.
create table if not exists public.meal_plan_recipes (
  id          uuid primary key default gen_random_uuid(),
  day         text not null check (day in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')),
  recipe_slug text not null references public.recipes(slug) on delete cascade,
  servings    integer,   -- target servings for this dish; null = the recipe's own serves
  position    integer default 0,
  created_at  timestamptz default now()
);
create index if not exists meal_plan_recipes_day_idx
  on public.meal_plan_recipes(day, position, created_at);
alter table public.meal_plan_recipes enable row level security;

-- Migrate existing single-recipe days into the new list table. Idempotent:
-- only inserts a (day, recipe) pair that isn't already there.
insert into public.meal_plan_recipes (day, recipe_slug, servings, position)
select mp.day, mp.recipe_slug, mp.servings, 0
from public.meal_plan mp
where mp.recipe_slug is not null
  and not exists (
    select 1 from public.meal_plan_recipes r
    where r.day = mp.day and r.recipe_slug = mp.recipe_slug
  );

-- Shared shopping-list checkmarks: which items are ticked off, by normalized
-- name key. Shared across the household so both people see the same state.
create table if not exists public.shopping_checked (
  item_key   text primary key,
  checked_at timestamptz default now()
);
alter table public.shopping_checked enable row level security;

-- Cooking log: a running history of meals actually cooked, checked off from the
-- weekly plan. Kept deliberately separate from favorites, and persistent — it
-- survives clearing the week and even deleting the recipe (title is snapshotted,
-- recipe_slug is not a foreign key). item_id links back to the meal_plan_recipes
-- row it was checked from, so un-checking on the calendar can remove it.
create table if not exists public.cook_log (
  id          uuid primary key default gen_random_uuid(),
  recipe_slug text not null,
  title       text,
  cooked_on   date not null default (now() at time zone 'utc')::date,
  item_id     uuid,   -- the meal_plan_recipes row it was checked from (nullable)
  day         text,   -- which day it was planned on, for context (nullable)
  created_at  timestamptz not null default now()
);
create index if not exists cook_log_cooked_on_idx on public.cook_log (cooked_on desc, created_at desc);
create index if not exists cook_log_item_idx on public.cook_log (item_id);
alter table public.cook_log enable row level security;

-- Cook notes: a timestamped log per recipe ("added more garlic, +5 min").
create table if not exists public.cook_notes (
  id          uuid primary key default gen_random_uuid(),
  recipe_slug text not null references public.recipes(slug) on delete cascade,
  body        text not null,
  created_at  timestamptz default now()
);
create index if not exists cook_notes_slug_idx on public.cook_notes(recipe_slug, created_at desc);
alter table public.cook_notes enable row level security;

-- If you created meal_plan from an earlier version, run these to bring it up to
-- date. Safe to run more than once.
alter table public.meal_plan alter column recipe_slug drop not null;
alter table public.meal_plan add column if not exists note text;
alter table public.meal_plan add column if not exists servings integer;
alter table public.meal_plan drop constraint if exists meal_plan_recipe_slug_fkey;
alter table public.meal_plan add constraint meal_plan_recipe_slug_fkey
  foreign key (recipe_slug) references public.recipes(slug) on delete set null;
