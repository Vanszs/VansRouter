# Handover: Porting Antigravity Executor to 9router-new

This document provides complete instructions for the coding model to port the **Antigravity Executor** from OmniRoute (`/tmp/omni_antigravity.ts`) to 9router-new (`/media/DiskE/Code/9router-new/open-sse/executors/antigravity.js`).

---

## Context & Architectural Mapping

### Purpose
Port `AntigravityExecutor` to support anti-ban measures (tool cloaking, ZWJ obfuscation), automatic Google Cloud project bootstrap, advanced 429 rate-limit handling, and Google One AI credit redirection logic on rate limits.

### Current Status
- All required helper modules under `open-sse/services/` (Identity, Headers, Credits, 429 Engine, etc.) have been verified to exist and export the correct symbols.
- The destination file `open-sse/executors/antigravity.js` exists but has an incomplete implementation inheriting the default `execute` flow. It needs a full overwrite.

---

## 1. Architectural Map (Imports vs. Inlines)

### Existing Services & Utilities in 9router-new (Do NOT Rewrite/Inline)
We have verified that the following files exist and should be imported directly:
- `open-sse/services/antigravityIdentity.js`
  - `generateAntigravityRequestId`, `getAntigravitySessionId`, `getAntigravityEnvelopeUserAgent`, `deriveAntigravityMachineId`, `getAntigravityVscodeSessionId`
- `open-sse/services/antigravityVersion.js`
  - `resolveAntigravityVersion`, `getCachedAntigravityVersion`
- `open-sse/services/antigravityHeaders.js`
  - `antigravityUserAgent`
- `open-sse/services/antigravityHeaderScrub.js`
  - `scrubProxyAndFingerprintHeaders`
- `open-sse/services/antigravityCredits.js`
  - `injectCreditsField`, `shouldRetryWithCredits`, `handleCreditsFailure`, `getCreditsMode`, `shouldUseCreditsFirst`
- `open-sse/services/antigravityClientProfile.js`
  - `applyAntigravityClientProfileHeaders`
- `open-sse/services/antigravity429Engine.js`
  - `classify429`, `decide429`
- `open-sse/services/cloudCodeThinking.js`
  - `shouldStripCloudCodeThinking`, `stripCloudCodeThinkingConfig`
- `open-sse/config/antigravityModelAliases.js`
  - `resolveAntigravityModelId`, `getAntigravityModelFallbacks`
- `open-sse/executors/antigravity/sseCollect.js`
  - `processAntigravitySSEText`, `flushAntigravitySSEText`
- `src/lib/localDb.js` (relative `../../src/lib/localDb.js`)
  - `getMitmAlias`, `updateProviderConnection`
- `open-sse/utils/error.js`
  - `buildErrorBody`
- `open-sse/translator/formats/gemini.js`
  - `DEFAULT_SAFETY_SETTINGS` (line 31), `cleanJSONSchemaForAntigravity`
- `open-sse/config/appConstants.js`
  - `OAUTH_ENDPOINTS`, `ANTIGRAVITY_HEADERS`, `AG_DEFAULT_TOOLS`, `AG_TOOL_SUFFIX`, `ANTIGRAVITY_PRE_RESPONSE_TIMEOUT_CODE`
- `open-sse/config/runtimeConfig.js`
  - `HTTP_STATUS`
- `open-sse/utils/sessionManager.js`
  - `resolveSessionId`
- `open-sse/utils/proxyFetch.js`
  - `proxyAwareFetch`
- `open-sse/config/defaultThinkingSignature.js`
  - `DEFAULT_THINKING_AG_SIGNATURE`

### Inlining Requirements (Must be Written Directly inside `antigravity.js`)
Since these files/modules do **not** exist in 9router-new, you must inline them:
- `cliFingerprints` -> Drop entirely (YAGNI). Simplify request serialization:
  `serializeAntigravityRequest(provider, headers, body) => ({ headers, bodyString: JSON.stringify(cloneAntigravityRequestBody(body)) })`
- `geminiToolsSanitizer` -> Inline `buildGeminiTools` and `sanitizeGeminiToolName`
- `toolCloaking` -> Inline `cloakAntigravityToolPayload`, `stripEnumDescriptions`

---

## 2. In-Memory State & Cache Variables

Define these in the top-level scope of `/media/DiskE/Code/9router-new/open-sse/executors/antigravity.js`:

