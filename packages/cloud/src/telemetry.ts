import type {
  ChainId,
  RouteResult,
} from '@routexcc/core';

/**
 * Telemetry event payload. Fields are strictly allowlisted.
 * No private keys, signer info, or wallet addresses.
 */
export interface TelemetryEvent {
  /** Chain used for the payment. */
  readonly chainId: ChainId;
  /** Payment amount in token's smallest unit (serialized as string for BigInt). */
  readonly amount: string;
  /** Fee paid in USD, 6-decimal precision (serialized as string for BigInt). */
  readonly feeUsd: string;
  /** Estimated savings vs. next-best chain in USD (serialized as string for BigInt). */
  readonly savingsUsd: string;
  /** Unix timestamp (ms) when the route was selected. */
  readonly timestamp: number;
}

/**
 * Configuration for the TelemetryReporter.
 */
export interface TelemetryReporterConfig {
  /** Cloud API key for authentication. */
  readonly apiKey: string;
  /** Cloud telemetry endpoint URL. */
  readonly endpoint?: string;
  /** Maximum number of events to buffer before flushing (default: 10). */
  readonly bufferSize?: number;
  /** Flush interval in milliseconds (default: 5000). */
  readonly flushIntervalMs?: number;
}

const DEFAULT_TELEMETRY_ENDPOINT = 'https://oracle.routex.dev';
const DEFAULT_BUFFER_SIZE = 10;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;

/**
 * Calculate savings: difference between selected chain fee and next-best option.
 * Returns 0n if only one option was evaluated.
 */
export function calculateSavings(result: RouteResult): bigint {
  if (result.evaluatedOptions.length < 2) return 0n;

  const sorted = [...result.evaluatedOptions].sort((a, b) => b.score - a.score);
  // Length >= 2 guaranteed by the guard above
  const selected = sorted[0]!;
  const nextBest = sorted[1]!;

  const diff = nextBest.fee.feeUsd - selected.fee.feeUsd;
  return diff > 0n ? diff : 0n;
}

/**
 * Extract a TelemetryEvent from a RouteResult.
 * Only approved fields are included — no private keys, addresses, or signer info.
 */
export function extractTelemetryEvent(result: RouteResult): TelemetryEvent {
  return {
    chainId: result.chainId,
    amount: result.payload.amount.toString(),
    feeUsd: result.fee.feeUsd.toString(),
    savingsUsd: calculateSavings(result).toString(),
    timestamp: Date.now(),
  };
}

export interface TelemetryReporterHandle {
  /** Report a route result. Extracts allowlisted fields and queues for sending. */
  report(result: RouteResult): void;
  /** Flush buffered events immediately. Returns when the POST completes. */
  flush(): Promise<void>;
  /** Stop the reporter and flush remaining events. */
  stop(): Promise<void>;
}

/**
 * Telemetry reporter that sends route telemetry to the Routex analytics backend.
 *
 * - Extracts only allowlisted fields from RouteResult (no private keys, no addresses)
 * - Buffers events and flushes periodically or when buffer is full
 * - Fire-and-forget: never throws on network errors
 */
export function TelemetryReporter(config: TelemetryReporterConfig): TelemetryReporterHandle {
  const endpoint = config.endpoint ?? DEFAULT_TELEMETRY_ENDPOINT;
  const bufferSize = config.bufferSize ?? DEFAULT_BUFFER_SIZE;
  const flushIntervalMs = config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;

  const buffer: TelemetryEvent[] = [];
  let flushTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  function telemetryUrl(): string {
    return `${endpoint}/v1/telemetry`;
  }

  async function sendBatch(events: readonly TelemetryEvent[]): Promise<void> {
    if (events.length === 0) return;
    try {
      await fetch(telemetryUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({ events }),
      });
    } catch {
      // Fire-and-forget: telemetry failures are silent
    }
  }

  // Start periodic flush
  flushTimer = setInterval(() => {
    if (buffer.length > 0) {
      const batch = buffer.splice(0);
      void sendBatch(batch);
    }
  }, flushIntervalMs);

  return {
    report(result: RouteResult): void {
      if (stopped) return;
      const event = extractTelemetryEvent(result);
      buffer.push(event);

      if (buffer.length >= bufferSize) {
        const batch = buffer.splice(0);
        void sendBatch(batch);
      }
    },

    async flush(): Promise<void> {
      if (buffer.length > 0) {
        const batch = buffer.splice(0);
        await sendBatch(batch);
      }
    },

    async stop(): Promise<void> {
      stopped = true;
      if (flushTimer) {
        clearInterval(flushTimer);
        flushTimer = null;
      }
      if (buffer.length > 0) {
        const batch = buffer.splice(0);
        await sendBatch(batch);
      }
    },
  };
}
