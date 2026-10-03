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
- @prb/effect-solana
- @prb/effect-xstate

Then `cd` into the package directory before continuing.

## Step 2: Run release commands (publish from package directory)

Run the release bump first. `ccbump` runs the `release-bumper` skill, which bumps `package.json`, updates the CHANGELOG,
commits, and creates a `<package-directory>@<new-version>` tag without pushing it:

```bash
zsh -ic 'ccbump <package-name>'
```

Read the new version from the package's `package.json`, then push the commit and the tag. The tag push triggers
`.github/workflows/release.yml`, which creates the GitHub release:

```bash
git push origin
git push origin <package-directory>@<new-version>
```

Then pack with Bun and publish the tarball with npm from the released package's directory. Bun resolves `catalog:` and
`workspace:` dependency ranges in the packed manifest; direct `npm publish` leaves those ranges unresolved. The pack
step runs the package's `prepack` build. Use `latest` for stable versions and the prerelease identifier (such as `beta`)
for prereleases:

```bash
cd <package-directory>
bun pm pack --filename release.tgz
npm publish ./release.tgz --tag "$(jq -r '.version | capture("^[^-]+-(?<tag>[^.+]+)").tag // "latest"' package.json)"
```

Both commands MUST run from the package directory (e.g., `evm-safe/` for `@prb/effect-evm-safe`), not the monorepo root.
Publish the Bun-generated tarball, not the source directory.

If any command exits with a non-zero code, **stop and report the error**. Do not proceed.

## Step 3: Verify npm Publication

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

Delegate to the `node-deps-bumper` skill to update the package version in the consumer monorepo:

1. Change directory: `cd ~/sablier/new-ui`
2. Invoke: `/node-deps-bumper <package-name>`

The `node-deps-bumper` skill handles catalog resolution, version format preservation, and `bun install` automatically.

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

5. Draft a migration plan from the changelog entries and affected consumer apps, then implement it in
   `~/sablier/new-ui`.

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
