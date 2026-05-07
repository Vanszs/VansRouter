import { extractUsage, hasValidUsage } from "./open-sse/utils/usageTracking.js";

let usage = null;
const line = 'data: {"id":"gen-1778175461-j0dEOPi25AZper5COjcK","object":"chat.completion.chunk","created":1778175461,"model":"minimax/minimax-m2.7-20260318","provider":"Minimax","choices":[{"index":0,"delta":{"content":"","role":"assistant"},"finish_reason":"stop","native_finish_reason":"stop"}],"usage":{"prompt_tokens":2120,"completion_tokens":27,"total_tokens":2147,"reasoning_tokens":24,"prompt_tokens_details":{"cached_tokens":0,"cache_write_tokens":0,"audio_tokens":0,"video_tokens":0},"completion_tokens_details":{"reasoning_tokens":24,"image_tokens":0,"audio_tokens":0}}}';

try {
  const trimmed = line.trim();
  const jsonStr = trimmed.slice(5).trim();
  const parsed = JSON.parse(jsonStr);
  const extracted = extractUsage(parsed);
  if (extracted) usage = extracted;
  console.log("Usage properly extracted:", usage);
  console.log("isValid:", hasValidUsage(usage));
} catch (e) {
  console.error("Error:", e);
}
