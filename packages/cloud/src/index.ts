import type {
  ChainId,
  FeeOracle,
  RouteResult,
} from '@routexcc/core';

/**
 * Configuration for the CloudFeeOracle.
 */
export interface CloudFeeOracleConfig {
  /** Cloud API key for authentication. */
  readonly apiKey: string;
  /** Fallback oracle to use when cloud is unreachable. */
  readonly fallback: FeeOracle;
  /** Cloud oracle endpoint URL. */
  readonly endpoint?: string;
}

/**
 * Cloud-hosted fee oracle (Phase 4 stub).
 *
 * In v1, this delegates entirely to the provided fallback (LocalFeeOracle).
 * When the cloud service is available (v2), it will use WebSocket streaming
 * with automatic fallback to local polling.
 *
 * @param config - Cloud oracle configuration.
 * @returns A FeeOracle that currently delegates to the fallback.
 *
 * @example
 * ```typescript
 * import { CloudFeeOracle } from '@routexcc/cloud';
 * import { LocalFeeOracle } from '@routexcc/core';
 *
 * const local = new LocalFeeOracle(localConfig);
 * const oracle = CloudFeeOracle({
 *   apiKey: 'your-api-key',
 *   fallback: local,
 * });
 * ```
 */
export function CloudFeeOracle(config: CloudFeeOracleConfig): FeeOracle {
  // Phase 4 stub: delegate entirely to fallback oracle
  return config.fallback;
}

/**
 * Telemetry event payload. Fields are strictly allowlisted.
 * No private keys, signer info, or wallet addresses.
 */
export interface TelemetryEvent {
  /** Chain used for the payment. */
  readonly chainId: ChainId;
  /** Payment amount in token's smallest unit. */
  // BigInt: token amounts must never use floating point
  readonly amount: bigint;
  /** Fee paid in USD (6-decimal precision). */
  // BigInt: token amounts must never use floating point
  readonly feeUsd: bigint;
  /** Estimated savings vs. next-best chain in USD. */
  // BigInt: token amounts must never use floating point
  readonly savingsUsd: bigint;
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
}

/**
 * Telemetry reporter (Phase 4 stub).
 *
 * In v1, this is a no-op. When the cloud service is available (v2),
 * it will send route telemetry to the Routex analytics backend.
 *
 * @param _config - Telemetry reporter configuration (unused in v1).
 * @returns A reporter with a no-op report method.
 *
 * @example
 * ```typescript
 * import { TelemetryReporter } from '@routexcc/cloud';
 *
 * const reporter = TelemetryReporter({ apiKey: 'your-api-key' });
 * reporter.report(routeResult); // no-op in v1
 * ```
 */
export function TelemetryReporter(_config: TelemetryReporterConfig): {
  report(result: RouteResult): void;
} {
  // Phase 4 stub: no-op
  return {
    report(_result: RouteResult): void {
      // No-op in v1 — telemetry will be implemented in Phase 4
    },
  };
}

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
 *
 * @param _config - Batch client configuration (unused in v1).
 * @returns A client with a no-op submit method.
 *
 * @example
 * ```typescript
 * import { BatchClient } from '@routexcc/cloud';
 *
 * const client = BatchClient({ apiKey: 'your-api-key' });
 * await client.submit(routeResult); // no-op in v1
 * ```
 */
export function BatchClient(_config: BatchClientConfig): {
  submit(result: RouteResult): Promise<void>;
} {
  // Phase 5 stub: no-op
  return {
    async submit(_result: RouteResult): Promise<void> {
      // No-op in v1 — batch settlement will be implemented in Phase 5
    },
  };
}
