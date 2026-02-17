# Consumer Map

Maps each `@prb/effect-*` package to its consumers in `~/sablier/new-ui` and its CHANGELOG location in prb-effect.

| Package              | Consumer Apps        | Version Format | CHANGELOG             |
| -------------------- | -------------------- | -------------- | --------------------- |
| @prb/effect-evm      | bob, portal          | catalog:effect | evm/CHANGELOG.md      |
| @prb/effect-evm-safe | portal               | catalog:effect | evm-safe/CHANGELOG.md |
| @prb/effect-next     | bob, landing, portal | catalog:effect | next/CHANGELOG.md     |
| @prb/effect-solana   | portal               | pinned (beta)  | (none)                |
| @prb/effect-xstate   | portal               | ^semver        | xstate/CHANGELOG.md   |

## Version Resolution

- **catalog:effect** — version lives in root `package.json` under `workspaces.catalog.effect`. The `bump-deps` skill
  handles catalog resolution automatically.
- **pinned (beta)** — `@prb/effect-solana` uses a pinned beta version (e.g., `1.0.0-beta.4`). Must be updated manually
  in `portal/package.json`.
- **^semver** — `@prb/effect-xstate` uses a caret range (e.g., `^2.0.2`) directly in `portal/package.json`.
