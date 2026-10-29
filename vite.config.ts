import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** Kennzeichnet den Tab im Dev-Server, damit er nicht mit der Live-Version verwechselt wird. */
function devTitle(): Plugin {
  return {
    name: "dev-title",
    apply: "serve",
    transformIndexHtml(html) {
      return html.replace(/<title>(.*?)<\/title>/, "<title>$1 - DEV</title>");
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [tanstackRouter({ target: "react" }), react(), tailwindcss(), devTitle()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
      "@convex": resolve(import.meta.dirname, "./convex"),
    },
  },
});
