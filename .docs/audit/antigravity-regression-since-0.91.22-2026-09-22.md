# Audit — did anything since `v0.91.22` break the Antigravity (agy) tool-schema path?

- Repo: `/home/bevan/code/9router` (Vanszs/VansRouter, fork of decolua/9router)
- HEAD: `3b0a6f515` (`feat(usage): show deepseek credit balance as currency`), working tree `main`
- Base: tag `v0.91.22` = `53c46761c` (2026-09-15, `docs(changelog): release v0.91.22`)
- Range size: **19 commits** (`git log --oneline v0.91.22..HEAD | wc -l` → 19)
- Question: has any change since `v0.91.22` broken the Antigravity tool-parameter schema path that provokes
  `400 INVALID_ARGUMENT: Unknown name "optional"` (reported as open issue #134, path
  `request.tools[0].function_declarations[63].parameters.properties[2].value`)?
- Scope rule for this audit: read-only except this file. No source edits, no commits, no pushes, no GitHub calls.

## 0. Verdict in one paragraph

**No.** No commit in `v0.91.22..HEAD` touches the Antigravity tool-schema path. All seven files that build or
sanitize the outgoing agy tool payload are **byte-identical** between `v0.91.22` and HEAD (blob SHA-256 table in
§3.2), and `git log v0.91.22..HEAD` for every one of those paths is empty. A harness run of the same probe on both
revisions produces **identical** payloads with **zero** occurrences of `"optional"` — the keyword is already stripped
at `v0.91.22`, including at the nesting depth named in the issue
(`parameters.properties[*].value`). So the behaviour is **pre-existing, not a regression from this range**; the
strip existed before `v0.91.22` (list entry added `db9ec3af6`, 2026-06-17; executor sanitizer `c43f8c54d`,
2026-04-26). Two things remain unprovable without live credentials or the reporter's raw payload, and are marked
UNVERIFIED / MENCURIGAKAN in §4 and §6: (a) an end-to-end live request to Google, and (b) the fact that the reported
error path uses snake_case `function_declarations`, which **has never existed anywhere in this repository's history**
(`git grep -i function_declarations` → 0 hits; `git log -S'function_declarations' --all` → no commits).

---

## 1. Range + exact commands (raw)

### 1.1 Antigravity-specific paths — no changes at all

```console
$ git log --oneline v0.91.22..HEAD --stat -- \
    open-sse/executors/antigravity.js open-sse/executors/antigravity/ \
    open-sse/providers/registry/antigravity.js open-sse/translator/formats/gemini.js \
    open-sse/translator/request/openai-to-gemini.js open-sse/translator/request/antigravity-to-openai.js \
    open-sse/translator/response/openai-to-antigravity.js open-sse/services/antigravityHeaderScrub.js \
    open-sse/translator/formats/openai.js open-sse/translator/request/gemini-to-openai.js \
    open-sse/translator/request/openai-responses.js
[EMPTY — no commits touched any of these paths in the range]

$ git diff v0.91.22 HEAD -- <same path list>
[EMPTY — working content identical]
```

`open-sse/providers/capabilities.js` is the **only** requested path with a change:

```console
$ git log --oneline v0.91.22..HEAD --stat -- open-sse/providers/capabilities.js
50239fb90 feat(models): add deepseek-v4.1-flash with effort levels and vision
 open-sse/providers/capabilities.js | 22 ++++++++++++++++++++++
 1 file changed, 22 insertions(+)

$ git diff v0.91.22 HEAD -- open-sse/providers/capabilities.js
@@ -701,6 +701,28 @@ export const PROVIDER_CAPABILITIES = {
       maxOutput: 262144,
     },
   },
+  // DeepSeek V4.1 Flash reads images and takes the full low..max effort range
+  // (see PATTERN_THINKING); the shared *deepseek-v4* pattern carries neither flag.
+  deepseek: {
+    "deepseek-v4.1-flash": {
+      vision: true, reasoning: true, thinkingFormat: "deepseek",
+      thinkingEffortSupported: true, contextWindow: 1000000, maxOutput: 128000,
+    },
+  },
+  // Ollama Cloud serves the same model (mirrored tag) with image input.
+  ollama: {
+    "deepseek-v4.1-flash:cloud": {
+      vision: true, reasoning: true, thinkingFormat: "deepseek",
+      contextWindow: 1000000, maxOutput: 384000,
+    },
+  },
 };
```

