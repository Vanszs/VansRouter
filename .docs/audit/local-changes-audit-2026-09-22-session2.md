# Local Changes Audit — Session 2 (2026-09-22)

> **Scope**: 4 commits applied by automated agent session (Items 4, 5, 6, 8 of the cleanup batch).
> **Model**: bevan/cx/gpt-5.6-luna  
> **Method**: read diff + test output review

---

## Commits in scope

```
8c9b71efd fix(claude-settings): tambah ANTHROPIC_DEFAULT_FABLE_MODEL ke RESET_ENV_KEYS
b77e2a310 fix(opencode): hapus MESSAGES_MODELS & RESPONSES_MODELS hardcoded, pakai getModelTargetFormat
32c64eb7f fix(antigravity): hapus cabang mati unsigned sibling
7898fd78e chore(dead-code): drop unused imports, use server directives, and exports
```

---

## Per-commit verdict

### `8c9b71efd` — fix(claude-settings): tambah ANTHROPIC_DEFAULT_FABLE_MODEL ke RESET_ENV_KEYS

**Verdict: AMAN**

| Field | Detail |
|-------|--------|
| File | `src/app/api/cli-tools/claude-settings/route.js:200-208` |
| Change | Added `"ANTHROPIC_DEFAULT_FABLE_MODEL"` to `RESET_ENV_KEYS` array |
| Risk | Minimal — additive only, DELETE handler removes one more env key on reset |
| Side effects | None. The DELETE handler iterates the array and calls `delete config.env[key]`; adding a key that does not exist in the config is a no-op |
| Test coverage | No unit test explicitly for this array; covered by `tests/unit/claude-settings-route.test.js` which tests the DELETE handler structure |

**No boundary issue.** Consistent with the existing FABLE model addition in PATCH handler.

---

### `b77e2a310` — fix(opencode): hapus MESSAGES_MODELS & RESPONSES_MODELS hardcoded, pakai getModelTargetFormat

**Verdict: AMAN — caveat: uses alias `"oc"` not `"opencode"`**

| Field | Detail |
|-------|--------|
| Files | `open-sse/executors/opencode.js` |
| Change | Replaced two `Set` constants with `getModelTargetFormat("oc", baseModelId(model))` lookups |
| Correctness | Verified via `node --input-type=module`: `getModelTargetFormat('oc', 'union-alpha')` → `"claude"`, `getModelTargetFormat('oc', 'muse-spark-1.2-contributor-free')` → `"openai-responses"`. Values match original Sets. |
| Config-driven | YES — models now declared once in `providers/registry/opencode.js`, not duplicated in executor |
| Risk | Low. If a new model is added to the registry with `targetFormat: "claude"` or `"openai-responses"`, routing happens automatically without touching the executor. |
| Regression risk | Low. The Sets had only 3 entries total (`union-alpha`, `muse-spark-1.2-contributor-free`, `muse-spark-1.3-contributor-free`). Registry has all 3 with correct `targetFormat`. |

**Known pre-existing issue**: `getThinkingLevels("opencode", model)` at line 156 uses `"opencode"` (registry id) not `"oc"` (alias), and returns `null` — this is a pre-existing bug NOT introduced by this commit.

---

### `32c64eb7f` — fix(antigravity): hapus cabang mati unsigned sibling

**Verdict: AMAN**

| Field | Detail |
|-------|--------|
| File | `open-sse/executors/antigravity.js:235-241` (post-edit lines) |
| Change | Removed 5 lines (the `if (p.thoughtSignature && !cachedSig)` branch with its comment) |
| Dead-code proof | `callSig = p.thoughtSignature \|\| cachedSig \|\| ...`; the deleted branch at lines 238-242 required `callSig` to be falsy AND `p.thoughtSignature` to be truthy simultaneously — logically impossible. |
| Test impact | None — dead code has no test coverage by definition |

---

### `7898fd78e` — chore(dead-code): drop unused imports, use server directives, and exports