```javascript
const STREAM_READINESS_TIMEOUT_MS = 8000;
const CREDIT_BALANCE_TTL_MS = 5 * 60 * 1000;
const CREDITS_EXHAUSTED_TTL_MS = 5 * 60 * 60 * 1000; // 5 hours
const MAX_CREDITS_EXHAUSTED_ENTRIES = 50;
const MAX_CREDIT_BALANCE_ENTRIES = 50;

const creditsExhaustedUntil = new Map();
const creditBalanceCache = new Map();

const ANTIGRAVITY_UNSUPPORTED_SAFETY_CATEGORIES = new Set([
  "HARM_CATEGORY_CIVIC_INTEGRITY",
]);

const IMAGE_MODEL_PATTERNS = [
  /image/i,
  /imagen/i,
  /image-generation/i,
];
```

Implement in-memory credit balance caching helper:
```javascript
export function updateAntigravityRemainingCredits(accountId, balance) {
  // ponytail: skip DB persistence of credit balances since 9router has no equivalent schema
  if (creditBalanceCache.size >= MAX_CREDIT_BALANCE_ENTRIES && !creditBalanceCache.has(accountId)) {
    const oldestKey = creditBalanceCache.keys().next().value;
    if (oldestKey !== undefined) creditBalanceCache.delete(oldestKey);
  }
  creditBalanceCache.set(accountId, { balance, updatedAt: Date.now() });
}
```

---

## 3. Detailed Implementation Instructions

### `AntigravityExecutor` Class overrides:

1. **`buildUrl(model, stream, urlIndex = 0)`**
   ```javascript
   buildUrl(model, stream, urlIndex = 0) {
     const baseUrls = this.getBaseUrls();
     const baseUrl = baseUrls[urlIndex] || baseUrls[0];
     if (isImageModel(model)) {
       return `${baseUrl}/v1internal:generateContent`;
     }
     return `${baseUrl}/v1internal:streamGenerateContent?alt=sse`;
   }
   ```

2. **`buildHeaders(credentials, stream = true)`**
   ```javascript
   buildHeaders(credentials, _stream = true) {
     const raw = {
       "Content-Type": "application/json",
       Authorization: `Bearer ${credentials.accessToken}`,
       "User-Agent": antigravityUserAgent(),
       Accept: "text/event-stream",
       "X-OmniRoute-Source": "omniroute",
     };
     return scrubProxyAndFingerprintHeaders(raw);
   }
   ```

3. **`transformRequest(model, body, stream, credentials, modelIdOverride)`**
   - Translate `/tmp/omni_antigravity.ts` `transformRequest` method (lines 600-800).
   - Use `ensureAntigravityProjectAssigned(credentials.accessToken)` if `projectId` is missing.
   - Support image generation payload conversion if `isImageModel` is true.
   - Clean/strip system instructions, safety settings, and tool structures based on `isClaude` flag.
   - Obfuscate prompt texts via `obfuscateSensitiveWords`.

4. **`execute(input)` & `executeOnce(input, modelIdOverride)`**
   - Implement the Pro fallback chain in `execute` utilizing `getAntigravityModelFallbacks`.
   - Implement `executeOnce`:
     - Run `ensureAntigravityProjectAssigned` before firing request.
     - Enforce `duplex: "half"` in stream fetch settings if streaming.
     - Implement the pre-response timeout `fetchWithReadinessTimeout` with `STREAM_READINESS_TIMEOUT_MS`.
     - Implement 429 classification & cooldown mechanism. When `full_quota_exhausted` is hit, call:
       `updateProviderConnection(accountId, { rateLimitedUntil: new Date(Date.now() + retryAfterMs).toISOString() })`
       Note: `accountId` should resolve to `credentials?.connectionId || "unknown"`.
     - Synthesize non-streaming responses for `stream = false` callers using `collectStreamToResponse`.
     - For streaming responses, pipe `response.body` through a `TransformStream` to parse `remainingCredits` from SSE `data:` payloads on the fly without consuming the stream, updating local credit caches.

---

## 4. Immediate Next Steps for Coding Agent

1. Read the parsed helper code in `/tmp/omni_sseCollect.ts`, `/tmp/omni_toolCloaking.ts`, `/tmp/omni_geminiToolsSanitizer.ts`, and `/tmp/omni_upstreamError.ts` to copy missing helper logic.
2. Open `/media/DiskE/Code/9router-new/open-sse/executors/antigravity.js` and rewrite it entirely.
3. Validate by checking syntax: `node -c open-sse/executors/antigravity.js`.
4. Run executor vitest suite: `pnpm test tests/unit/executors` (or closest matching test suite).
