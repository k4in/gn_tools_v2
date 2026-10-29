# Frontend Agent Rules

Rules for TypeScript / React frontend projects. They are mandatory: every code change MUST comply.

---

## Scope

- Every **new** file and every file you **touch** must fully comply with these rules — not only the lines you changed. Touching a file means bringing the whole file in line, including formatting old code on the go.
- Files you do not touch stay as they are. Codebase-wide migrations (moving folders, renaming files, reordering imports across the project, …) happen **only** when the user explicitly asks for them.

---

## Rules

### 1) Protected files (DO NOT EDIT)

These files are generated or managed by tools and are **read-only**. **Never** add, remove, or modify any line in them:

- `routeTree.gen.ts` — if `@tanstack/react-router` exists in the project's dependencies. It is generated and maintained by TanStack Router automatically. To alter routing behavior, edit the route source files inside `src/routes/`.
- `pnpm-lock.yaml`, `package-lock.json` — lockfiles are only changed by the package manager itself (e.g. through `pnpm add` / `pnpm install`), never by hand.

### 2) Basepath imports with file extensions

- All imports of internal project modules **must** use the `@/` basepath alias.
- **Never** use relative (`./`, `../`) or absolute (`/src/...`) paths for internal modules.
- Internal imports **always** include the file extension (`.ts`, `.tsx`, `.css`, `.svg`, …). Package imports do not.
- Correct: `import { type Post } from "@/types/post.ts"`
- Wrong:
  - `import { type Post } from "./types/post.ts"`
  - `import { type Post } from "/src/types/post.ts"`
  - `import { type Post } from "@/types/post"`

### 3) Inline `type` modifier on imports

- When importing types, the `type` keyword **must** appear inline inside the named import braces.
- The top-level `import type { ... }` syntax is **forbidden**.
- This applies to both pure-type imports and mixed imports.
- Correct:
  - `import { type Foo, type Bar } from "@/types/test.ts"`
  - `import { type Foo, someObject } from "@/types/test.ts"`
- Wrong:
  - `import type { Foo, Bar } from "@/types/test.ts"`

### 4) Import ordering

- Apply this ordering rule **only** when a file contains more than 15 import statements (statements, not imported names).
- When it applies, group and order imports top-to-bottom as follows:
  1. **CSS** — stylesheets and other side-effect imports (`index.css`, package CSS like `@fontsource/…`, any `import "x"`)
  2. **React** — hooks, types, and modules from `react` or `react-dom`
  3. **Monorepo packages** — workspace packages of the monorepo (e.g. `@repo/ui`, `workspace:*` dependencies), monorepo only
  4. **Packages** — external packages from `package.json`, except `react` / `react-dom`
  5. **Types** — any other type-only imports (e.g. from `@/types/`)
  6. **Lib/Utils** — imports from `@/lib/`
  7. **Schemas** — imports from `@/schemas/`
  8. **Hooks** — imports from `@/hooks/`, including `@/hooks/shadcn/`
  9. **Shadcn components** — imports from `@/components/shadcn/`
  10. **Components** — imports from `@/components/`
  11. **Other** — everything else (e.g. `@/context/`, `@/assets/`, `@/routes/`)
- An import belongs to the **first** group it matches. A type-only import from a package therefore goes into **Packages** (or **React**), not **Types**; a type-only import from `@/lib/` or `@/routes/` goes into **Types**.
- Mixed imports (values and types from the same module, e.g. `import { type Foo, bar } from "@/lib/foo.ts"`) are grouped by their source, not as type-only imports.
- The order within a group does not matter, with one exception: in **React**, **Monorepo packages** and **Packages**, type-only import statements come first.
- Separate groups with one blank line and start each group with a comment header naming it. Omit headers of empty groups:

  ```ts
  // React
  import { type ReactNode, useState } from "react";

  // Packages
  import { type QueryClient } from "@tanstack/react-query";
  import { useQuery } from "@tanstack/react-query";
  import * as z from "zod";

  // Types
  import { type Post } from "@/types/post.ts";

  // Lib/Utils
  import { cn } from "@/lib/utils/cn.ts";

  // Components
  import { PageLayout } from "@/components/page-layout.tsx";
  ```

### 5) `type` over `interface`

- **Always** use `type` to declare types. Never use `interface`.
- The only exception is module augmentation that requires an `interface`, e.g. registering the router for TanStack Router type safety:

  ```ts
  declare module "@tanstack/react-router" {
    interface Register {
      router: typeof router;
    }
  }
  ```

