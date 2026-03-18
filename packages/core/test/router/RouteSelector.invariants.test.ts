import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRouter } from '../../src/router/createRouter.js';
import { RouteSelector } from '../../src/router/RouteSelector.js';
import { RouteExhaustedError } from '../../src/errors.js';
import type {
  ChainId,
  RouteConfig,
  FeeEstimate,
  PaymentRequirement,
  ChainAdapter,
  FeeOracle,
  AcceptedPayment,
  TokenBalance,
  PaymentPayload,
  Signer,
  RouteOption,
} from '../../src/types.js';

const FIXED_NOW = new Date('2026-03-17T10:00:00.000Z');
const CORE_SRC_DIR = new URL('../../src/', import.meta.url);
const ROUTER_SRC_DIR = new URL('../../src/router/', import.meta.url);

function listTsFiles(url: URL): readonly string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (entry.isFile() && fullPath.endsWith('.ts') && !fullPath.endsWith('.d.ts')) {
        files.push(fullPath);
      }
    }
  };

  walk(url.pathname);
  return files;
}

function makeFee(
  chainId: ChainId,
  overrides?: Partial<FeeEstimate>,
): FeeEstimate {
  return {
    chainId,
    feeAmount: 1_000n,
    feeUsd: 100_000n,
    finalityMs: 2_000,
    confidence: 'high',
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeAdapter(chainId: ChainId): ChainAdapter {
  return {
    chainId,
    async getBalance(_address: string, _token: string): Promise<TokenBalance> {
      return { chainId, token: 'USDC', balance: 10_000_000n, timestamp: Date.now() };
    },
    async estimateFee(_payment: AcceptedPayment): Promise<FeeEstimate> {
      return makeFee(chainId);
    },
    async buildPaymentPayload(payment: AcceptedPayment, _signer: Signer): Promise<PaymentPayload> {
      return {
        chainId,
        to: payment.payTo,
        amount: payment.amount,
        token: payment.token,
        data: '0xsigned',
      };
    },
    getFinality(): number {
      return 2_000;
    },
  };
}

function makeFeeOracle(fees: ReadonlyMap<ChainId, FeeEstimate>): FeeOracle {
  return {
    async getFee(chainId: ChainId): Promise<FeeEstimate | undefined> {
      return fees.get(chainId);
    },
    async getAllFees(): Promise<ReadonlyMap<ChainId, FeeEstimate>> {
      return fees;
    },
    start(): void {
      // noop
    },
    stop(): void {
      // noop
    },
  };
}

function makeSelectorConfig(overrides?: Partial<RouteConfig>): RouteConfig {
  const adapters = new Map<ChainId, ChainAdapter>([
    ['base', makeAdapter('base')],
    ['polygon', makeAdapter('polygon')],
    ['stellar', makeAdapter('stellar')],
  ]);

  return {
    adapters,
    feeOracle: makeFeeOracle(new Map()),
    strategy: 'cheapest',
    maxFeeAgeMs: 1_000,
    ...overrides,
  };
}

function makeRequirement(acceptedChains: readonly AcceptedPayment[]): PaymentRequirement {
  return { acceptedChains };
}

const mockSigner: Signer = {
  address: '0xsender',
  async sign(_data: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array([1, 2, 3]);
  },
};

describe('RouteSelector invariants', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('INV-1: source contains no privateKey/secretKey/mnemonic identifiers', () => {
    const files = listTsFiles(CORE_SRC_DIR);
    const forbidden = /\b(privateKey|secretKey|mnemonic)\b/g;
    const violations: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      const matches = content.match(forbidden);
      if (matches !== null) {
        violations.push(`${file}: ${matches.join(',')}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('INV-2: throws on recipient mismatch', async () => {
    const selector = new RouteSelector(makeSelectorConfig());
    const requirement = makeRequirement([
      { chainId: 'base', payTo: '0xAAA', amount: 1_000_000n, token: 'USDC' },
      { chainId: 'base', payTo: '0xBBB', amount: 1_000_000n, token: 'USDC' },
    ]);
    const fees = new Map<ChainId, FeeEstimate>([['base', makeFee('base')]]);
    const balances = new Map<ChainId, bigint>([['base', 10_000_000n]]);

    await expect(selector.select(requirement, balances, fees)).rejects.toThrow('Recipient mismatch');
  });

  it('INV-3: throws on amount mismatch', async () => {
    const selector = new RouteSelector(makeSelectorConfig());
    const requirement = makeRequirement([
      { chainId: 'base', payTo: '0xAAA', amount: 1_000_000n, token: 'USDC' },
      { chainId: 'base', payTo: '0xAAA', amount: 2_000_000n, token: 'USDC' },
    ]);
    const fees = new Map<ChainId, FeeEstimate>([['base', makeFee('base')]]);
    const balances = new Map<ChainId, bigint>([['base', 10_000_000n]]);

    await expect(selector.select(requirement, balances, fees)).rejects.toThrow('Amount mismatch');
  });

  it('INV-4: throws when fee estimate chainId does not match selected chain', async () => {
    const selector = new RouteSelector(makeSelectorConfig());
    const requirement = makeRequirement([
      { chainId: 'base', payTo: '0xAAA', amount: 1_000_000n, token: 'USDC' },
    ]);
    const fees = new Map<ChainId, FeeEstimate>([
      ['base', makeFee('polygon', { feeUsd: 10_000n })],
    ]);
    const balances = new Map<ChainId, bigint>([['base', 10_000_000n]]);

    await expect(selector.select(requirement, balances, fees)).rejects.toThrow(
      'Chain ID mismatch in fee estimate',
    );
  });

  it('INV-4: throws when scorer returns option not present in accepted chains', async () => {
    const selector = new RouteSelector(
      makeSelectorConfig({
        strategy: {
          type: 'custom',
          scorer: (options: readonly RouteOption[]) => [
            { ...options[0]!, chainId: 'stellar' },
          ],
        },
      }),
    );
    const requirement = makeRequirement([
      { chainId: 'base', payTo: '0xAAA', amount: 1_000_000n, token: 'USDC' },
    ]);
    const fees = new Map<ChainId, FeeEstimate>([['base', makeFee('base')]]);
    const balances = new Map<ChainId, bigint>([['base', 10_000_000n]]);

    await expect(selector.select(requirement, balances, fees)).rejects.toThrow(
      'Chain ID does not match an accepted chain',
    );
  });

  it('INV-5: throws RouteExhaustedError with per-candidate reasons when all routes are stale', async () => {
    const selector = new RouteSelector(makeSelectorConfig({ maxFeeAgeMs: 1_000 }));
    const requirement = makeRequirement([
      { chainId: 'base', payTo: '0xAAA', amount: 1_000_000n, token: 'USDC' },
      { chainId: 'polygon', payTo: '0xAAA', amount: 1_000_000n, token: 'USDC' },
    ]);
    const fees = new Map<ChainId, FeeEstimate>([
      ['base', makeFee('base', { timestamp: Date.now() - 1_001 })],
      ['polygon', makeFee('polygon', { timestamp: Date.now() - 5_000 })],
    ]);
    const balances = new Map<ChainId, bigint>([
      ['base', 10_000_000n],
      ['polygon', 10_000_000n],
    ]);

    try {
      await selector.select(requirement, balances, fees);
      expect.fail('expected RouteExhaustedError');
    } catch (error) {
      expect(error).toBeInstanceOf(RouteExhaustedError);
      const exhausted = error as RouteExhaustedError;
      expect(exhausted.rejections).toHaveLength(2);
      expect(exhausted.rejections.every((r) => r.code === 'STALE_FEE')).toBe(true);
    }
  });

  it('INV-6: rejects fee estimates older than maxFeeAgeMs', async () => {
    const selector = new RouteSelector(makeSelectorConfig({ maxFeeAgeMs: 1_000 }));
    const requirement = makeRequirement([
      { chainId: 'base', payTo: '0xAAA', amount: 1_000_000n, token: 'USDC' },
    ]);
    const fees = new Map<ChainId, FeeEstimate>([
      ['base', makeFee('base', { timestamp: Date.now() - 1_001 })],
    ]);
    const balances = new Map<ChainId, bigint>([['base', 10_000_000n]]);

    await expect(selector.select(requirement, balances, fees)).rejects.toThrow(RouteExhaustedError);
  });

  it('INV-6: accepts fee estimates at maxFeeAgeMs - 1', async () => {
    const selector = new RouteSelector(makeSelectorConfig({ maxFeeAgeMs: 1_000 }));
    const requirement = makeRequirement([
      { chainId: 'base', payTo: '0xAAA', amount: 1_000_000n, token: 'USDC' },
    ]);
    const fees = new Map<ChainId, FeeEstimate>([
      ['base', makeFee('base', { timestamp: Date.now() - 999 })],
    ]);
    const balances = new Map<ChainId, bigint>([['base', 10_000_000n]]);

    const result = await selector.select(requirement, balances, fees);
    expect(result[0]!.chainId).toBe('base');
  });

  it('INV-7: source has no parseFloat/parseInt usage', () => {
    const files = listTsFiles(CORE_SRC_DIR);
    const forbidden = /\b(parseFloat|parseInt)\b/g;
    const violations: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      const matches = content.match(forbidden);
      if (matches !== null) {
        violations.push(`${file}: ${matches.join(',')}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('INV-9: router is stateless across sequential calls', async () => {
    const selector = new RouteSelector(makeSelectorConfig({ strategy: 'cheapest' }));
    const requirement = makeRequirement([
      { chainId: 'base', payTo: '0xAAA', amount: 1_000_000n, token: 'USDC' },
      { chainId: 'polygon', payTo: '0xAAA', amount: 1_000_000n, token: 'USDC' },
    ]);
    const balances = new Map<ChainId, bigint>([
      ['base', 10_000_000n],
      ['polygon', 10_000_000n],
    ]);

    const first = await selector.select(
      requirement,
      balances,
      new Map<ChainId, FeeEstimate>([
        ['base', makeFee('base', { feeUsd: 200_000n })],
        ['polygon', makeFee('polygon', { feeUsd: 100_000n })],
      ]),
    );
    const second = await selector.select(
      requirement,
      balances,
      new Map<ChainId, FeeEstimate>([
        ['base', makeFee('base', { feeUsd: 50_000n })],
        ['polygon', makeFee('polygon', { feeUsd: 500_000n })],
      ]),
    );

    expect(first[0]!.chainId).toBe('polygon');
    expect(second[0]!.chainId).toBe('base');
  });

  it('INV-9: concurrent route calls do not interfere', async () => {
    const selector = new RouteSelector(makeSelectorConfig({ strategy: 'cheapest' }));
    const requirement = makeRequirement([
      { chainId: 'base', payTo: '0xAAA', amount: 1_000_000n, token: 'USDC' },
      { chainId: 'polygon', payTo: '0xAAA', amount: 1_000_000n, token: 'USDC' },
    ]);
    const balances = new Map<ChainId, bigint>([
      ['base', 10_000_000n],
      ['polygon', 10_000_000n],
    ]);

    const calls = Array.from({ length: 40 }, (_, i) => {
      const baseCheaper = i % 2 === 1;
      const fees = new Map<ChainId, FeeEstimate>([
        ['base', makeFee('base', { feeUsd: baseCheaper ? 50_000n : 200_000n })],
        ['polygon', makeFee('polygon', { feeUsd: baseCheaper ? 300_000n : 100_000n })],
      ]);
      return selector.select(requirement, balances, fees).then((r) => r[0]!.chainId);
    });

    const selected = await Promise.all(calls);
    for (let i = 0; i < selected.length; i += 1) {
      const expected = i % 2 === 1 ? 'base' : 'polygon';
      expect(selected[i]).toBe(expected);
    }
  });

  it('INV-9: no module-level let declarations in router source files', () => {
    const routerFiles = listTsFiles(ROUTER_SRC_DIR);
    const violations: string[] = [];

    for (const file of routerFiles) {
      const content = readFileSync(file, 'utf8');
      const lines = content.split('\n');
      let depth = 0;

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i]!;
        const trimmed = line.trim();
        if (depth === 0 && /^let\s+/.test(trimmed)) {
          violations.push(`${file}:${i + 1}:${trimmed}`);
        }

        const opens = (line.match(/{/g) ?? []).length;
        const closes = (line.match(/}/g) ?? []).length;
        depth = Math.max(0, depth + opens - closes);
      }
    }

    expect(violations).toEqual([]);
  });
});

describe('createRouter invariants', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('INV-10: RouteExhaustedError is catchable and request object remains unchanged', async () => {
    const adapters = new Map<ChainId, ChainAdapter>([['base', makeAdapter('base')]]);
    const staleFees = new Map<ChainId, FeeEstimate>([
      ['base', makeFee('base', { timestamp: Date.now() - 5_000 })],
    ]);
    const router = createRouter({
      adapters,
      feeOracle: makeFeeOracle(staleFees),
      strategy: 'cheapest',
      maxFeeAgeMs: 1_000,
    });

    const req: PaymentRequirement = {
      acceptedChains: [
        { chainId: 'base', payTo: '0xRecipient', amount: 1_000_000n, token: 'USDC' },
      ],
    };
    const original = structuredClone(req);

    let caught: unknown;
    try {
      await router.route(req, mockSigner);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RouteExhaustedError);
    const exhausted = caught as RouteExhaustedError;
    expect(exhausted.rejections[0]!.code).toBe('STALE_FEE');
    expect(req).toEqual(original);
  });

  it('INV-10: router failures never call process.exit', async () => {
    const adapters = new Map<ChainId, ChainAdapter>([['base', makeAdapter('base')]]);
    const staleFees = new Map<ChainId, FeeEstimate>([
      ['base', makeFee('base', { timestamp: Date.now() - 5_000 })],
    ]);
    const router = createRouter({
      adapters,
      feeOracle: makeFeeOracle(staleFees),
      strategy: 'cheapest',
      maxFeeAgeMs: 1_000,
    });

    const req: PaymentRequirement = {
      acceptedChains: [
        { chainId: 'base', payTo: '0xRecipient', amount: 1_000_000n, token: 'USDC' },
      ],
    };

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit must not be called');
    }) as typeof process.exit);

    await expect(router.route(req, mockSigner)).rejects.toThrow(RouteExhaustedError);
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});
