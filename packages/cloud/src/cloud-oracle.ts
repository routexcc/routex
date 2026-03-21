import type {
  ChainId,
  FeeConfidence,
  FeeEstimate,
  FeeOracle,
} from '@routexcc/core';
import WebSocket from 'ws';

/**
 * Configuration for the CloudFeeOracle.
 */
export interface CloudFeeOracleConfig {
  /** Cloud API key for authentication. */
  readonly apiKey: string;
  /** Fallback oracle to use when cloud is unreachable. */
  readonly fallback: FeeOracle;
  /** Cloud oracle endpoint URL (HTTP/HTTPS). WebSocket URL derived automatically. */
  readonly endpoint?: string;
  /** Milliseconds of cloud silence before switching to fallback (default: 5000). */
  readonly fallbackTimeoutMs?: number;
  /** Maximum WebSocket reconnection delay in ms (default: 30000). */
  readonly wsReconnectMaxMs?: number;
  /** REST polling interval in ms when WebSocket is down (default: 10000). */
  readonly restPollIntervalMs?: number;
}

/** Wire format from the Go oracle. */
interface OracleFeeWire {
  readonly chainId: string;
  readonly feeAmount: string;
  readonly feeUsd: string;
  readonly finalityMs: number;
  readonly timestamp: number;
  readonly confidence: string;
}

