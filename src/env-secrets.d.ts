// Optional secrets are not in wrangler.jsonc, so `wrangler types` can't see them.
declare namespace Cloudflare {
  interface Env {
    RADAR_TOKEN?: string;
  }
}
interface Env {
  RADAR_TOKEN?: string;
}
