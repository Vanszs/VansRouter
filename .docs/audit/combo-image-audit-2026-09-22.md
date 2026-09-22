# Combo × image generation — upstream audit + implementation plan (2026-09-22)

Question asked: does upstream `decolua/9router` have an image feature in combos, and how can VansRouter
implement it without breaking existing features?

Short answer: **upstream does not execute image generation through combos — but this fork already does.**
The only upstream combo/image intersection is kind-aware *listing*. The real work is therefore not a port;
it is a small parity gap in `/v1/models` plus documentation.

Refs: our tree `main` @ `30505eab2`; upstream `upstream/master` @ `a8c9d3802` (v0.5.81, fetched 2026-09-22).

## 1. Upstream findings (decolua/9router)

| Claim | Evidence |
|---|---|
| Combo service has no kind/serviceKind filtering and no image-generation logic | `open-sse/services/combo.js` — `git grep "serviceKind\|kind ===\|\"llm\"\|kinds"` → 0 hits |
| The only "image" logic in the combo service is **vision input** capability detection, not image output | `open-sse/services/combo.js:10`, `:91`, `:111`, `:120`, `:144-145`, `:161`, `:169` |
| The image execution path never consults combos | `git grep "combo" upstream/master -- open-sse/handlers/imageGenerationCore.js src/app/api/v1/images` → 0 hits |
| Image generation is per-provider handlers, not combo-routed | `open-sse/handlers/imageGenerationCore.js` + `open-sse/handlers/imageProviders/{antigravity,blackForestLabs,cloudflareAi,codex,comfyui,falAi,gemini,huggingface,nanobanana,openai,runwayml,sdwebui}.js` |
| Combos do carry a `kind`, and the **listing** filters by it | `src/app/api/v1/models/route.js:146` (LLM kind sentinel), `:152` (`image: "image"`), `:172` (infer kind from model name), `:245-246` `comboMatchesKinds()`, `:305-313` (combo listing, special-case `webSearch`/`webFetch`) |
| No documentation of image combos | `gitbook/content/en/features/combos.md` — `grep -i image` → 0 hits |

Conclusion: there is no upstream "combo → image generation" feature to port. Upstream's half is the
`kind` system and per-kind model listing; execution stays on the single-provider image path.

## 2. What this fork already has

| Claim | Evidence |
|---|---|
| Image endpoint is a thin wrapper, same path as upstream | `src/app/api/v1/images/generations/route.js:1` (`handleImageGeneration`), 16 lines total |
| Image requests are ACL-gated per kind | `src/sse/handlers/imageGeneration.js:56` — `if (!isKindAllowed(apiKeyInfo, "image")) return 403` |
| **Combo expansion already exists on the image path** | `src/sse/handlers/imageGeneration.js:59-79` — `getComboModels(modelStr)`, `stripComboPrefix()`, strategy from `settings.comboStrategies[name].fallbackStrategy`, `comboStickyRoundRobinLimit`, per-combo `targetTimeoutMs` / `queueDepth` |
| Per-member provider ACL is enforced | `src/sse/handlers/imageGeneration.js:92` — `isProviderAllowed(apiKeyInfo, provider)` |
| Combo helpers are shared with the chat path | `src/sse/handlers/imageGeneration.js:20` imports `handleComboChat`, `stripComboPrefix` from `open-sse/services/combo.js` |
| Chat path gates the LLM kind the same way | `src/sse/handlers/chat.js:150-152` — `isKindAllowed(apiKeyInfo, "llm")` |
| Our combo service mirrors upstream (vision-input detection only) | `open-sse/services/combo.js:17`, `:100`, `:121`, `:125`, `:134`, `:138`, `:143`, `:147` |
| Our `/v1/models` has kind awareness but **no combo kind filter** | `src/app/api/v1/models/route.js:14` (`LLM_KIND`), `:59` (`buildModelsList([LLM_KIND])`), `:76` (`isKindAllowed(apiKeyInfo, model.kind \|\| LLM_KIND)`) — `grep comboMatchesKinds` in this file → 0 hits |

