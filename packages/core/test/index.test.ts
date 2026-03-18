import { describe, it, expect } from 'vitest';
import * as core from '../src/index.js';

describe('index exports', () => {
  it('exports runtime APIs from the public surface', () => {
    expect(typeof core.createRouter).toBe('function');
    expect(typeof core.RouteSelector).toBe('function');
    expect(typeof core.LocalFeeOracle).toBe('function');
    expect(typeof core.BalanceManager).toBe('function');
    expect(typeof core.cheapest).toBe('function');
    expect(typeof core.fastest).toBe('function');
    expect(typeof core.balanced).toBe('function');
    expect(typeof core.custom).toBe('function');
    expect(typeof core.RoutexError).toBe('function');
    expect(typeof core.RouteExhaustedError).toBe('function');
    expect(typeof core.StaleFeesError).toBe('function');
    expect(typeof core.InsufficientBalanceError).toBe('function');
    expect(typeof core.PaymentConstructionError).toBe('function');
  });
});
