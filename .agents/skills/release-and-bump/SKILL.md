---
name: release-and-bump
argument-hint: <package-name>
disable-model-invocation: false
user-invocable: true
description:
  This skill should be used when the user asks to "release and bump", "publish and bump", "release to npm and update
  new-ui", "release and update consumer", "publish and migrate", or mentions releasing a @prb/effect-* package and
  bumping it in new-ui.
---

# Release and Bump

End-to-end pipeline: release a `@prb/effect-*` package to npm, bump it in the consumer monorepo (`~/sablier/new-ui`),
migrate any breaking changes or new features.

## Step 1: Identify Package

If `$ARGUMENTS` contains a package name, use it directly. Otherwise, infer from the current working directory by reading
`package.json` — if it has a `name` starting with `@prb/effect-`, use that.

If neither provides a package name (e.g., cwd is the monorepo root and no argument was given), ask the user which
package to release using `AskUserQuestion` with these options:

- @prb/effect-evm
- @prb/effect-evm-safe
- @prb/effect-next
- @prb/effect-xstate

Then `cd` into the package directory before continuing.

## Step 2: Run `just release <package-name>`

Execute from the **package directory**:

```bash
just release <package-name>
```

This runs: `ccbump` (AI version bump + changelog + commit + tag) → `git push origin` → `npm publish`.

If the command exits with a non-zero code, **stop and report the error**. Do not proceed.

## Step 3: Verify npm Publication

Read `package.json` to get the new version (ccbump modifies it in Step 2).

Verify the package is available on npm:

```bash
npm view <package-name>@<new-version> version
```

If the command fails (package not yet propagated), wait 10 seconds and retry once:

```bash
sleep 10 && npm view <package-name>@<new-version> version
```

If still failing after the retry, warn the user that npm propagation is slow but continue to the next step — the version
was published successfully if Step 2 succeeded.

## Step 4: Bump in `~/sablier/new-ui`

Delegate to the `bump-deps` skill to update the package version in the consumer monorepo:

1. Change directory: `cd ~/sablier/new-ui`
2. Invoke: `/bump-deps <package-name>`

The `bump-deps` skill handles catalog resolution, version format preservation, and `bun install` automatically.

## Step 5: Migrate Consumer Code

Only execute this step if the package has a CHANGELOG.

1. Read `references/consumer-map.md` to determine which apps consume this package and where the CHANGELOG lives.
2. Read the CHANGELOG from the released package directory (e.g., `evm/CHANGELOG.md`).
3. Extract entries for the **new version only**.
4. For each changelog category, take action:

| Category    | Action                                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| **Changed** | Search consumer app directories for affected imports/usages. Apply renames, signature changes, API updates. |
| **Removed** | Search consumer app directories for removed exports. Delete usages or replace with alternatives.            |
| **Added**   | Search consumer app directories for opportunities to adopt the new API. Implement the integration.          |
| **Fixed**   | No action needed.                                                                                           |

5. Draft a migration plan from the changelog entries and affected consumer apps, then pass it to the `work` skill for
   implementation.

## Step 6: Report Summary

Print a summary:

```
Package:     <package-name>
Version:     <new-version>
npm:         https://npmjs.com/package/<package-name>/v/<new-version>
Consumer:    ~/sablier/new-ui
Files changed in new-ui:
  - <list of modified files>
Migrations applied:
  - <list of renames/removals/changes/new features, or "None">
```

Do not commit changes in `~/sablier/new-ui` unless the user explicitly asks.
