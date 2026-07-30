// Feature flags.
//
// FAVORITES_ENABLED: the recipe "heart" favorites feature. Turned OFF until the
// `favorite` column is added to the recipes table (run supabase-schema.sql).
// To re-enable tomorrow: flip this to true AND restore the `favorite` selects in
// api/recipes.ts (see the TODO markers there).
export const FAVORITES_ENABLED: boolean = false;
