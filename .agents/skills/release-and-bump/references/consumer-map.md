# Consumer Map

Maps each `@prb/effect-*` package to its consumers in `~/sablier/new-ui` and its CHANGELOG location in prb-effect.

| Package              | Consumer Apps   | Version Format | CHANGELOG             |
| -------------------- | --------------- | -------------- | --------------------- |
| @prb/effect-evm      | portal          | catalog:effect | evm/CHANGELOG.md      |
| @prb/effect-evm-safe | portal          | catalog:effect | evm-safe/CHANGELOG.md |
| @prb/effect-next     | landing, portal | catalog:effect | next/CHANGELOG.md     |
| @prb/effect-solana   | solsab          | pinned (beta)  | (none)                |
| @prb/effect-xstate   | portal          | catalog:effect | xstate/CHANGELOG.md   |

## Version Resolution

- **catalog:effect** — version lives in root `package.json` under `workspaces.catalogs.effect`. The `node-deps-bumper`
  skill handles catalog resolution automatically.
- **pinned (beta)** — `@prb/effect-solana` uses a pinned beta version (e.g., `1.0.0-beta.8`). Must be updated manually
  in `solsab/package.json`.
