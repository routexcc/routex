import type { RouteResult } from '@routexcc/core';

// ── Cloud Fee Oracle ─────────────────────────────────────────────────────────
export { CloudFeeOracle } from './cloud-oracle.js';
export type { CloudFeeOracleConfig } from './cloud-oracle.js';

// ── Telemetry ────────────────────────────────────────────────────────────────
export {
  TelemetryReporter,
  calculateSavings,
  extractTelemetryEvent,
} from './telemetry.js';
export type {
  TelemetryEvent,
  TelemetryReporterConfig,
  TelemetryReporterHandle,
} from './telemetry.js';

// ── Batch Client (Phase 5 stub) ─────────────────────────────────────────────

/**
 * Configuration for the BatchClient.
 */
export interface BatchClientConfig {
  /** Cloud API key for authentication. */
  readonly apiKey: string;
  /** Cloud batch endpoint URL. */
  readonly endpoint?: string;
}

/**
 * Batch settlement client (Phase 5 stub).
 *
 * In v1, this is a no-op. When batch settlement is available (v2),
 * it will submit payment intents to the Routex batch queue.
 */
export function BatchClient(_config: BatchClientConfig): {
  submit(result: RouteResult): Promise<void>;
} {
  return {
    async submit(_result: RouteResult): Promise<void> {
      // No-op in v1 — batch settlement will be implemented in Phase 5
    },
  };
}
