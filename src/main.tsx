import "@/index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { createRouter, RouterProvider } from "@tanstack/react-router";
import { ConvexProvider, ConvexReactClient } from "convex/react";

import { env } from "@/lib/env.ts";
import { routeTree } from "@/routeTree.gen.ts";

const convex = new ConvexReactClient(env.VITE_CONVEX_URL);
const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexProvider client={convex}>
      <RouterProvider router={router} />
    </ConvexProvider>
  </StrictMode>
);