### 6) No `any`

- `any` is **never** allowed — not in type annotations, not in generics, not as a cast.
- Where a type is genuinely unknown, use `unknown`. Only use it at the boundary to external data (e.g. a data-fetching response whose shape is not known), and narrow or validate it before use.
- App-internal types **never** use `unknown`.

### 7) Named exports only

- **Never** use default exports. Always use named exports.
- Export directly at the declaration (`export function …`, `export const …`, `export type …`). **Never** collect exports at the end of the file (`export { Foo, Bar }`).
- Exception: config files whose tool requires a default export (e.g. `vite.config.ts`, `eslint.config.js`).

### 8) `function` keyword over arrow functions

- Functions — including components — are **always** declared with the `function` keyword, never as arrow functions assigned to a variable.
- Arrow functions are allowed for inline callbacks passed as arguments (e.g. `items.map((item) => …)`, `onClick={() => …}`) and where a function declaration is not possible (e.g. the callback passed to `useCallback` / `useMemo`).
- Correct: `export function formatTimestamp(value: Date) { … }`
- Wrong: `export const formatTimestamp = (value: Date) => { … }`

### 9) File naming

- All files use **kebab-case** (e.g. `page-layout.tsx`, `format-timestamp.ts`, `get-data.ts`).
- All folders use **kebab-case** (e.g. `question-types/`, `socket/`).
- Exception: hooks are named in **camelCase**, start with `use` and always end in `.tsx` (e.g. `useDebouncedValue.tsx`), even if they contain no JSX.
- Exception: files and folders whose name is dictated by a tool (e.g. TanStack Router route files and folders like `__root.tsx`, `posts_.$postId.tsx` or `$id_/`, `routeTree.gen.ts`, shadcn-generated files).

### 10) Format and type check everything

- After every finished change, run the project's format command. It must exist as a script in `package.json`; if it is missing, create it: `"format": "prettier --write ."`. Files that must not be formatted (lockfiles, generated files, …) belong in `.prettierignore`.
- After every finished change, also run a type check and fix every type error before you consider the change done.

### 11) Folder structure

- This tree is a **template** describing where things belong, not a list of things that must exist.
- **Almost everything is optional.** A folder or file only needs to exist if the project actually uses it (e.g. no `schemas/` without zod, no `components/shadcn/` without shadcn).
- **But if it exists, it must be at exactly this path.** Example: if the project has hooks, they live in `src/hooks/` — never in `src/utils/hooks/`, `src/components/hooks/` or similar.
- Entries marked **(required)** must always exist. Entries marked **(required if …)** must exist as soon as the condition is met.
- Do **not** create parallel/duplicate locations for the same concern (e.g. a second `utils/` or `constants/` folder somewhere else).
- `...` means further files or subfolders are allowed at that level, as long as they fit the purpose of the parent folder.
- New top-level folders in `src/` are only allowed if the file genuinely does not fit into any existing folder.

