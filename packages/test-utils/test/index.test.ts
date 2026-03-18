import { describe, it, expect } from 'vitest';

describe('@routexcc/test-utils', () => {
  it('re-exports fixture and mock helpers from the source barrel', async () => {
    const mod = await import('../src/index.js');

    expect(mod.ADDRESSES).toBeDefined();
    expect(mod.USDC_ADDRESSES).toBeDefined();
    expect(mod.BASE_PAYMENT).toBeDefined();
    expect(mod.createMockEvmClient).toBeTypeOf('function');
    expect(mod.createMockStellarServer).toBeTypeOf('function');
    expect(mod.createMockSolanaConnection).toBeTypeOf('function');
    expect(mod.createMockSigner).toBeTypeOf('function');
  });
});
