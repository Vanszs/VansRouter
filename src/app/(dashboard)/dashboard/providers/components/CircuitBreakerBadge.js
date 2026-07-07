/**
 * CircuitBreakerBadge — compact badge showing circuit breaker state for a provider.
 * Integrates into existing provider cards without requiring a new page.
 */
export default function CircuitBreakerBadge({ status, onReset }) {
  if (!status || status.state === "CLOSED") return null;

  const stateConfig = {
    DEGRADED: { color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", icon: "warning", label: "Degraded" },
    OPEN: { color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400", icon: "power", label: "Circuit Open" },
    HALF_OPEN: { color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", icon: "autorenew", label: "Recovering" },
  };

  const config = stateConfig[status.state] || stateConfig.DEGRADED;
  const retryIn = status.retryAfterMs > 0 ? ` (${Math.ceil(status.retryAfterMs / 1000)}s)` : "";

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${config.color}`}>
      <span className="material-symbols-outlined text-[12px]">{config.icon}</span>
      {config.label}{retryIn}
      {status.state === "OPEN" && onReset && (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onReset(); }}
          className="ml-0.5 hover:opacity-70 transition-opacity"
          title="Reset circuit breaker"
        >
          <span className="material-symbols-outlined text-[12px]">refresh</span>
        </button>
      )}
    </span>
  );
}