Only `deepseek` / `ollama` keys added — no `antigravity` key (`open-sse/providers/capabilities.js:704-725`).

### 1.2 Translator paths that mention `function_declarations` (tracked files)

```console
$ git grep -ln "function_declarations\|functionDeclarations" --
open-sse/executors/antigravity.js
open-sse/translator/formats/openai.js
open-sse/translator/request/antigravity-to-openai.js
open-sse/translator/request/gemini-to-openai.js
open-sse/translator/request/openai-responses.js
open-sse/translator/request/openai-to-gemini.js
tests/translator/__snapshots__/golden-request.test.js.snap
tests/translator/bugs-antigravity.test.js
tests/translator/real/all-formats.real.test.js
tests/unit/antigravity-retry-hook.test.js

$ git log --oneline v0.91.22..HEAD --stat -- <those non-test paths>
[EMPTY]        # openai-responses.js here is the request direction; the changed file is
               # response/openai-responses.js (commit dde5da4c8, §2 row 2)
```

Snake_case variant, whole repo, all history:

```console
$ git grep -in "function_declarations"        # tracked files, case-insensitive
[no output, exit 0 — 0 hits]
$ git log --oneline -S'function_declarations' --all
[no output — the token never existed in any commit]
$ git log --oneline -S'functionDeclarations' | wc -l
17
```

The outgoing agy field is camelCase (`open-sse/executors/antigravity.js:263`, `:312`). The reported error path uses
snake_case `function_declarations` — see §4 step 10 / §6.

### 1.3 `src/**` naming antigravity

```console
$ SRCPATHS=$(git ls-files 'src/**' | xargs grep -ril antigravity)   # 26 files
$ git log --oneline v0.91.22..HEAD --stat -- $SRCPATHS
3b0a6f515 feat(usage): show deepseek credit balance as currency
 .../(dashboard)/dashboard/usage/components/ProviderLimits/utils.js   | 5 +++++
235240998 perf(rtk): size requests without serializing the body
 src/sse/handlers/chat.js | 12 +++++++-----
2eaeba2d2 fix(api): bound request bodies on every entry point
 src/sse/handlers/chat.js | 29 +++++------------------------
f395abcf5 fix(providers,chat,rtk): tokenrouter API host, opencode free-tier identity, request body ceiling
 src/sse/handlers/chat.js | 20 +++++++++++++++++++-
```

Only two of the 26 antigravity-named `src` files changed: `src/sse/handlers/chat.js` (body ceiling + byte plumbing)
and `.../ProviderLimits/utils.js` (DeepSeek quota copy). `src/mitm/**`, `src/lib/oauth/providers/antigravity.js`,
`src/sse/services/antigravityQuota.js`, `src/sse/services/auth.js`, `src/sse/services/tokenRefresh.js`: untouched.

### 1.4 Whole-range change inventory (context for §2)

```console
$ git diff v0.91.22 HEAD --stat
71 files changed, 3719 insertions(+), 1555 deletions(-)
```
(`git diff v0.91.22 HEAD --name-status | awk '{print $1}' | sort | uniq -c` → `55 M`, `16 A`; no antigravity/agy/tool-schema file among them.)

---

## 2. Classification table

Rubric used (so the labels are falsifiable):
- **AMAN** — file lies on the agy request/stream path, but the change provably cannot alter the tool schema.
- **TIDAK RELEVAN** — the change is outside the agy request path (UI, docs, tests, other provider/modality, DB).
- **MENCURIGAKAN** — plausible causal link to the reported 400 that static + harness evidence cannot exclude.
- **UNVERIFIED** — needs live credentials / the reporter's raw payload.

One row per commit in `v0.91.22..HEAD` (19 rows), SHA + file:line per change.

