import { useState, useEffect, useCallback } from "react";

/**
 * Hook to fetch and manage circuit breaker statuses
 */
export function useCircuitBreakers() {
  const [statuses, setStatuses] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchStatuses = useCallback(async () => {
    try {
      const res = await fetch("/api/providers/circuit-breakers");
      const data = await res.json();
      setStatuses(data.statuses || []);
    } catch (error) {
      console.error("Failed to fetch circuit breakers:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/providers/circuit-breakers");
        const data = await res.json();
        if (!cancelled) setStatuses(data.statuses || []);
      } catch (error) {
        if (!cancelled) console.error("Failed to fetch circuit breakers:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    tick();
    const interval = setInterval(tick, 5000); // Poll every 5s
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const getCircuitBreakerForProvider = (providerId) => {
    return statuses.find(s => s.name === providerId);
  };

  const resetCircuitBreaker = async (name) => {
    try {
      await fetch(`/api/providers/circuit-breakers/${encodeURIComponent(name)}/reset`, {
        method: "POST"
      });
      await fetchStatuses();
      return true;
    } catch (error) {
      console.error("Failed to reset circuit breaker:", error);
      return false;
    }
  };

  return {
    statuses,
    loading,
    getCircuitBreakerForProvider,
    resetCircuitBreaker,
    refresh: fetchStatuses
  };
}
