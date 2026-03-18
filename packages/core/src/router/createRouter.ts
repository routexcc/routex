import type {
  RouteConfig,
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
}

/**
 * Create a Router instance from the given configuration.
 *
 * INV-9: Each route() call is independent. No mutable module-level state.
 */
export function createRouter(config: RouteConfig): Router {
  const selector = new RouteSelector(config);
  const balanceManager = new BalanceManager({
    adapters: config.adapters,
  });

  return {
    async route(req: PaymentRequirement, signer: Signer): Promise<RouteResult> {
      // Gather fees from the oracle for all chains
      const fees = await config.feeOracle.getAllFees();

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

      return {
        chainId: best.chainId,
        payload,
        fee: best.fee,
        evaluatedOptions: scored,
      };
    },
  };
}