interface OracleMessage {
  readonly fees?: readonly OracleFeeWire[];
  readonly type?: string;
  readonly serverTime?: number;
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'polling' | 'fallback';

const DEFAULT_ENDPOINT = 'https://oracle.routex.dev';
const DEFAULT_FALLBACK_TIMEOUT_MS = 5000;
const DEFAULT_WS_RECONNECT_MAX_MS = 30000;
const DEFAULT_REST_POLL_INTERVAL_MS = 10000;
const FALLBACK_CHECK_INTERVAL_MS = 1000;
const VALID_CHAINS: ReadonlySet<string> = new Set(['base', 'polygon', 'solana', 'stellar']);

function parseFee(raw: OracleFeeWire): FeeEstimate | undefined {
  if (!VALID_CHAINS.has(raw.chainId)) return undefined;
  return {
    chainId: raw.chainId as ChainId,
    feeAmount: BigInt(raw.feeAmount),
    feeUsd: BigInt(raw.feeUsd),
    finalityMs: raw.finalityMs,
    confidence: raw.confidence as FeeConfidence,
    timestamp: raw.timestamp,
  };
}

/**
 * Cloud-hosted fee oracle with WebSocket streaming, REST polling fallback,
 * and seamless degradation to a local oracle.
 *
 * Connection strategy:
 * 1. Attempt WebSocket streaming (primary, lowest latency)
 * 2. If WS unavailable, fall back to REST polling while retrying WS
 * 3. If cloud unreachable for >fallbackTimeoutMs, delegate to fallback oracle
 * 4. Recover automatically when cloud becomes available again
 */
export function CloudFeeOracle(config: CloudFeeOracleConfig): FeeOracle {
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
  const fallbackTimeoutMs = config.fallbackTimeoutMs ?? DEFAULT_FALLBACK_TIMEOUT_MS;
  const wsReconnectMaxMs = config.wsReconnectMaxMs ?? DEFAULT_WS_RECONNECT_MAX_MS;
  const restPollIntervalMs = config.restPollIntervalMs ?? DEFAULT_REST_POLL_INTERVAL_MS;

  const cache = new Map<ChainId, FeeEstimate>();
  let state: ConnectionState = 'disconnected';
  let ws: WebSocket | null = null;
  let lastCloudSuccessMs = 0;
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let restPollTimer: ReturnType<typeof setInterval> | null = null;
  let fallbackCheckTimer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  function wsUrl(): string {
    const base = endpoint.replace(/^http/, 'ws');
    return `${base}/v1/fees/stream`;
  }

  function restUrl(): string {
    return `${endpoint}/v1/fees`;
  }

  function updateCache(fees: readonly OracleFeeWire[]): void {
    for (const raw of fees) {
      const parsed = parseFee(raw);
      if (parsed) {
        cache.set(parsed.chainId, parsed);
      }
    }
    lastCloudSuccessMs = Date.now();
  }

  function isCloudStale(): boolean {
    if (lastCloudSuccessMs === 0) return true;
    return (Date.now() - lastCloudSuccessMs) > fallbackTimeoutMs;
  }

  function resolveState(): void {
    if (!running) return;
    if (isCloudStale() && state !== 'fallback') {
      state = 'fallback';
    } else if (!isCloudStale() && state === 'fallback') {
      state = cache.size > 0 ? 'connected' : 'polling';
    }
  }

  // ── WebSocket ──────────────────────────────────────────────────────────

  function connectWs(): void {
    if (!running) return;
    state = 'connecting';

    try {
      ws = new WebSocket(wsUrl());
    } catch {
      scheduleReconnect();
      return;
    }

    const currentWs = ws;
    currentWs.on('open', () => {
      currentWs.send(JSON.stringify({ apiKey: config.apiKey }));
      state = 'connected';
      reconnectAttempts = 0;
      lastCloudSuccessMs = Date.now();
      stopRestPolling();
    });

    currentWs.on('message', (data: WebSocket.RawData) => {
      try {
        const text = typeof data === 'string' ? data : data.toString();
        const msg: OracleMessage = JSON.parse(text) as OracleMessage;

        if (msg.fees && Array.isArray(msg.fees)) {
          updateCache(msg.fees);
        } else if (msg.type === 'heartbeat') {
          lastCloudSuccessMs = Date.now();
        }
      } catch {
        // Malformed message — ignore
      }
    });

    currentWs.on('close', () => {
      ws = null;
      if (running) {
        scheduleReconnect();
      }
    });

    currentWs.on('error', () => {
      // 'close' event fires after 'error' — reconnect handled there
      try { currentWs.close(); } catch { /* already closing */ }
    });
  }

  function scheduleReconnect(): void {
    if (!running) return;
    reconnectAttempts++;
    const delay = Math.min(
      1000 * Math.pow(2, reconnectAttempts - 1),
      wsReconnectMaxMs,
    );

    // Start REST polling while WS reconnects
    startRestPolling();

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectWs();
    }, delay);
  }

  // ── REST Polling ───────────────────────────────────────────────────────

  async function pollRest(): Promise<void> {
    try {
      const res = await fetch(restUrl());
      if (!res.ok) return;
      const data = (await res.json()) as OracleMessage;
      if (data.fees && Array.isArray(data.fees)) {
        updateCache(data.fees);
        if (state !== 'connected') {
          state = 'polling';
        }
      }
    } catch {
      // REST poll failed — will retry next interval
    }
  }

  function startRestPolling(): void {
    if (restPollTimer) return;
    void pollRest();
    restPollTimer = setInterval(() => void pollRest(), restPollIntervalMs);
  }

  function stopRestPolling(): void {
    if (restPollTimer) {
      clearInterval(restPollTimer);
      restPollTimer = null;
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────

  const oracle: FeeOracle = {
    async getFee(chainId: ChainId): Promise<FeeEstimate | undefined> {
      resolveState();
      if (state === 'fallback' || cache.size === 0) {
        return config.fallback.getFee(chainId);
      }
      return cache.get(chainId) ?? config.fallback.getFee(chainId);
    },

    async getAllFees(): Promise<ReadonlyMap<ChainId, FeeEstimate>> {
      resolveState();
      if (state === 'fallback' || cache.size === 0) {
        return config.fallback.getAllFees();
      }
      return cache;
    },

    start(): void {
      running = true;
      config.fallback.start();
      connectWs();
      fallbackCheckTimer = setInterval(resolveState, FALLBACK_CHECK_INTERVAL_MS);
    },

    stop(): void {
      running = false;
      config.fallback.stop();

      if (ws) {
        try { ws.close(); } catch { /* ignore */ }
        ws = null;
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      stopRestPolling();
      if (fallbackCheckTimer) {
        clearInterval(fallbackCheckTimer);
        fallbackCheckTimer = null;
      }

      cache.clear();
      reconnectAttempts = 0;
      lastCloudSuccessMs = 0;
      state = 'disconnected';
    },
  };

  return oracle;
}