**Verdict: AMAN — nota: line-ending normalization side effect**

| Sub-change | File(s) | Verdict |
|-----------|---------|---------|
| Remove `QODER_MODEL_MAP` from import | `open-sse/executors/qoder.js:36` | Aman — confirmed unused (only in comment at line 133) |
| Remove `"use server"` from 10 route handlers | multiple `src/app/api/cli-tools/*/route.js` | Aman — `"use server"` is for Server Actions only; route handlers export named HTTP methods, not actions |
| comboPresets.js unused exports | N/A — no change | All exports are used (by tests or by `presets/route.js`) |

**Side effect**: The CRLF→LF conversion on `deepseek-tui-settings/route.js` and `cowork-mcp-registry/route.js`. These files were CRLF in the repo (`*.js eol=crlf` in `.gitattributes`). The `tail` command produced LF output, so git shows the full file as changed in the diff. On `git checkout`, these files will be re-written as CRLF correctly. **Not a correctness issue**, but the diff is misleadingly large (474 lines changed when only 2 lines were actually removed per file).

**Recommendation**: Consider running `git diff --ignore-space-change` to see actual semantic changes. Or re-do with `sed -i '1{/^"use server";/d}; 2{/^$/d}' file` (in-place) to avoid the CRLF stripping.

---

## Items SKIPPED (not committed)

| Item | Reason |
|------|--------|
| 7 — capabilities dupes | All 3 provider-specific entries have load-bearing deltas (different `thinkingFormat`, `maxOutput`, `thinkingCanDisable`) vs canonical. Removal would break capability resolution for codebuddy-cn, codebuddy-intl, deepseek. |
| 9 — restoreToolName extractor | `toolCall.js:restoreToolName` (singular, single-name lookup for Kiro) and `opencodeFingerprint.js:restoreToolNames` (plural, recursive payload traversal for OpenCode) are different functions with different signatures and purposes. No real duplicate. |
| 10 — cli-tool factory | UI already DRY via `GenericCliToolCard`. API routes have 3 config formats (TOML/JSON providers/YAML) + per-tool schemas — factory complexity ≈ existing code size. 256 existing tests would require re-verification. |
| 11 — BreakdownBarChart/fmtTokens | `fmtTokens` already centralized in `format.js`, imported by all charts. `BreakdownBarChart` component does not exist. Nothing to consolidate. |
| 12 — huggingface test trim | File is 249 lines (task said 348 — stale). Every test covers a distinct invariant. Audit docs already have `upstream-sync-status` as consolidated ledger. |

---

## Test results (after all commits)

```
Test Files  1 failed | 283 passed | 5 skipped (289)
Tests       1 failed | 3035 passed | 47 skipped (3083)
```

The 1 failure is pre-existing: `tests/unit/deploy-atomic.test.js > activates a complete release with one symlink replacement` — present before any of my changes (verified by running baseline before Item 4).

`node scripts/lint-undef.cjs` → `no-undef lint: clean`

---

## Findings by severity

### HIGH — None introduced by these commits.

### MEDIUM

1. **`open-sse/executors/opencode.js:156` — pre-existing**: `getThinkingLevels("opencode", cleanModel)` uses registry id `"opencode"` but `PROVIDER_MODELS` key is `"oc"` (the alias). Returns `null` always. This means thinking-level normalization in `normalizeOpencodeReasoning` is silently skipped. **Not introduced by Item 5** (the function was already there; I only changed lines 14-18/97-103).

### LOW

2. **`7898fd78e` CRLF side effect** (file: `deepseek-tui-settings/route.js`, `cowork-mcp-registry/route.js`): Line endings stripped from CRLF to LF during edit. `.gitattributes` will restore on checkout but diff is misleadingly large. No functional impact.

3. **Item 5 alias dependency**: `isResponsesModel`/`isMessagesModel` now depend on `"oc"` alias remaining stable. If the `opencode` provider's alias changes, routing breaks silently. Low risk — alias is declared in registry and checked by tests.
