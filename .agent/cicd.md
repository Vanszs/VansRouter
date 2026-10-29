# CI/CD Release Policy

Mandatory for every AI-assisted release. Do not bypass these rules with force tags, manual npm publish, manual GHCR tag mutation, or `latest`-only deployment.

## Release Contract

- Release source: annotated Git tag `vX.Y.Z` pushed to the current tip of `main`.
- `package.json` and `cli/package.json` versions must equal `X.Y.Z`.
- `CHANGELOG.md` must start with `# vX.Y.Z (YYYY-MM-DD)`.
- The top release entry must be detailed enough to mirror the shipped scope: group changes under meaningful headings such as Features, Reliability & Compatibility, Frontend & Accessibility, Release Infrastructure, and Tests; name affected providers/modules; document user-visible behavior and compatibility changes; include verified test/build evidence. Do not use a vague one-line summary for a multi-feature release.
- Changelog claims must be evidence-based: derive entries from `git log <previous-tag>..HEAD`, final diff, and completed validation output. Mark skipped or unavailable integration coverage explicitly; never claim provider behavior was live-verified without a real provider test.
- The commit immediately before the tag must be the last commit changing only `CHANGELOG.md`.
- All code, workflow, test, and version changes must be complete before the changelog-only commit.
- Never retag or move an existing release tag. Use the next version.
- Never tag an older commit: CI requires the tag commit to equal `origin/main`.
- Never publish npm manually outside the release workflow.
- GitHub Actions checkout may dereference an annotated tag to its commit. CI must fetch the original tag object into a temporary ref before validating annotation:

```bash
git fetch origin "refs/tags/$GITHUB_REF_NAME:refs/tags/release-validation"
RELEASE_TAG_REF=refs/tags/release-validation node cli/scripts/validate-release.cjs "$GITHUB_REF_NAME"
```

## Required Commit Order

1. Implement code and tests.
2. Update `package.json` and `cli/package.json` to the same version.
3. Run validation and build.
4. Update the top `CHANGELOG.md` entry with the final version and verified changes.
5. Commit `CHANGELOG.md` alone. This must be the final commit before the tag.
6. Push the commits to a temporary branch and open a pull request against `main`.
   Never push directly to `main`: the required check must already exist on the
   commit, and a check run produced for another branch is not counted for a
   direct push, so the push is rejected with `Required status check ... is
   expected` even when that check passed (verified on v0.91.85).
7. Wait for `Validate (Ubuntu / Node 22)` on the pull request, then merge with
   **Rebase and merge**. Rebase keeps the commit order, so the merged tip is
   still the changelog-only commit that `--pretag` requires. A merge commit
   fails validation because it does not change only `CHANGELOG.md`.
8. Sync `main` from the merged tip, re-run `--pretag` on it, then create and
   push the annotated tag.

`gh` resolves this checkout to the upstream `decolua/9router` repository
because an `upstream` remote exists, so every `gh` command below names
`-R Vanszs/VansRouter` explicitly.

