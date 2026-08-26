import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import adminApi from "./vite-plugins/admin-api";

// GitHub Pages serves a project site (not a user/org root site) at
// /<repo-name>/ — every asset URL and client fetch needs that prefix in
// production. Dev/preview still run at the server root, so this only takes
// effect for `vite build` (import.meta.env.BASE_URL mirrors this at runtime).
export default defineConfig({
  base: process.env.GITHUB_PAGES ? "/the-winners-circle-hub/" : "/",
  plugins: [react(), adminApi()],
  server: {
    port: 8888,
    strictPort: true,
  },
});
