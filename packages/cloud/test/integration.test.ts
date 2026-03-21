import { describe, it, expect } from 'vitest';
import type { ChainId, FeeConfidence } from '@routexcc/core';

/**
 * Integration test: fetches from the live oracle at localhost:8080
 * and validates the response matches the @routexcc/core FeeEstimate contract.
 *
 * Run with: ORACLE_URL=http://localhost:8080 pnpm test -- integration
 */

const ORACLE_URL = process.env['ORACLE_URL'] ?? 'http://localhost:8080';

interface OracleFeeEstimate {
  chainId: string;
  feeAmount: string; // serialized as string to preserve precision for BigInt
  feeUsd: string;    // serialized as string for BigInt compatibility
  finalityMs: number;
  timestamp: number;
  confidence: string;
}

interface OracleFeesResponse {
  fees: OracleFeeEstimate[];
  serverTime: number;
}

const VALID_CHAINS: ReadonlySet<string> = new Set(['base', 'polygon', 'solana', 'stellar']);
const VALID_CONFIDENCE: ReadonlySet<string> = new Set(['high', 'medium', 'low']);

async function fetchFees(chains?: string): Promise<OracleFeesResponse> {
  const url = chains
    ? `${ORACLE_URL}/v1/fees?chains=${chains}`
    : `${ORACLE_URL}/v1/fees`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Oracle returned ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<OracleFeesResponse>;
}

describe('Oracle API → SDK contract integration', () => {
  it('GET /healthz returns ok', async () => {
    const res = await fetch(`${ORACLE_URL}/healthz`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual({ status: 'ok' });
  });

  it('GET /v1/fees returns envelope with fees array and serverTime', async () => {
    const data = await fetchFees();

    // Envelope shape
    expect(data).toHaveProperty('fees');
    expect(data).toHaveProperty('serverTime');
    expect(Array.isArray(data.fees)).toBe(true);
    expect(typeof data.serverTime).toBe('number');
    expect(data.serverTime).toBeGreaterThan(0);
  });

  it('each fee has all required FeeEstimate fields', async () => {
    const data = await fetchFees();
    expect(data.fees.length).toBeGreaterThan(0);

    for (const fee of data.fees) {
      // chainId: valid ChainId
      expect(typeof fee.chainId).toBe('string');
      expect(VALID_CHAINS.has(fee.chainId)).toBe(true);

      // feeAmount: string (serialized for BigInt precision)
      expect(typeof fee.feeAmount).toBe('string');
      expect(/^\d+$/.test(fee.feeAmount)).toBe(true);

      // feeUsd: string (serialized for BigInt precision)
      expect(typeof fee.feeUsd).toBe('string');
      expect(/^\d+$/.test(fee.feeUsd)).toBe(true);

      // finalityMs: positive integer
      expect(typeof fee.finalityMs).toBe('number');
      expect(fee.finalityMs).toBeGreaterThan(0);

      // timestamp: unix ms
      expect(typeof fee.timestamp).toBe('number');
      expect(fee.timestamp).toBeGreaterThan(1700000000000);

      // confidence: valid FeeConfidence
      expect(typeof fee.confidence).toBe('string');
      expect(VALID_CONFIDENCE.has(fee.confidence)).toBe(true);
    }
  });

  it('feeAmount and feeUsd convert to BigInt without precision loss', async () => {
    const data = await fetchFees();

    for (const fee of data.fees) {
      // String → BigInt conversion (how the SDK will consume these)
      const feeAmount = BigInt(fee.feeAmount);
      const feeUsd = BigInt(fee.feeUsd);
      expect(feeAmount).toBeGreaterThanOrEqual(0n);
      expect(feeUsd).toBeGreaterThanOrEqual(0n);

      // Verify round-trip: BigInt → string matches original
      expect(feeAmount.toString()).toBe(fee.feeAmount);
      expect(feeUsd.toString()).toBe(fee.feeUsd);
    }
  });

  it('?chains= filter returns only requested chains', async () => {
    const data = await fetchFees('base,stellar');

    const chainIds = data.fees.map(f => f.chainId);
    for (const id of chainIds) {
      expect(['base', 'stellar']).toContain(id);
    }
  });

  it('fee values are realistic', async () => {
    const data = await fetchFees();
    const byChain = new Map(data.fees.map(f => [f.chainId, f]));

    // Base: L2 fee should be < $1 (feeUsd < 1_000_000)
    const base = byChain.get('base');
    if (base) {
      expect(BigInt(base.feeUsd)).toBeLessThan(1_000_000n);
      expect(base.finalityMs).toBe(2000);
    }

    // Stellar: near-free (feeUsd < 1000 = $0.001)
    const stellar = byChain.get('stellar');
    if (stellar) {
      expect(BigInt(stellar.feeUsd)).toBeLessThan(1000n);
      expect(stellar.finalityMs).toBe(5000);
    }

    // Polygon: should be < $1
    const polygon = byChain.get('polygon');
    if (polygon) {
      expect(BigInt(polygon.feeUsd)).toBeLessThan(1_000_000n);
      expect(polygon.finalityMs).toBe(2000);
    }

    // Solana: finalityMs should be 400
    const solana = byChain.get('solana');
    if (solana) {
      expect(solana.finalityMs).toBe(400);
    }
  });

  it('no user-identifiable data in response', async () => {
    const res = await fetch(`${ORACLE_URL}/v1/fees`);
    const text = await res.text();
    const lower = text.toLowerCase();

    for (const banned of ['wallet', 'address', 'orgid', 'userid', 'private', 'secret']) {
      expect(lower).not.toContain(banned);
    }
  });

  it('response headers are correct', async () => {
    const res = await fetch(`${ORACLE_URL}/v1/fees`);

    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('x-oracle-region')).toBe('iad');
  });
});