So the fork is ahead of upstream here: upstream lists combos by kind but cannot run an image combo;
this fork can run an image combo (`fallback` / round-robin / sticky, with per-member provider ACL) but
does not slice the combo listing by kind.

## 3. Gap (actionable, ordered by value ÷ risk)

1. **Combo listing is not kind-filtered** — `/v1/models` cannot distinguish an image combo from an LLM
   combo, so clients (and the dashboard picker) cannot discover image combos by kind. Upstream has this
   (`route.js:245-246 comboMatchesKinds`); we do not.
2. **Documentation** — nothing in this repo explains that a combo name can be passed to
   `/v1/images/generations`, nor which strategies apply (unverified: `docs/` was not audited for combo
   image usage in this pass; the repo's `AGENTS.md` describes combo strategies without mentioning image).
3. **No per-kind combo endpoint** — upstream lists sub-endpoints (`/v1/models/image-to-text`, etc. per
   `route.js:437-481`); ours exposes `[LLM_KIND]` only at `route.js:59`. Optional parity.

Not a gap: combo execution, fallback, sticky round-robin, per-member provider ACL — all already present
on the image path (`imageGeneration.js:59-92`).

## 4. Implementation plan

**Step 1 (smallest real change): kind-filter the combo listing.**
- File: `src/app/api/v1/models/route.js` only.
- Add a `comboKindMatches(combo, kindFilter)` helper next to the existing `buildModelsList` usage
  (default kind = `LLM_KIND`, mirroring upstream `route.js:146,245-246`), and skip combos whose kind is
  not in the requested filter. Combos without an explicit `kind` keep defaulting to LLM, so nothing that
  works today disappears.
- Do **not** touch `isKindAllowed` (`:76`), the ACL helpers, or the chat path — those are custom logic
  that other tests lock.
- Tests that must stay green: `pnpm test tests/unit/` (full suite, 258 files), plus the custom-logic
  locks `post-merge-verification`, `handler-acl-enforcement`, `apikey-acl-security`, `acl-provider-list`,
  `models-acl-robustness`, `acl-custom-prefix`, `translator-custom-prefix`; `node scripts/lint-undef.cjs`.
- New test: one unit test asserting an image-kind combo is hidden from the default LLM list and visible
  when `image` is requested, and that a combo without `kind` still shows as LLM.

**Step 2 (documentation only):** document "combo name in `/v1/images/generations`" (strategies, sticky
limit, ACL behavior) where the repo documents combos.

**Step 3 (optional parity):** expose an image-kind listing endpoint, mirroring upstream's
`/v1/models/image-to-text` pattern (`route.js:437-481`). Skip unless a client needs it.

### Risk list (custom logic that must not regress)

| Risk | Why it matters | Mitigation |
|---|---|---|
| ACL per API key (`allowedProviders`, `allowedCombos`, `allowedKinds`) | Listing or running a combo must never expose a provider/model the key may not use | Extend the existing `isKindAllowed` check; never bypass it. Step 1 changes only *listing*, not authorization |
| `comboMatchesKinds` semantics drift | Hiding combos that worked before is a silent breaking change | Default missing `kind` to `LLM_KIND` (upstream behavior, `route.js:146`) |
| ZCode / branding / searxng fallback / volume `9router-data` / multi-connection guard | Untouched by step 1 (single file, listing only) | Keep the diff inside `route.js`; verify with `git status --short` |
| Dashboard combo picker | A stricter listing may hide combos in the UI | Covered by the new test + manual check of the model list endpoint response |

### Status

- Findings are static (code-level) only; live end-to-end combo image generation is **UNVERIFIED**.
- Documentation coverage was not audited.
- The cited code paths describe the observed upstream and fork behavior; no live provider call was made.
