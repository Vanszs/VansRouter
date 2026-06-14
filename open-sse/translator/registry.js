// Registry for translators — extracted to break circular deps between index.js and translator modules
const requestRegistry = new Map();
const responseRegistry = new Map();

export function register(from, to, requestFn, responseFn) {
  const key = `${from}:${to}`;
  if (requestFn) {
    requestRegistry.set(key, requestFn);
  }
  if (responseFn) {
    responseRegistry.set(key, responseFn);
  }
}

export function getRequestTranslator(key) {
  return requestRegistry.get(key);
}

export function getResponseTranslator(key) {
  return responseRegistry.get(key);
}
