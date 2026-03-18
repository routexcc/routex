import { describe, it, expect } from 'vitest';

describe('@routexcc/cloud', () => {
  it('package loads without error', async () => {
    const mod = await import('@routexcc/cloud');
    expect(mod).toBeDefined();
  });
});
