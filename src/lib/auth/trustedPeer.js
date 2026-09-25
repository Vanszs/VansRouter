export function hasTrustedPeerHeaders(request) {
  const expected = process.env.VANSROUTER_PEER_TOKEN
    || process.env.NINEROUTER_PEER_TOKEN;
  return Boolean(expected && request.headers.get("x-9r-peer-token") === expected);
}
