import type {
  RouteConfig,
  FeeOracle,
  PaymentRequirement,
  RouteResult,
  Signer,
} from '../types.js';
import { PaymentConstructionError } from '../errors.js';
import { RouteSelector } from './RouteSelector.js';
import { BalanceManager } from '../balance/BalanceManager.js';

/**
 * Router interface returned by createRouter.
 */
export interface Router {
  /** Select the best route and build the payment payload. */
  route(req: PaymentRequirement, signer: Signer): Promise<RouteResult>;
  /** Stop the router and release resources (oracle polling, telemetry flush). */
  stop(): Promise<void>;
}

/** Handle for reporting telemetry after each route. */
interface TelemetryHandle {
  report(result: RouteResult): void;
  stop(): Promise<void>;
}

/**
 * Attempt to load @routexcc/cloud and create cloud oracle + telemetry.
 * Returns null if @routexcc/cloud is not installed.
 */
async function initCloud(
  apiKey: string,
  fallback: FeeOracle,
): Promise<{ oracle: FeeOracle; telemetry: TelemetryHandle } | null> {
  try {
    const cloud = await import('@routexcc/cloud') as {
      CloudFeeOracle: (config: {
        apiKey: string;
        fallback: FeeOracle;
      }) => FeeOracle;
      TelemetryReporter: (config: {
        apiKey: string;
      }) => TelemetryHandle;
    };
    const oracle = cloud.CloudFeeOracle({ apiKey, fallback });
    const telemetry = cloud.TelemetryReporter({ apiKey });
    return { oracle, telemetry };
  } catch {
    // @routexcc/cloud not installed — fall back to local oracle
    return null;
  }
}

/**
 * Create a Router instance from the given configuration.
 *
 * When `config.cloudApiKey` is set and `@routexcc/cloud` is installed,
 * v2 features activate automatically:
 * - Fee oracle wraps with CloudFeeOracle (WebSocket streaming + fallback)
 * - Telemetry reported after each successful route
 *
 * INV-9: Each route() call is independent. No mutable module-level state.
 */
export function createRouter(config: RouteConfig): Router {
  const balanceManager = new BalanceManager({
    adapters: config.adapters,
  });

  // Cloud initialization state (lazy, resolved on first route)
  let cloudInit: Promise<{ oracle: FeeOracle; telemetry: TelemetryHandle } | null> | null = null;
  let resolvedOracle: FeeOracle | null = null;
  let resolvedTelemetry: TelemetryHandle | null = null;
  let cloudResolved = false;

  if (config.cloudApiKey) {
    cloudInit = initCloud(config.cloudApiKey, config.feeOracle);
  }

  async function getOracle(): Promise<FeeOracle> {
    if (cloudResolved) return resolvedOracle ?? config.feeOracle;

    if (cloudInit) {
      const cloud = await cloudInit;
      cloudResolved = true;
      if (cloud) {
        resolvedOracle = cloud.oracle;
        resolvedTelemetry = cloud.telemetry;
        return cloud.oracle;
      }
    }

    cloudResolved = true;
    return config.feeOracle;
  }

  // Build selector with original config (oracle selection happens at route time)
  const selector = new RouteSelector(config);

  return {
    async route(req: PaymentRequirement, signer: Signer): Promise<RouteResult> {
      const oracle = await getOracle();

      // Gather fees from the active oracle (cloud or local)
      const fees = await oracle.getAllFees();

      // Determine the token from the first accepted payment
      const token = req.acceptedChains[0]?.token ?? 'native';

      // Query balances across all chains in parallel
      const balances = await balanceManager.getBalances(signer.address, token);

      // Run the five-step pipeline: parse → filter → score → select → verify
      const scored = await selector.select(req, balances, fees);

      // Select the top-scoring candidate (guaranteed non-empty by RouteSelector)
      const best = scored[0]!;

      // Build the payment payload via the chain adapter
      const adapter = config.adapters.get(best.chainId)!;
      const payload = await adapter.buildPaymentPayload(best.payment, signer);

      // INV-2: Recipient in payload must match recipient in payment requirement
      if (payload.to !== best.payment.payTo) {
        throw new PaymentConstructionError(
          best.chainId,
          'validate',
          'Recipient mismatch: adapter returned tampered recipient',
        );
      }

      // INV-3: Amount in payload must match amount in payment requirement
      // BigInt: token amounts must never use floating point
      if (payload.amount !== best.payment.amount) {
        throw new PaymentConstructionError(
          best.chainId,
          'validate',
          'Amount mismatch: adapter returned tampered amount',
        );
      }

      // INV-4: Chain ID in payload must match expected chain
      if (payload.chainId !== best.chainId) {
        throw new PaymentConstructionError(
          best.chainId,
          'validate',
          'Chain ID mismatch: adapter returned wrong chain',
        );
      }

      const result: RouteResult = {
        chainId: best.chainId,
        payload,
        fee: best.fee,
        evaluatedOptions: scored,
      };

      // v2: fire-and-forget telemetry
      if (resolvedTelemetry) {
        resolvedTelemetry.report(result);
      }

      return result;
    },

    async stop(): Promise<void> {
      if (resolvedTelemetry) {
        await resolvedTelemetry.stop();
      }
      if (resolvedOracle) {
        resolvedOracle.stop();
      }
    },
  };
}
