# AMS Studio ERP — Invoicing & Accounting · front-end sources

This repository holds the **source code of the compiled admin interface** shipped in
the WordPress plugin **AMS Studio ERP — Invoicing & Accounting**
(slug `ams-studio-erp-invoicing-accounting`).

The plugin ships this interface already built, minified, in `app/build/`. This
repository is the human-readable source it is built from, published so that anyone
can read, audit and rebuild it. It contains nothing else: the PHP of the plugin is
not compiled and can be read as-is in the plugin package.

## Layout

| Path | What it is |
|---|---|
| `app/src/` | TypeScript / React sources of the interface |
| `app/package.json`, `app/package-lock.json` | npm dependencies, pinned by the lockfile |
| `app/vite.config.ts` | build configuration (Vite) |
| `app/tsconfig.json`, `app/tsconfig.node.json` | TypeScript configuration |
| `app/tailwind.config.js`, `app/postcss.config.js` | stylesheet configuration |

The same `app/` folder, with these same files, is also included in the plugin package.

## Building

Requirements: **Node.js 18 or 20+** (built and verified with Node 22) and npm.

```bash
cd app
npm ci          # installs the exact versions recorded in package-lock.json
npm run build   # type-checks with tsc, then builds with Vite
```

Output goes to `app/build/`:

- `amsbm-app-<hash>.js` — the entry module,
- `amsbm-app-<hash>.css` — the stylesheet,
- `morceaux/*.js` — the screens, loaded on demand, and `morceaux/vendor-<hash>.js`,
  which bundles the npm dependencies listed in `package.json`,
- `manifeste.json` — tells WordPress which hashed file names to enqueue.

Main tools: Vite 5.4, TypeScript 5.9, React 18.3, Ant Design 5.29, Tailwind CSS 3.4 —
exact versions of every package are in `app/package-lock.json`.

## License

GPL-2.0-or-later, like the plugin. See `LICENSE`.