| SHA | file:line | what changed | touches agy tool-schema path? | verdict | reason |
|---|---|---|---|---|---|
| `3b0a6f515` | `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js:515-530`; `open-sse/services/usage/deepseek.js:91-104`; `.../ProviderLimits/QuotaTable.js:1-285` | DeepSeek prepaid credit rendered as currency | no | TIDAK RELEVAN | usage UI/parse only; no request-body code. This file appears in the `src/**` antigravity grep only through quota copy. |
| `dde5da4c8` | `open-sse/translator/response/openai-responses.js:14-59,145-159,378-385`; `open-sse/utils/stream.js:103-116` | usage reported on `response.completed` | no | TIDAK RELEVAN | response direction. The agy response translator is `response/openai-to-antigravity.js` — untouched (§1.1). |
| `b9e95f575` | `open-sse/translator/concerns/thinking.js:34-49`; `src/lib/db/repos/usageRepo.js:539-551` | max thinking tier + bounded `lastUsed` scan | no | TIDAK RELEVAN | thinking budget mapping + DB query only. |
| `50239fb90` | `open-sse/providers/capabilities.js:704-725`; `open-sse/providers/registry/deepseek.js:48-54`; `open-sse/providers/registry/ollama.js:28-34`; `open-sse/providers/thinkingLevels.js:41-50` | deepseek-v4.1-flash caps + ollama mirror | no | TIDAK RELEVAN | diff adds only `deepseek`/`ollama` keys, no `antigravity`; capabilities are consumed by `paramSupport` → `executors/default.js:9` / `executors/github.js:10`, never by the agy executor. |
| `bbe6a622a` | `open-sse/translator/concerns/paramSupport.js:18-24,39-45` | drop replayed `reasoning_content` for groq/mistral/cerebras | no | TIDAK RELEVAN | rules are provider-scoped; module imported only by default/github executors; operates on top-level params and `body.messages` only — never on `tools`. |
| `5a267e7d0` | `open-sse/translator/concerns/finishReason.js:11-20,59-65`; `open-sse/translator/schema/finishReasons.js:14-22`; `open-sse/translator/response/claude-to-openai.js:160-174` | Claude refusal → `content_filter` | no | TIDAK RELEVAN | finish-reason enum mapping, response side. |
| `c7bdf5b78` | `open-sse/utils/streamHelpers.js:1-159`; `open-sse/utils/streamHandler.js:201-273`; `open-sse/handlers/chatCore/streamingHandler.js:4-21,166-179` | aborts reported in-band after a 200 | no | TIDAK RELEVAN | stream/abort segment; no request-body or tool-schema mutation. |
| `5d05992e4` | `open-sse/translator/request/openai-to-kiro.js:575-588`; `open-sse/translator/request/claude-to-kiro.js:162-182,477-490`; `open-sse/translator/response/kiro-to-openai.js:16-57,134-140` | kiro tool-name underscores, tool-result images | no | TIDAK RELEVAN | kiro format only; the agy pair and `formats/gemini.js` untouched (§1.1). |
| `947ad5e59` | `open-sse/handlers/chatCore.js:172-188,312-319`; `open-sse/rtk/index.js:1-6` | RTK runs pre-translate for `cursor` only | indirectly (shared core) | AMAN | branch is `provider === "cursor"` (`chatCore.js:175-183`). RTK walks only `body.messages` / `body.input` tool-result content (`rtk/index.js:29-30,104`); `grep -n "tools\|schema\|properties\|parameters" open-sse/rtk/index.js` → 0 hits. For an agy request the translated envelope has neither `messages` nor `input` → no-op. |
| `757438f15` | `open-sse/services/model.js:127`; `open-sse/providers/registry/codex.js:60-68` | bare `codex-auto-review` → codex | no | AMAN | new rule `[/^codex-auto-review$/, "codex"]` matches only that literal id, placed ahead of `/^gemini-/` (`model.js:124-131`); no antigravity model id matches it. |
| `91816788c` | `src/app/(dashboard)/dashboard/combos/page.js:293-303,492-502,649-671,701`; `src/shared/components/ModelSelectModal.js:29,151-161,171-180,191` | vision badge in combo editor | no | TIDAK RELEVAN | dashboard UI. |
| `31f40fb35` | `.docs/audit/combo-image-audit-2026-09-22.md` (whole file, 92 lines); `.docs/audit/vansrouter-issue-audit-2026-09-22.md` | doc wording | no | TIDAK RELEVAN | docs only. |
| `6105a97a3` | `tests/unit/request-body-limits.test.js`; `tests/unit/opencode-session.test.js` | test-only edits | no | TIDAK RELEVAN | no runtime files. |
| `636d144c2` | `open-sse/executors/opencode.js:45-69,112-182` | stable opencode session/request ids | no | TIDAK RELEVAN | different provider executor. |
| `235240998` | `open-sse/rtk/index.js:14-22,98-120`; `open-sse/handlers/chatCore.js:128,316`; `src/sse/handlers/chat.js:59-64` | size the body without re-serializing; pass `clientBodyBytes` | indirectly (shared core/entry) | AMAN | only measures bytes and gates RTK (`RTK_MAX_BODY_BYTES`, `rtk/index.js:14-22,98-120`); no schema read/write. |
| `2eaeba2d2` | `src/sse/utils/boundedBody.js:1-43`; `src/sse/handlers/chat.js:59-64`; `src/app/api/v1/api/chat/route.js:2,30`; `src/app/api/v1/responses/route.js:2,34`; `src/app/api/v1beta/models/[...path]/route.js:2,86` | 8 MiB body ceiling → HTTP 413 | yes (entry of the agy chat route) | AMAN (caveat) | cannot produce `Unknown name "optional"`. Rejects only bodies > 8 MiB with 413 (`boundedBody.js:22-31`); default 8 MiB (`:6`), overridable by `NINEROUTER_MAX_BODY_BYTES` (`:9`). Caveat: if a reporter's payload exceeds 8 MiB they now get 413 instead of being accepted — a different symptom, not #134. |
| `72bb44107` | `open-sse/providers/registry/index.js:143-151,292-299`; `open-sse/providers/registry/selfhosted-embedding.js` (new, 73 lines); `selfhosted-stt.js` (new, 48); `selfhosted-tts.js` (new, 44) | adopt upstream self-hosted registries | no | TIDAK RELEVAN | embedding/stt/tts kinds only. |
| `f395abcf5` | `open-sse/rtk/index.js:1-165` (rewrite); `open-sse/config/runtimeConfig.js:10`; `open-sse/executors/cursor.js:186-206,333-345`; `open-sse/executors/opencode.js`; `open-sse/providers/registry/{tokenrouter,opencode}.js`; `src/sse/handlers/chat.js:59-64` | tokenrouter host, opencode identity, 413 constant, RTK rewrite | indirectly (RTK + chat entry) | AMAN | rewrite still touches only tool-result content (`rtk/index.js:29-30,104`); file contains no `tools`/`schema`/`properties`/`parameters` token; RTK is fail-open and returns null for non-message shapes. |
| `7f42ef426` | `next.config.mjs:1-6,37-64`; `src/lib/db/driver.js:1-119` | keep healthy SQLite files when the driver can't load | no | TIDAK RELEVAN | build/DB runtime. |

