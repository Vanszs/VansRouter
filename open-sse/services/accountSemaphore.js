/**
 * Account Semaphore — in-memory provider/account concurrency limiter.
 *
 * Requests beyond the configured concurrency cap wait in a FIFO queue until a
 * slot opens, the gate is unblocked, or the queue timeout expires.
 *
 * Ported from OmniRoute's accountSemaphore.ts, simplified to plain JS ESM.
 */

export function buildAccountSemaphoreKey({ provider, accountKey, proxyHash = "direct" }) {
  return `${String(provider)}:${String(accountKey)}:${String(proxyHash)}`;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_QUEUE_SIZE = 20;
const DEFAULT_MAX_CONCURRENCY = 1;

const gates = new Map();

class SemaphoreCapacityError extends Error {
  constructor(key, timeoutMs) {
    super(`Semaphore "${key}" capacity reached — timed out after ${timeoutMs}ms`);
    this.name = "SemaphoreCapacityError";
    this.semaphoreKey = key;
    this.timeoutMs = timeoutMs;
  }
}

function isBypassed(maxConcurrency) {
  return maxConcurrency == null || maxConcurrency <= 0;
}

function ensureGate(semaphoreKey, maxConcurrency) {
  let gate = gates.get(semaphoreKey);
  if (gate) {
    gate.maxConcurrency = maxConcurrency;
    return gate;
  }
  gate = {
    running: 0,
    maxConcurrency,
    queue: [],
    blockedUntil: null,
    cleanupTimer: null,
  };
  gates.set(semaphoreKey, gate);
  return gate;
}

function scheduleCleanup(semaphoreKey, gate) {
  if (gate.cleanupTimer) return;
  const delay = 5 * 60 * 1000; // 5 min idle cleanup
  gate.cleanupTimer = setTimeout(() => {
    if (gate.running === 0 && gate.queue.length === 0) {
      gates.delete(semaphoreKey);
    } else {
      gate.cleanupTimer = null;
      scheduleCleanup(semaphoreKey, gate);
    }
  }, delay);
  if (typeof gate.cleanupTimer.unref === "function") gate.cleanupTimer.unref();
}

/**
 * Acquire a semaphore slot. Returns a release function.
 * Rejects with SemaphoreCapacityError on timeout.
 */
export function acquire(semaphoreKey, options = {}) {
  const maxConcurrency = options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const signal = options.signal ?? null;
  const maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;

  if (isBypassed(maxConcurrency)) {
    return Promise.resolve(() => {});
  }

  const gate = ensureGate(semaphoreKey, maxConcurrency);

  // Check if gate is blocked (e.g. from 429 markBlocked)
  if (gate.blockedUntil && Date.now() < gate.blockedUntil) {
    // Still blocked — queue the request
  } else {
    gate.blockedUntil = null;
    if (gate.running < gate.maxConcurrency) {
      gate.running++;
      let released = false;
      return Promise.resolve(() => {
        if (released) return;
        released = true;
        gate.running--;
        drainQueue(semaphoreKey, gate);
      });
    }
  }

  // Queue full?
  if (gate.queue.length >= maxQueueSize) {
    return Promise.reject(new SemaphoreCapacityError(semaphoreKey, 0));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const idx = gate.queue.indexOf(entry);
      if (idx >= 0) gate.queue.splice(idx, 1);
      reject(new SemaphoreCapacityError(semaphoreKey, timeoutMs));
    }, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();

    if (signal) {
      signal.addEventListener?.("abort", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const idx = gate.queue.indexOf(entry);
        if (idx >= 0) gate.queue.splice(idx, 1);
        reject(signal.reason || new Error("Aborted"));
      });
    }

    const entry = {
      resolve: (release) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(release);
      },
      reject: (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      },
      timer,
    };
    gate.queue.push(entry);
    scheduleCleanup(semaphoreKey, gate);
  });
}

function drainQueue(semaphoreKey, gate) {
  while (gate.queue.length > 0 && gate.running < gate.maxConcurrency) {
    if (gate.blockedUntil && Date.now() < gate.blockedUntil) break;
    gate.blockedUntil = null;
    const entry = gate.queue.shift();
    if (!entry) break;
    gate.running++;
    let released = false;
    entry.resolve(() => {
      if (released) return;
      released = true;
      gate.running--;
      drainQueue(semaphoreKey, gate);
    });
  }
}

/**
 * Temporarily block all requests to a gate (e.g. after 429).
 */
export function markBlocked(semaphoreKey, durationMs) {
  const gate = gates.get(semaphoreKey);
  if (!gate) return;
  const until = Date.now() + durationMs;
  if (!gate.blockedUntil || gate.blockedUntil < until) {
    gate.blockedUntil = until;
  }
}

/**
 * Get stats for all gates (for dashboard).
 */
export function getAccountSemaphoreStats() {
  const result = [];
  for (const [key, gate] of gates) {
    result.push({
      key,
      running: gate.running,
      queued: gate.queue.length,
      maxConcurrency: gate.maxConcurrency,
      blockedUntil: gate.blockedUntil ? new Date(gate.blockedUntil).toISOString() : null,
    });
  }
  return result;
}

export function isSemaphoreCapacityError(error) {
  return error instanceof SemaphoreCapacityError;
}

/**
 * Resolve the semaphore key from request context.
 * Returns null if no concurrency limit is configured.
 * @param {object} params
 * @param {string} params.provider
 * @param {string} params.connectionId
 * @param {string} [params.proxyHash="direct"] - proxy bucket key so accounts sharing a proxy share a concurrency limit
 */
export function resolveAccountSemaphoreKey({ provider, model, connectionId, credentials, proxyHash = "direct" }) {
  if (!provider || !connectionId) return null;
  return buildAccountSemaphoreKey({ provider, accountKey: connectionId, proxyHash });
}

/**
 * Resolve max concurrency from connection settings.
 * Returns a sensible default (3) when not configured, so the semaphore
 * actually limits concurrent requests per account (preventing 429 cascades).
 * Set `maxConcurrency: 0` or `null` in providerSpecificData to bypass.
 */
export function resolveAccountSemaphoreMaxConcurrency(credentials) {
  if (!credentials) return 3;
  const max = credentials.providerSpecificData?.maxConcurrency;
  if (max === 0 || max === null) return null; // explicit bypass
  if (typeof max === "number" && max > 0) return max;
  return 3; // default: 3 concurrent requests per account
}

export { SemaphoreCapacityError };
