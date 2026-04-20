import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/",
  build: {
    outDir: "dist",
  },
  define: {
    // Allow VITE_REGISTRY_URL env var override at build time
    __REGISTRY_URL__: JSON.stringify(
      process.env.VITE_REGISTRY_URL ?? "https://registry.physical-mind.ai"
    ),
  },
});