Requested-path inventory (paths from §1.1 — "no change" is itself the finding, so these have no SHA to cite):

| Requested path | commits in range | consequence for #134 |
|---|---|---|
| `open-sse/executors/antigravity.js` | none | final agy tool assembly unchanged |
| `open-sse/executors/antigravity/` (sseCollect.js) | none | response collection unchanged |
| `open-sse/providers/registry/antigravity.js` | none | provider format/models unchanged |
| `open-sse/translator/formats/gemini.js` | none | keyword list + sanitizer unchanged |
| `open-sse/translator/request/openai-to-gemini.js` | none | tool→functionDeclarations assembly unchanged |
| `open-sse/translator/request/antigravity-to-openai.js`, `request/gemini-to-openai.js`, `formats/openai.js`, `request/openai-responses.js` | none | inbound tool conversion unchanged |
| `open-sse/providers/capabilities.js` | `50239fb90` (§2) | deepseek/ollama keys only |
| `src/**` naming antigravity (26 files) | `3b0a6f515`, `235240998`, `2eaeba2d2`, `f395abcf5` (§2) | no tool-schema logic in any of them |

---

## 3. Origin test — is the `optional` leak pre-existing at `v0.91.22`?

**Method: both (a) and (b).** (a) temporary worktree at `v0.91.22` + the same harness run on both revisions — chosen
because it is the only way to show behaviour, not just text identity; (b) blob SHA-256 comparison of the files that
build `function_declarations` — used as the authoritative "identical vs changed" proof, because the worktree checkout
normalises line endings (`.gitattributes`: `*.js text eol=crlf`) so *working-tree* hashes in the worktree differ from
blob hashes even for unchanged files.

