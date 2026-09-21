import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import agents from "agents/vite";

// LOCAL_ONLY=1 skips remote bindings (Workers AI), for accounts without a workers.dev subdomain.
const remoteBindings = process.env.LOCAL_ONLY !== "1";

export default defineConfig({
  plugins: [agents(), react(), cloudflare({ remoteBindings }), tailwindcss()]
});