```
root/
├── src/
│   ├── main.tsx                 # (required) App entry point, mounts the app / router
│   ├── index.css                # Global styles (Tailwind entry, theme variables)
│   ├── routeTree.gen.ts         # (required if TanStack Router) Auto-generated, DO NOT EDIT (see rule 1)
│   ├── app.tsx                  # (required if NO TanStack Router) App root component; with TanStack Router `routes/__root.tsx` takes this role
│   ├── components/              # React components
│   │   ├── shadcn/              # shadcn/ui primitives, managed via the shadcn CLI (see components.json)
│   │   └── ...                  # Other components, may be grouped in thematic subfolders (e.g. form/, table/, ui/)
│   ├── context/                 # React contexts & providers, one folder per context (e.g. socket/ with context.tsx and provider.tsx; its hook useSocket.tsx lives in hooks/), rarely used — prefer hooks/stores
│   ├── hooks/                   # Custom hooks, one hook per file (see "Hooks" below)
│   │   ├── useHook.tsx
│   │   ├── shadcn/              # Hooks installed via the shadcn CLI (see components.json), exempt from the naming rule
│   │   └── ...                  # May be grouped in thematic subfolders (e.g. forms/)
│   ├── lib/                     # Non-component logic
│   │   ├── env.ts               # Typed access to .env variables, validated with zod
│   │   ├── constants/           # Constants (regex, breakpoints, ...)
│   │   ├── data/                # Data fetching (see "lib/" below)
│   │   ├── features/            # Feature logic with side effects or React (see "lib/" below)
│   │   ├── utils/               # Pure helper functions, no side effects, no React
│   │   │   ├── cn.ts            # (required if shadcn) shadcn's `cn` class-merge helper
│   │   │   └── ...
│   │   └── ...                  # Further logic folders (e.g. stores/)
│   ├── routes/                  # (required if TanStack Router) File-based routes
│   │   ├── __root.tsx           # (required if TanStack Router) Root layout
│   │   └── ...                  # Files and folders following TanStack Router naming conventions
│   ├── schemas/                 # Zod schemas (<entity>.ts), may be grouped in subfolders; in a monorepo schemas live in a shared package instead
│   ├── types/                   # Global type definitions only (see "Types" below)
│   └── ...                      # Other folders/files only if absolutely necessary and nothing above fits
├── index.html                   # (required) Vite HTML entry
├── package.json                 # (required)
├── vite.config.ts               # Vite config (incl. `@/` alias, see rule 2)
├── tsconfig*.json               # TypeScript config (incl. `@/` path alias)
├── components.json              # (required if shadcn) shadcn config
├── .prettierrc, .prettierignore # Prettier config (see rule 10)
├── pnpm-workspace.yaml          # pnpm workspace / settings
├── .gitignore
└── ...
```

#### Hooks

- **One hook per file.** The file is named after the hook it exports (`useDebouncedValue.tsx` exports `useDebouncedValue`), see rule 9.

#### `lib/`

- `lib/data/` — everything data-fetching related: the generic fetchers (e.g. `get-data.ts`, `mutate-data.ts`), helpers that only they use (e.g. their error handling) and query definitions (e.g. TanStack Query `queryOptions` in `queries.ts`).
- `lib/features/` — logic that is neither a component nor a hook but has side effects or uses React (e.g. toast helpers that render JSX, route guards that redirect). A feature consisting of a single file lives directly in `lib/features/` (e.g. `lib/features/show-toast.tsx`); as soon as a feature has several related files, they go into a folder named after the feature (e.g. `lib/features/auth/`).
- `lib/utils/` — **only** pure helper functions: no side effects, no React. Anything else belongs in `lib/features/`.

#### Types

- Only **global** types belong in `src/types/`: types that are used — or can potentially be used — all over the app (e.g. a generic `ApiResponseSuccess<T>` or a `ColorToken`).
- Component-specific types — including ones re-used by a handful of sub-components — **must** be defined in the component file itself. If such a type is shared by sub-components in other files, define and export it in the parent component's file and import it from there.

#### `components.json` must match the folder structure

- This folder structure deviates from the shadcn defaults. The `aliases` (and `tailwind.css`) in `components.json` therefore **must** point to the paths defined above, otherwise the shadcn CLI installs components and helpers into the wrong locations.
- Expected values:

  | Key            | Expected value        |
  | -------------- | --------------------- |
  | `tailwind.css` | `src/index.css`       |
  | `components`   | `@/components`        |
  | `ui`           | `@/components/shadcn` |
  | `utils`        | `@/lib/utils/cn`      |
  | `lib`          | `@/lib`               |
  | `hooks`        | `@/hooks/shadcn`      |

- If a mismatch is detected, the agent **must only output a WARNING** naming the key, the current value and the expected value, e.g.:
  `⚠️ WARNING: components.json → aliases.ui is "@/components/ui", expected "@/components/shadcn".`
- The agent **must NOT** modify `components.json` on its own. Changing it is the user's decision.
- The agent must also not move or re-create files to work around the mismatch (e.g. installing shadcn components into the wrong folder and then moving them).

---

## Convex

Applies only if `convex` exists in the project's dependencies. All Convex-specific rules live in this section. Where a rule here contradicts a general rule above, **this section wins** for the files it covers. Everything not mentioned here follows the general rules.

### C1) Location and structure

- Backend code lives in `convex/` at the project root — **not** in `src/`. The path is dictated by Convex.
- Structure:

  ```
  root/
  ├── convex/
  │   ├── _generated/          # Auto-generated by `convex dev`, DO NOT EDIT (see C2)
  │   ├── schema.ts            # (required) Database schema
  │   ├── tsconfig.json        # (required) Created by Convex, may be extended (see C3)
  │   ├── <table>.ts           # Queries / mutations / actions for one table, named after the table (e.g. todos.ts)
  │   └── ...                  # Further function files (e.g. http.ts, crons.ts) or folders grouped by domain
  ├── convex.json              # (required) Convex project config (see C3)
  └── .env.local               # Written by `convex dev` (CONVEX_DEPLOYMENT, VITE_CONVEX_URL), never committed
  ```

