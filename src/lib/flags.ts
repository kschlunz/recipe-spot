// Feature flags.
//
// FAVORITES_ENABLED: the recipe "heart" favorites feature. The recipes API
// reads `favorite` with a graceful fallback, so this is safe to leave on even
// if the column somehow isn't present (hearts just won't persist until it is).
export const FAVORITES_ENABLED: boolean = true;