```bash
git switch -c release/vX.Y.Z
git push origin release/vX.Y.Z

gh pr create -R Vanszs/VansRouter --base main --head release/vX.Y.Z \
  --title "Release vX.Y.Z" --body "Release vX.Y.Z"

# Wait until "Validate (Ubuntu / Node 22)" succeeds on the pull request.
gh pr merge -R Vanszs/VansRouter --rebase --delete-branch

git fetch origin main
git switch -C main origin/main
node cli/scripts/validate-release.cjs vX.Y.Z --pretag
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

Use the exact release version everywhere. Do not combine the changelog commit
with code, workflow, or package-version changes.

## Pre-Tag Validation

Run from a clean `main` checkout at the merged release tip:

```bash
git fetch origin main
git switch -C main origin/main
git status --short
git -c core.whitespace=cr-at-eol diff --check
node -e 'const a=require("./package.json"),b=require("./cli/package.json"); if(a.version!==b.version) throw Error(`${a.version} !== ${b.version}`); console.log(a.version)'
pnpm test
pnpm run build
node cli/scripts/validate-release.cjs "v$(node -p "require('./package.json').version")" --pretag
```

The `--pretag` command checks the changelog-only commit before the tag exists. After creating the annotated tag, CI repeats the same checks and additionally verifies tag object type. If a check fails, stop. Do not push a tag.

## Docker Multi-Arch Build Contract

- All GitHub Actions are pinned to reviewed full commit SHAs. Dependabot updates the pins; tags alone are not release security.
- `docker/setup-qemu-action` is **MANDATORY** and must run immediately before `docker/setup-buildx-action` in the `build-and-verify-ghcr` job.
- The build must use `pnpm install --frozen-lockfile` with the repository lockfile. The native dependency stage must use its committed `docker/native-deps/package-lock.json` and `npm ci --ignore-scripts`; the target-specific `better-sqlite3` musl binary is downloaded separately for the pinned Node ABI and SHA-256 verified before use.
- Node/Alpine base images and external Tailscale archives are digest/checksum pinned; the bundled Tailscale release is kept current.
- The image must retain provenance and SBOM attestations, and the release workflow must promote the exact Buildx digest rather than a mutable staging tag. Registry inspection errors are fatal; only an explicit not-found result permits tag creation.
- The build pushes the multi-arch index to the public package by digest only, with no tag. Promotion attaches the version tag and `latest` to that exact digest, so an unverified image never carries a user-facing tag and no staging or attestation tag appears in the package. The attestation is stored by GitHub (`push-to-registry: false`) and verified with `gh attestation verify`; the image index still embeds the Buildx provenance and SBOM. Never prune the public package per version.
- The image smoke test must force a platform-specific pull, start the published image, and verify `/api/ready`, `/api/health`, and `/api/version` on both `linux/amd64` and `linux/arm64`.

## CI Gates

For `origin/main` branch protection, the required status check is exactly `Validate (Ubuntu / Node 22)` from `.github/workflows/ci.yml`. The cross-platform matrix is conditional and must not be a required check because GitHub may legitimately skip it on non-platform changes. Branch protection also requires the branch to be up to date, blocks force-push/deletion, enforces admin rules, and requires conversation resolution.

The required check is evaluated on pull requests. A check run attached to a release branch does not satisfy a direct push to `main`, and posting a commit status to fake that link bypasses the control; use the pull-request flow above instead.

The release workflow must complete in this order:

```text
check-branch
package-npm + build-and-verify-ghcr
publish-npm
promote-ghcr
```

Required evidence:

- `check-branch`: tag points to `main`, versions match, changelog is final commit, tag is annotated.
- `check-branch` must validate the original annotated tag object, not the dereferenced checkout ref.
- `package-npm`: actual tarball contains `app/_nm/sql.js/dist/sql-wasm.wasm`; no `better_sqlite3.node`; the package installs and reports the expected version through the real npm installation path, including lifecycle scripts.
- Artifact smoke test: extracted CLI starts with a temporary `DATA_DIR`, responds to `/api/settings`, creates `db/data.sqlite`, and migrates legacy `db.json`; `VANROUTER_SKIP_UPDATE_CHECK=1` makes the version assertion independent of the public npm registry.
- `build-and-verify-ghcr`: the pushed digest contains `linux/amd64` and `linux/arm64`; native SQLite and container health/version smoke tests pass; the digest is attested.
- `publish-npm`: publishes the exact validated artifact, treats only an explicit npm `E404` as unpublished, fails closed on other registry errors, verifies its SHA-512 integrity, and is safe to rerun only when the registry already contains the same artifact.
- `promote-ghcr`: promotes the verified digest to `X.Y.Z` and `latest` only after npm succeeds; it refuses to overwrite a different version digest.

## Repository Controls Required

Before the next release, repository administrators must enable and verify:

- a tag ruleset protecting `v*` tags from deletion and force updates;
- a protected `release` Environment with required reviewer approval for npm/GHCR publishing;
- repository-level Actions SHA pinning enforcement;
- Dependabot updates for GitHub Actions, Docker, and the CLI npm lockfile.

These are host settings, not repository files. CI must not be considered release-hardened until the settings are verified through the GitHub API. Verified on 2026-10-29: the tag ruleset, Actions SHA pinning, and required reviewer approval on the `release` environment are enabled; v0.91.85 itself ran before the reviewer gate existed.

## Deployment Rules

- Deploy immutable image tag `ghcr.io/vanszs/vansrouter:X.Y.Z` (or its recorded digest), not `latest`.
- Docker Compose must receive an explicit SemVer `VANSROUTER_VERSION` (never `latest`; a recorded digest is preferred); the canonical `9router-data` volume name remains unchanged.
- Keep Docker volume name `9router-data`; never rename it without explicit DB migration and verification.
- PM2 deployments must set the production port explicitly and use `--update-env` on restart.
- Preserve `server.js`, `custom-server.js`, peer-token handling, proxy IP handling, and persistent `DATA_DIR`.
- After deployment, verify version and health:

```bash
curl -fsS http://127.0.0.1:3003/api/version
curl -fsS http://127.0.0.1:3003/api/health
```

- Verify SQLite path, migrations, login, and one authenticated/API-key request before declaring success.
- Do not claim deployment success without command output or GitHub Actions evidence.

## Failure Recovery

- `check-branch` or package failure: fix the branch and create a new version/tag.
- `GH006 Required status check ... is expected` on `git push origin main`: this is branch protection working as designed, not a CI failure. Use the pull-request flow; do not disable protection or post a synthetic commit status.
- v0.91.85 was released by relaying a green `Validate` result to the commit as a status before this rule existed. That workaround is retired; use the pull-request flow.
- Once a tag is pushed, it is immutable even if CI fails. Never delete, move, force-push, or rerun under the same tag after a release-gate bug; fix the workflow and use the next version.
- `v0.91.3` and `v0.91.4` are historical failed tags (release-validation ref bug). `v0.91.11` failed due to missing QEMU in multi-arch GHCR build. Do not reuse them; `v0.91.12` resolved multi-arch with the QEMU action.
- GHCR build failure: do not promote that run's digest. The build leaves only an untagged digest; the promote job is the only step that attaches a user-facing tag.
- npm publish timeout: query npm first; never retry blindly. If the published integrity matches the package job output, a rerun is safe; if it differs, stop and investigate:

```bash
npm view vansrouter@X.Y.Z dist.integrity --json
```

- npm already published but GHCR promotion failed: rerun the failed promotion job or the idempotent release workflow. It must use the recorded Buildx digest and must never republish or overwrite a different version digest.
- Production health failure: rollback to the previous immutable image tag; preserve the DB volume and inspect migration backups.
- Never use `git reset --hard`, force-push, or delete published tags as recovery.