Harness: `tests/unit/scratch-optional-probe.test.js` (untracked, **pre-existing** — present in `git status` before this
audit started; not created or modified by this audit). It calls `translateRequest("openai"|"claude"|"gemini" → "antigravity")`
and then `new AntigravityExecutor().transformRequest(...)`, with a schema containing `optional` at depth 1
(`properties.q`) and at depth 3 (`properties.opts.properties.value`).

### 3.1 (a) Worktree run — raw

```console
$ git worktree add /tmp/agy-09122 v0.91.22
Preparing worktree (detached HEAD 53c46761c)
HEAD is now at 53c46761c docs(changelog): release v0.91.22
$ ln -s /home/bevan/code/9router/node_modules /tmp/agy-09122/node_modules
$ cp tests/unit/scratch-optional-probe.test.js /tmp/agy-09122/tests/unit/
$ cd /tmp/agy-09122 && ./node_modules/.bin/vitest run -c tests/vitest.config.js tests/unit/scratch-optional-probe.test.js --reporter=verbose
 ✓ probe > openai -> antigravity 10ms
 ✓ probe > claude -> antigravity 2ms
 ✓ probe > gemini native -> antigravity 3ms
 Test Files  1 passed (1)     Tests  3 passed (3)      EXIT=0
```

Both trees, payload check:

```console
$ grep -c '"optional"' /tmp/agy-probe-HEAD.txt /tmp/agy-probe-v09122.txt
/tmp/agy-probe-HEAD.txt:0
/tmp/agy-probe-v09122.txt:0
```

Normalised stdout diff (timestamps/duration stripped) — the only difference is the vitest working directory:

```console
$ diff <HEAD stdout> <v0.91.22 stdout>
1c1
<  RUN  v3.2.7 /home/bevan/code/9router
---
>  RUN  v3.2.7 /tmp/agy-09122
# everything else byte-identical
```

