import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import adminApi from "./vite-plugins/admin-api";

export default defineConfig({
  plugins: [react(), adminApi()],
  server: {
    port: 8888,
    strictPort: true,
  },
});
