# RustScript Playground

Browser playground for `pd-vm`, backed by the `pd-vm-wasm` crate with the `runtime` feature and a Monaco-based editor.

## Features

- RustScript, JavaScript, and Lua source frontends
- Live wasm diagnostics surfaced as Monaco markers plus a diagnostics panel
- Run and debug workflows directly in the browser
- Breakpoints, step/next/out/continue controls, stack/locals views, and hover inspection
- Print output and final stack panels
- Fuel and epoch interruption controls for run and debug sessions
- Monaco autocomplete from the wasm completion catalog
- Browser-hosted `runtime::sleep(...)` support in the wasm runtime

## GitHub Pages

The `Build and deploy Pages` workflow builds the playground and publishes `dist/` to the `gh-pages` branch.

Published URL:

https://rustscript-lang.github.io/playground/

## Development

The web app expects a sibling RustScript checkout by default:

```bash
cd /home/wow/rustscript/playground
bun install
bun run dev
```

Set `RUSTSCRIPT_REPO=/path/to/rustscript` if the checkout is elsewhere.

Useful commands:

- `bun run dev` — rebuilds the wasm playground runtime and starts Vite
- `bun run build` — rebuilds wasm, type-checks, and produces `dist/`
- `bun run preview` — serves the built bundle locally

## Related projects

- RustScript core VM and wasm runtime: https://github.com/rustscript-lang/rustscript
- Controller Web UI: https://github.com/rustscript-lang/pd-controller/tree/master/webui
- Controller service: https://github.com/rustscript-lang/pd-controller
- Edge runtime: https://github.com/rustscript-lang/pd-edge
