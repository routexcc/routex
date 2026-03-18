import { describe, it, expect } from 'vitest';

describe('@routexcc/x402', () => {
  it('re-exports middleware from the source barrel', async () => {
    const mod = await import('../src/index.js');
    expect(mod.routexMiddleware).toBeTypeOf('function');
  });
});
