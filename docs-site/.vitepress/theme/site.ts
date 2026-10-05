/**
 * The one place the docs site names the deployed app.
 *
 * It matches `og:url` in the root `index.html`. Everything that calls it (only
 * `TryIt.vue`) falls back to a recorded example if the request fails, so the
 * site stays correct even when the app is unreachable.
 */
export const SITE_URL = "https://cf-ai-isitme.patelkashishpatel032.workers.dev";

export const REPO_URL = "https://github.com/MrKuros/isitme";
