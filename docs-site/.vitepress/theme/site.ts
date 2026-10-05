/**
 * The one place the docs site names the deployed app.
 *
 * It matches `og:url` in the root `index.html`. Until the app is deployed this
 * origin does not answer, and everything that calls it (only `TryIt.vue`)
 * falls back to a recorded example — so the site is never wrong, just offline.
 */
export const SITE_URL = "https://cf-ai-isitme.patelkashishpatel032.workers.dev";

export const REPO_URL = "https://github.com/MrKuros/isitme";
