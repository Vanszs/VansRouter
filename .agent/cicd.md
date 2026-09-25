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
6. Create and push an annotated tag:

```bash
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

### Example: Release `v0.91.10`

Use the exact release version everywhere. Do not combine the changelog commit with code, workflow, or package-version changes.

```bash
# Commit 1: code, CI, tests, and package version bump
git add package.json cli/package.json .github/workflows/release.yml cli/scripts AGENTS.md .agent/cicd.md
git commit -m "chore: prepare release 0.91.10"

# Commit 2: changelog only; must remain the final commit before the tag
git add CHANGELOG.md
git diff --cached --name-only
# Expected output: CHANGELOG.md
git commit -m "docs(changelog): release v0.91.10"

git push origin main
node cli/scripts/validate-release.cjs v0.91.10 --pretag
git tag -a v0.91.10 -m "Release v0.91.10"
git push origin v0.91.10
```

Before using another version, replace every `0.91.10` occurrence above with the new `X.Y.Z`. Confirm both package files and the top changelog heading use the same version.

## Pre-Tag Validation

Run from a clean `main` checkout:

```bash
git pull --ff-only origin main
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
- The image smoke test must force a platform-specific pull, start the published image, and verify `/api/ready`, `/api/health`, and `/api/version` on both `linux/amd64` and `linux/arm64`.

## CI Gates

For `origin/main` branch protection, the required status check is exactly `Validate (Ubuntu / Node 22)` from `.github/workflows/ci.yml`. The cross-platform matrix is conditional and must not be a required check because GitHub may legitimately skip it on non-platform changes. Branch protection also requires the branch to be up to date, blocks force-push/deletion, enforces admin rules, and requires conversation resolution.

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

These are host settings, not repository files. CI must not be considered release-hardened until the settings are verified through the GitHub API.

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
- Once a tag is pushed, it is immutable even if CI fails. Never delete, move, force-push, or rerun under the same tag after a release-gate bug; fix the workflow and use the next version.
- `v0.91.3` and `v0.91.4` are historical failed tags (release-validation ref bug). `v0.91.11` failed due to missing QEMU in multi-arch GHCR build. Do not reuse them; `v0.91.12` resolved multi-arch with the QEMU action.
- GHCR staging failure: do not promote its staging tag.
- npm publish timeout: query npm first; never retry blindly. If the published integrity matches the package job output, a rerun is safe; if it differs, stop and investigate:

```bash
npm view vansrouter@X.Y.Z dist.integrity --json
```

- npm already published but GHCR promotion failed: rerun the failed promotion job or the idempotent release workflow. It must use the recorded Buildx digest and must never republish or overwrite a different version digest.
- Production health failure: rollback to the previous immutable image tag; preserve the DB volume and inspect migration backups.
- Never use `git reset --hard`, force-push, or delete published tags as recovery.
