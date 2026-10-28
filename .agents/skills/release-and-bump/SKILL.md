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

## Step 2: Trigger CI staging

Run the release bump first. `ccbump` runs the `release-bumper` skill, which bumps `package.json`, updates the CHANGELOG,
commits, and creates an annotated `<package-directory>@<new-version>` tag without pushing it:

```bash
zsh -ic 'ccbump <package-name>'
```

Read the new version from the package's `package.json`, then push the commit and the tag:

```bash
git push origin
git push origin <package-directory>@<new-version>
```

Push at most three tags at a time. GitHub does not start tag-push workflows when a push includes more than three tags.

The tag push triggers `.github/workflows/release.yml`. CI packs the package with Bun, which runs the prepack build and
resolves `catalog:` and `workspace:` dependency ranges. CI stages the tarball through npm trusted publishing. Stable
releases also create a GitHub release and sync the major version branch. Prereleases use their identifier (such as
`beta`) as the npm dist-tag and skip those GitHub release steps.

Wait for the tag's release workflow to finish successfully. If any command or CI job fails, **stop and report the
error**. Do not proceed.

The staged version stays unpublished until the maintainer approves it with 2FA on npmjs.com (Staged Packages). Report
the staged release and wait for the maintainer's approval before continuing. Never run `npm publish`,
`npm stage publish`, `npm stage approve`, or `npm stage reject` locally.

## Step 3: Verify npm Publication

After the maintainer approves the staged release, verify that the exact version is available and the intended dist-tag
points to it (`latest` for stable releases, `beta` for betas):

```bash
npm view <package-name>@<new-version> version
npm view <package-name> dist-tags --json
```

Approval does not guarantee immediate availability. npm's
[publish-time scanning](https://github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata/)
can keep a newly approved version unavailable for several minutes. If the exact-version lookup returns 404 after
approval, poll the read-only lookup at 30-second intervals while keeping the user informed:

```bash
sleep 30 && npm view <package-name>@<new-version> version
```

Do not republish to resolve a scanning delay. Diagnose other lookup errors separately. If availability remains delayed,
inspect npm's publishing status or notifications and report the concrete state. Continue to consumer updates only after
the exact version is available and the intended dist-tag points to it.

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