`v0.91.22` payload (openai → antigravity). The run prints a `TRANSLATED:` block and a `FINAL:` block; both print the
same object (the executor's re-sanitize at `antigravity.js:255` is a no-op on already-clean input). Raw dump
re-indented for width, key order and values unchanged:

```json
[
  { "functionDeclarations": [
      { "name": "search", "description": "search",
        "parameters": {
          "type": "object",
          "properties": {
            "q":    { "type": "string" },
            "opts": { "type": "object",
                      "properties": { "value": { "type": "string" } } }
          },
          "required": [ "q" ]
        } } ] }
]
```

So at `v0.91.22` the nested `opts.properties.value.optional` **and** the top-level `q.optional` are already removed;
HEAD produces the identical object. The issue's path shape `parameters.properties[*].value` is exactly the probing
case here.

### 3.2 (b) Blob identity of the files that build `function_declarations`

```console
$ for f in <paths>; do a=$(git show HEAD:$f | sha256sum | cut -c1-16); b=$(git show v0.91.22:$f | sha256sum | cut -c1-16); ...
SAME  HEAD=a733d09ee7bd7f2d  v0.91.22=a733d09ee7bd7f2d  open-sse/translator/formats/gemini.js
SAME  HEAD=d9bfbd20df2919a0  v0.91.22=d9bfbd20df2919a0  open-sse/executors/antigravity.js
SAME  HEAD=8b918a6c4231d461  v0.91.22=8b918a6c4231d461  open-sse/translator/request/openai-to-gemini.js
SAME  HEAD=0aa0d86c21d51a59  v0.91.22=0aa0d86c21d51a59  open-sse/translator/request/antigravity-to-openai.js
SAME  HEAD=ca08a75158c12b87  v0.91.22=ca08a75158c12b87  open-sse/translator/response/openai-to-antigravity.js
SAME  HEAD=141138271303deb5  v0.91.22=141138271303deb5  open-sse/providers/registry/antigravity.js
SAME  HEAD=a47dc64300d9cced  v0.91.22=a47dc64300d9cced  open-sse/services/antigravityHeaderScrub.js
$ git show v0.91.22:open-sse/translator/formats/gemini.js | grep -n '"optional"'
30:  "title", "optional", "deprecated", "if", "then", "else", "contentMediaType", "contentEncoding",
```

### 3.3 When the strip entered the tree (git archaeology)

```console
$ git log --oneline --format='%h %ad %s' --date=short -S'"optional"' -- open-sse/translator/formats/gemini.js
db9ec3af6 2026-06-17 fix(antigravity): strip optional from tool schemas before Gemini
$ git log --oneline --format='%h %ad %s' --date=short -S'cleanJSONSchemaForAntigravity' -- open-sse/executors/antigravity.js
c43f8c54d 2026-04-26 fix: Antigravity INVALID_ARGUMENT errors and Copilot agent mode parity
$ git tag --contains db9ec3af6 | sort -V | head -3
v0.5.2  v0.5.4  v0.5.6
```

**Origin result: the `optional`-stripping behaviour is pre-existing at `v0.91.22`.** Evidence supports it being in
every release containing `db9ec3af6` (first tag `v0.5.2`, 2026-06-17), i.e. long before `v0.91.22` (2026-09-15).
Nothing in `v0.91.22..HEAD` changed it, added it, or removed it.

### 3.4 Cleanup

```console
$ git worktree remove --force /tmp/agy-09122 && ls /tmp/agy-09122
ls: cannot access '/tmp/agy-09122': No such file or directory
$ git worktree list
/home/bevan/code/9router                                    3b0a6f515 [main]
/home/bevan/code/9router/.kilo/worktrees/circular-barbecue  95741b3c1 [circular-barbecue]
/home/bevan/code/9router/.kilo/worktrees/trusted-hawk       e53dbc5bd [trusted-hawk]
/home/bevan/code/9router/.kilo/worktrees/wakeful-evergreen  33b266f6f [wakeful-evergreen]
/tmp/kilo/upstream-9router                                  699edac32 (detached HEAD) prunable
/tmp/vansrouter-pr104                                       21fd296a9 (detached HEAD) prunable
```

The two `prunable` entries and the three `.kilo/worktrees/*` entries pre-date this audit (same list before the temp
worktree was added); no temp worktree of this audit remains.

---

## 4. Leak path, step by step (OpenAI tool definition → outgoing Gemini payload)

1. **Client sends OpenAI tools** — `body.tools[].function.parameters` (JSON Schema; `optional` may sit at any depth).
2. **Format detection / route** — `open-sse/services/provider.js:36-37` (`body.request.contents` + `body.userAgent === "antigravity"` → `"antigravity"`); `/v1/chat/completions` route `src/sse/handlers/chat.js:59-64` (body read with the 8 MiB ceiling); MITM passthrough for the IDE lands here via `src/mitm/handlers/antigravity.js:13-18`.
3. **Translator registration** — `open-sse/translator/request/openai-to-gemini.js:456-458`: `register(OPENAI, GEMINI)`, `register(OPENAI, GEMINI_CLI)`, `register(OPENAI, ANTIGRAVITY)`.
4. **Keyword constant** — `open-sse/translator/formats/gemini.js:7-34` `UNSUPPORTED_SCHEMA_CONSTRAINTS`; **`"optional"` at `gemini.js:30`** (identical line number at `v0.91.22`).
5. **Sanitizer entry** — `gemini.js:312-398` `cleanJSONSchemaForAntigravity()`; **Phase 3 at `gemini.js:330-331`** calls `removeUnsupportedKeywords(cleaned, UNSUPPORTED_SCHEMA_CONSTRAINTS)`.
6. **Recursion** — `removeUnsupportedKeywords` at `gemini.js:138-159`: array branch `:141-146`, per-key recursion `:148-157`, `delete obj[key]` at `:150`. `properties` is **not** in the blocklist (`:9-33`) and there is no depth cap, so recursion enters `parameters.properties.<name>` and then that object's own `properties.<name>` — i.e. the reported `parameters.properties[*].value` (in the Google error, `.value` is the map-entry value: the nested property schema). **Verified empirically**: the probe's `properties.opts.properties.value.optional` is removed at both revisions (§3.1).
7. **Assembly #1 (translate)** — `openai-to-gemini.js:197` (Claude-style `input_schema`), `:207` (OpenAI `function.parameters`), `:216-218` (`result.tools = [{ functionDeclarations }]`), then `openaiToGeminiCLIRequest` re-cleans at `:236-249`, and `wrapInCloudCodeEnvelope` copies the cleaned tools into the envelope at `:268` (+ `VALIDATED` toolConfig `:280-284`). Claude-model route: `:397-411` with the sanitizer at `:402`.
8. **Final assembly + last line of defence (executor)** — `open-sse/executors/antigravity.js:239-264`: merges all groups into one `functionDeclarations` array, sanitizes each schema at **`:255`** (`cleanJSONSchemaForAntigravity(structuredClone(fn.parameters))`), deletes `parametersJsonSchema` at `:260`; the request whitelist `AG_REQUEST_FIELDS` at `:271-281` excludes `tools`; sanitized tools are injected at `:312` with `functionCallingConfig.mode = "VALIDATED"` at `:315`; OpenAI-format leak fields stripped at `:330-341`. Called from `open-sse/executors/base.js:133` in every `execute` (Antigravity has no `execute` override), and `getExecutor("antigravity")` resolves to `AntigravityExecutor` (`open-sse/executors/index.js:31`).
9. **Conclusion of the code reading**: on this fork's agy paths (openai / claude / gemini / gemini-cli / antigravity-envelope / responses → antigravity) an `optional` keyword at any depth is stripped twice — in the translator and again in the executor before send.
10. **UNVERIFIED (needs live credentials):** that a live request to Google actually satisfies the upstream schema — nothing here executes the HTTP call. What would prove it: `RUN_REAL=1 AG_KEY=<key> npx vitest run -c tests/vitest.config.js tests/translator/real/antigravity-models.real.test.js` (that file already asserts the exact error shape at `tests/translator/real/antigravity-models.real.test.js:105-120`), or a request-body dump of a live #134 repro at the MITM layer.
11. **MENCURIGAKAN (report-shape mismatch):** the reported path uses snake_case `function_declarations`, which this repository has never emitted or contained (`§1.2`: `git grep -i function_declarations` → 0 hits, `git log -S` → no commits; the code emits `functionDeclarations`). Possible explanations that cannot be separated without the reporter's raw payload: Google rendering its internal proto field names in the error, the reporter running the upstream decolua build or an older/other router, or a client sending snake_case directly (which this executor would silently *drop*, not leak — `antigravity.js:247` reads `group.functionDeclarations`). Additionally, MITM forwards untouched to Google when the model is unmapped or matches `MODEL_NO_MAP` (`src/mitm/server.js:355-365`, `src/mitm/config.js:73-75` — `antigravity: [/^tab[_-]/i]`), so a 400 seen through MITM is not necessarily produced by this code.

---

## 5. Final verdict

**(a) Does any post-`v0.91.22` change break the agy tool-schema path?** No. No commit in the range touches any file
that builds, sanitizes, or sends the agy tool payload; the four relevant files are byte-identical to `v0.91.22`
(§3.2) and the whole-path `git log`/`git diff` for them is empty (§1.1). The one shared-core change that came near the
payload (RTK) provably never writes to `tools` and is a no-op on the agy envelope.

**(b) If not, is it pre-existing, and since which version?** Yes, pre-existing. The `optional` entry in
`UNSUPPORTED_SCHEMA_CONSTRAINTS` (`gemini.js:30`) and its recursive application are present and behaving identically at
`v0.91.22` (harness output identical, §3.1; blobs identical, §3.2). The strip itself dates to `db9ec3af6`
(2026-06-17) and the executor-level sanitizer to `c43f8c54d` (2026-04-26); the earliest tag containing `db9ec3af6`
is `v0.5.2`. So on this code line the `optional` behaviour has been stable since at least `v0.5.2`/`v0.91.22`, and
issue #134 cannot be a regression introduced between `v0.91.22` and HEAD `3b0a6f515`.

**(c) Recommended fixes (recommendations only — nothing implemented here)**

1. **Reproduce live before changing anything.** Add the reporter's exact 64-tool set (or capture their raw request)
   to `tests/translator/real/antigravity-models.real.test.js`, run with `RUN_REAL=1` against a real agy connection,
   and enable the MITM body dumper to inspect the *outgoing* `request.tools` bytes. Target: prove or refute that
   `optional` reaches Google. Files: `tests/translator/real/antigravity-models.real.test.js` (extend), plus the
   reporter's fixture under `tests/fixtures/`.
2. **Promote the ad-hoc probe into a tracked regression test** at
   `tests/translator/bugs-antigravity.test.js` (next to the existing single-level case at `:118-143`), covering
   *deep* nesting `parameters.properties[a].value.properties[b].value.optional` through `translateRequest` — with
   `import "./registerAll.js"`, because `tests/translator/AGENTS.md` §5 documents that `translateRequest` silently
   no-ops under vitest without it (the untracked probe used here worked, but the tracked test must not depend on that).
3. **Assert the invariant, not the incident**: a test that fails if any path can assemble `functionDeclarations`
   without `cleanJSONSchemaForAntigravity` (the four call sites in §4 step 7/8 are the only ones today:
   `openai-to-gemini.js:197,207,239,402`, `antigravity.js:255`). File:
   `tests/translator/bugs-antigravity.test.js`.
4. **Close #134 as "not reproducible on our build" only after (1)**, citing: blobs identical to `v0.91.22`,
   harness identical output, snake_case `function_declarations` absent from all history. If (1) reproduces the 400,
   reopen with the outgoing body dump; then the fix belongs in `open-sse/translator/formats/gemini.js` (keyword list /
   recursion) — or in the MITM passthrough path if the request never entered translation.
5. **Optional observability (YAGNI unless (1) fails to reproduce):** log the count of stripped keywords per outgoing
   payload at `antigravity.js:255` behind an env flag, so a future report can be triaged without a body dump.

**Tests that must pass for any of the above:**
```bash
npx vitest run -c tests/vitest.config.js tests/translator/bugs-antigravity.test.js
npx vitest run -c tests/vitest.config.js tests/translator/
RUN_REAL=1 AG_KEY=sk-... npx vitest run -c tests/vitest.config.js tests/translator/real/antigravity-models.real.test.js
```

---

## 6. What could not be proven

| Item | Status | What would prove it |
|---|---|---|
| The reporter's payload really passes through this fork's agy translation (vs upstream build / direct MITM passthrough / unsupported model order) | UNVERIFIED | the raw request body + the 9router version from the report, or an MITM body dump on a repro |
| Live end-to-end sanity of the outgoing tools against Google | UNVERIFIED (no agy credentials used) | `RUN_REAL=1` run of `tests/translator/real/antigravity-models.real.test.js` |
| Why the error path says `function_declarations` (snake_case) although this codebase only ever emits `functionDeclarations` | MENCURIGAKAN | Google's own JSON-name rendering for `v1internal`, or the reporter's build/version |
| Whether a >8 MiB agy payload is affected by the new ceiling | not observed, no such payload in the report | reporter's body size, or raise `NINEROUTER_MAX_BODY_BYTES` and re-test |
| Behaviour of paths that never reach `AntigravityExecutor.transformRequest` (provider nodes, third‑party clients hitting Google directly) | TIDAK RELEVAN to this range / not audited | scope decision — out of the `v0.91.22..HEAD` question |

## 7. Hygiene check

```console
$ git status --short
?? .docs/audit/antigravity-regression-since-0.91.22-2026-09-22.md   # this report (new)
?? .docs/audit/upstream-83af3f18-triage-2026-09-22.md               # pre-existing untracked
?? .docs/audit/upstream-sync-status-2026-09-22.md                   # pre-existing untracked
?? .docs/audit/upstream-v0.5.81-triage-2026-09-22.md                # pre-existing untracked
?? tests/unit/scratch-optional-probe.test.js                        # pre-existing untracked (harness used in §3)
```

No tracked file modified, nothing staged, no commit, no push, no GitHub call. The untracked
`tests/unit/scratch-optional-probe.test.js` was present before this audit and is left as found; recommendation (2)
covers folding it into a tracked test.
