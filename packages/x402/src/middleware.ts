import type {
  RouteConfig,
  PaymentRequirement,
  RouteResult,
  Signer,
  PaymentPayload,
  ChainId,
  AcceptedPayment,
} from '@routexcc/core';
import { createRouter, RouteExhaustedError } from '@routexcc/core';
import type { Router } from '@routexcc/core';

/**
 * Configuration for the Routex x402 middleware.
 */
export interface RoutexMiddlewareConfig {
  /** Full Routex route configuration. */
  readonly routeConfig: RouteConfig;
  /** Signer instance for signing payment payloads. */
  readonly signer: Signer;
  /**
   * Optional callback invoked after a successful route selection.
   * Can be used for logging or telemetry.
   */
  readonly onRouteSelected?: (result: RouteResult) => void;
  /**
   * Optional callback invoked when routing fails.
   * The caller can use this to fall back to direct payment.
   */
  readonly onRouteFailed?: (error: RoutexError) => void;
}

/** Re-export for convenience in error handling callbacks. */
type RoutexError = RouteExhaustedError | Error;

/**
 * A parsed 402 response containing payment requirements.
 */
export interface ParsedX402Response {
  /** HTTP status code (should be 402). */
  readonly status: number;
  /** Payment requirements extracted from the 402 response body. */
  readonly paymentRequirement: PaymentRequirement;
}

/**
 * Result of the middleware processing a 402 response.
 */
export interface MiddlewareResult {
  /** The constructed payment payload ready for submission to the facilitator. */
  readonly payload: PaymentPayload;
  /** The full route result with scoring details. */
  readonly routeResult: RouteResult;
}

/**
 * The Routex x402 middleware instance.
 */
export interface RoutexMiddleware {
  /**
   * Handle a 402 response by routing and building a payment payload.
   *
   * @param response - The parsed 402 response with payment requirements.
   * @returns The payment payload and route details.
   * @throws {RouteExhaustedError} When no eligible route is found.
   * @throws {PaymentConstructionError} When payload construction fails.
   *
   * @example
   * ```typescript
   * const result = await middleware.handlePaymentRequired(parsed402);
   * // Forward result.payload to the facilitator
   * ```
   */
  handlePaymentRequired(response: ParsedX402Response): Promise<MiddlewareResult>;

  /**
   * Parse a raw HTTP response into a ParsedX402Response.
   * Returns undefined if the response is not a 402.
   *
   * @param status - HTTP status code.
   * @param body - Response body (JSON-parsed).
   * @returns Parsed 402 response, or undefined if not a 402.
   *
   * @example
   * ```typescript
   * const parsed = middleware.parseResponse(402, responseBody);
   * if (parsed) {
   *   const result = await middleware.handlePaymentRequired(parsed);
   * }
   * ```
   */
  parseResponse(
    status: number,
    body: Record<string, unknown>,
  ): ParsedX402Response | undefined;

  /** The underlying router instance. */
  readonly router: Router;
}

/**
 * Create a Routex x402 middleware instance.
 *
 * Intercepts 402 Payment Required responses, extracts payment requirements,
 * selects the optimal chain via the Routex router, and builds a signed
 * payment payload for submission to the facilitator.
 *
 * @param config - Middleware configuration including route config and signer.
 * @returns A middleware instance for handling 402 responses.
 * @throws {Error} When config is missing required fields.
 *
 * @example
 * ```typescript
 * import { routexMiddleware } from '@routexcc/x402';
 * import { createBaseAdapter } from '@routexcc/chain-base';
 *
 * const middleware = routexMiddleware({
 *   routeConfig: {
 *     adapters: new Map([['base', createBaseAdapter(client)]]),
 *     feeOracle: oracle,
 *     strategy: 'cheapest',
 *     maxFeeAgeMs: 60_000,
 *   },
 *   signer: mySigner,
 * });
 *
 * // In your HTTP client interceptor:
 * const parsed = middleware.parseResponse(response.status, response.data);
 * if (parsed) {
 *   const { payload } = await middleware.handlePaymentRequired(parsed);
 *   // Forward payload to facilitator
 * }
 * ```
 */
export function routexMiddleware(config: RoutexMiddlewareConfig): RoutexMiddleware {
  const router = createRouter(config.routeConfig);

  return {
    router,

    async handlePaymentRequired(response: ParsedX402Response): Promise<MiddlewareResult> {
      // INV-10: Graceful degradation — errors propagate to caller, never swallowed
      const routeResult = await router.route(response.paymentRequirement, config.signer);

      // Notify callback on success
      if (config.onRouteSelected) {
        config.onRouteSelected(routeResult);
      }

      return {
        payload: routeResult.payload,
        routeResult,
      };
    },

    parseResponse(
      status: number,
      body: Record<string, unknown>,
    ): ParsedX402Response | undefined {
      if (status !== 402) {
        return undefined;
      }

      // Extract payment requirement from response body
      const paymentRequirement = parsePaymentRequirement(body);
      if (!paymentRequirement) {
        return undefined;
      }

      return {
        status: 402,
        paymentRequirement,
      };
    },
  };
}

/**
 * Parse a payment requirement from a 402 response body.
 *
 * @param body - The JSON-parsed response body.
 * @returns The payment requirement, or undefined if the body is malformed.
 */
function parsePaymentRequirement(
  body: Record<string, unknown>,
): PaymentRequirement | undefined {
  // Accept either a top-level acceptedChains array or a nested paymentRequirement object
  const source = (body['paymentRequirement'] as Record<string, unknown>) ?? body;
  const chains = source['acceptedChains'];

  if (!Array.isArray(chains) || chains.length === 0) {
    return undefined;
  }

  const acceptedChains: AcceptedPayment[] = [];

  for (const chain of chains) {
    if (typeof chain !== 'object' || chain === null) {
      continue;
    }

    const entry = chain as Record<string, unknown>;
    const chainId = entry['chainId'];
    const payTo = entry['payTo'];
    const amount = entry['amount'];
    const token = entry['token'];

    if (
      typeof chainId !== 'string' ||
      typeof payTo !== 'string' ||
      typeof token !== 'string'
    ) {
      continue;
    }

    // INV-7: BigInt for all token amounts — parse from string or number
    // BigInt: token amounts must never use floating point
    let parsedAmount: bigint;
    if (typeof amount === 'bigint') {
      parsedAmount = amount;
    } else if (typeof amount === 'string') {
      try {
        parsedAmount = BigInt(amount);
      } catch {
        continue;
      }
    } else if (typeof amount === 'number' && Number.isInteger(amount)) {
      // BigInt: convert integer numbers to bigint (safe for JSON-parsed responses)
      parsedAmount = BigInt(amount);
    } else {
      continue;
    }

    const extra = typeof entry['extra'] === 'object' && entry['extra'] !== null
      ? (entry['extra'] as Readonly<Record<string, string>>)
      : undefined;

    acceptedChains.push({
      chainId: chainId as ChainId,
      payTo,
      // BigInt: token amounts must never use floating point
      amount: parsedAmount,
      token,
      ...(extra ? { extra } : {}),
    });
  }

  if (acceptedChains.length === 0) {
    return undefined;
  }

  return { acceptedChains };
}
