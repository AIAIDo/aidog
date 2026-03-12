import { useState, useEffect, useCallback, useRef } from 'react';

const inflightGets = new Map();
const recentGetCache = new Map();
const RECENT_CACHE_TTL_MS = 1000;

async function fetchJsonWithDedupe(url) {
  const now = Date.now();
  const cached = recentGetCache.get(url);
  if (cached && now - cached.timestamp < RECENT_CACHE_TTL_MS) {
    return cached.data;
  }

  if (inflightGets.has(url)) {
    return inflightGets.get(url);
  }

  const request = fetch(url, {
    headers: { 'Content-Type': 'application/json' },
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body}`);
      }
      return res.json();
    })
    .then((json) => {
      recentGetCache.set(url, { data: json, timestamp: Date.now() });
      return json;
    })
    .finally(() => {
      inflightGets.delete(url);
    });

  inflightGets.set(url, request);
  return request;
}

/**
 * Generic API call hook with loading/error states.
 */
export function useApi(url, options = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const execute = useCallback(
    async (overrideOptions = {}) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(url, {
          headers: { 'Content-Type': 'application/json' },
          ...options,
          ...overrideOptions,
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`HTTP ${res.status}: ${body}`);
        }
        const json = await res.json();
        setData(json);
        return json;
      } catch (err) {
        setError(err.message || 'Request failed');
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [url, JSON.stringify(options)]
  );

  return { data, loading, error, execute, setData };
}

/**
 * Server-Sent Events subscription hook.
 * Automatically connects and reconnects.
 */
export function useSSE(url) {
  const [data, setData] = useState(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const eventSourceRef = useRef(null);
  const reconnectTimerRef = useRef(null);

  useEffect(() => {
    if (!url) return;

    const connect = () => {
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        setConnected(true);
        setError(null);
      };

      es.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          setData(parsed);
        } catch {
          setData(event.data);
        }
      };

      es.onerror = () => {
        setConnected(false);
        setError('SSE connection lost');
        es.close();
        // Reconnect after 3 seconds
        reconnectTimerRef.current = setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [url]);

  const close = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setConnected(false);
    }
  }, []);

  return { data, connected, error, close };
}

/**
 * Auto-fetch on mount and when dependencies change.
 */
export function useFetch(url, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const requestIdRef = useRef(0);
  const fetchData = useCallback(async () => {
    if (!url) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const json = await fetchJsonWithDedupe(url);
      if (requestId === requestIdRef.current) {
        setData(json);
      }
    } catch (err) {
      if (requestId === requestIdRef.current) {
        setError(err.message || 'Fetch failed');
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [url]);

  useEffect(() => {
    fetchData();
  }, [fetchData, ...deps]);

  return { data, loading, error, refetch: fetchData };
}
