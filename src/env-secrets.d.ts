// Optional secrets are not in wrangler.jsonc, so `wrangler types` can't see them.
// With a local `.dev.vars` present it *can*, and emits `RADAR_TOKEN: string` (required) into
// env.d.ts — a machine-local artifact. Move `.dev.vars` aside before `npm run types`.
declare namespace Cloudflare {
  interface Env {
    RADAR_TOKEN?: string;
  }
}
interface Env {
  RADAR_TOKEN?: string;
}