- Convex function file and folder names become part of the API path (`api.todos.list`). Therefore they use **camelCase** instead of kebab-case (e.g. `todoLists.ts` → `api.todoLists.list`). Single-word names are preferred.

### C2) Protected files

- `convex/_generated/` is generated and maintained by `convex dev`. **Never** add, remove, or modify anything in it, same as rule 1.
- `convex/_generated/` must be listed in `.prettierignore` and in the ESLint `globalIgnores`.

### C3) Imports and config

- **Inside `convex/`**: import other Convex files with **relative** paths including the file extension (e.g. `import { query } from "./_generated/server.ts"`). Convex bundles this folder on its own; the `@/` alias does not apply there.
- **Never** import from `src/` (`@/…`) inside `convex/`. Backend code must not depend on frontend code.
- **In `src/`**: import Convex code via the `@convex/` alias, never via relative paths (e.g. `import { api } from "@convex/_generated/api.ts"`). The alias must point to `convex/` in `vite.config.ts` and in the `paths` of `tsconfig.app.json`.
- `convex.json` must set `"codegen": { "fileType": "ts" }` so `_generated/` contains `.ts` files that can be imported with their extension.
- `convex/tsconfig.json` must additionally set `"allowImportingTsExtensions": true` and `"verbatimModuleSyntax": true` (rules 2 and 3 apply inside `convex/` as well).
- Import ordering (rule 4): `@convex/` imports form their own group `// Convex`, placed directly after **Packages**. Imports from the `convex` package itself (e.g. `convex/react`) stay in **Packages**.

### C4) Exports and function style

- Files whose default export is required by Convex are exempt from rule 7: `convex/schema.ts` (`export default defineSchema(…)`), `convex/http.ts`, `convex/crons.ts`, `convex/convex.config.ts`, `convex/auth.config.ts`.
- Convex functions are declared as `export const <name> = query({ … })` / `mutation({ … })` / `action({ … })`. This is not an arrow function assigned to a variable and therefore does not violate rule 8. The `handler` is written inline as an arrow function or method.
- Helper functions inside `convex/` (not exposed as Convex functions) follow rule 8 (`function` keyword).

### C5) Validation and types

- Every public Convex function **must** declare `args` (and `returns`) with Convex validators from `convex/values` (`v.string()`, `v.id("todos")`, …). Never skip argument validation.
- The schema uses `v` validators as well. Zod is **not** used inside `convex/`; Zod is used in `src/` for forms (`src/schemas/`).
- Database document types come from the generated data model: `Doc<"todos">`, `Id<"todos">` from `@convex/_generated/dataModel.ts`. **Never** redeclare them by hand in `src/types/` or component files.
- Queries filter via **indexes** (`.withIndex(…)`) defined in `schema.ts`, not via `.filter(…)`, unless the table is guaranteed to stay small.

### C6) Using Convex in the frontend

- The `ConvexReactClient` is created and the app wrapped in `ConvexProvider` in `src/main.tsx`.
- `VITE_CONVEX_URL` is read only through `src/lib/env.ts` (validated with zod), never via `import.meta.env` directly elsewhere.
- Data is read and written with `useQuery` / `useMutation` / `useAction` from `convex/react`. **No** TanStack Query and **no** custom fetchers in `src/lib/data/` for Convex data.
- Mutations are not followed by manual refetching or cache updates — Convex queries are reactive and update automatically.

### C7) Development workflow

- `convex dev` (`pnpm convex dev`) must be running while changing anything in `convex/`; it pushes functions and regenerates `_generated/`. The agent may start it in the background if the project is already set up (`.env.local` exists). The first run (login / project selection) is interactive and must be done by the user.
- The type check of rule 10 must cover `convex/` as well (e.g. `tsc -b && tsc -p convex --noEmit`).
- Schema changes that would break existing data (removing fields, changing types) must be announced to the user before they are pushed.

---

## Compliance

- Any change that violates these rules is **non-compliant** and must be corrected before the change is considered done.
- These rules override personal preferences and editor defaults.
