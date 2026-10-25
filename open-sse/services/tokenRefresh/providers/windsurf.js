export async function refreshWindsurfToken(credentials, log) {
  log?.info?.(
    "TOKEN_REFRESH",
    "windsurf: apiKey is long-lived (no refresh_token flow) — skipping"
  );
  return null;
}
