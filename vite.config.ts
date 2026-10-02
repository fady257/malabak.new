import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    target: "es2022",
    sourcemap: false,
    assetsInlineLimit: 4096,
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
    strictPort: true,
  },
});
