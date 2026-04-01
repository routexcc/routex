/**
 * Type declarations for the optional @routexcc/cloud dependency.
 * This module is dynamically imported at runtime — it may or may not be installed.
 * These declarations allow core to build without cloud's .d.ts files present.
 */
declare module '@routexcc/cloud' {
  import type { FeeOracle, RouteResult } from '@routexcc/core';

  export function CloudFeeOracle(config: {
    apiKey: string;
    fallback: FeeOracle;
  }): FeeOracle;

  export function TelemetryReporter(config: {
    apiKey: string;
  }): {
    report(result: RouteResult): void;
    stop(): Promise<void>;
  };
}
