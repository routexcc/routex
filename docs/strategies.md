# Routing Strategies

Routex supports four routing strategies. Each strategy is a pure function that scores route candidates and returns them sorted by preference.

## Cheapest

**Use when**: Minimizing transaction costs is your top priority.

```typescript
const router = createRouter({ strategy: 'cheapest', ... });
```

**Scoring formula**: `score = 1 / (feeUsd + 0.0001)`

The cheapest strategy picks the chain with the lowest fee in USD. The small epsilon (0.0001) prevents division by zero when fees are near-zero (e.g., Stellar). Ties are broken by finality time — if two chains have equal fees, the faster one wins.

**Best for**: High-volume micropayments where per-transaction cost matters more than speed.

## Fastest

**Use when**: Minimizing confirmation time is your top priority.

```typescript
const router = createRouter({ strategy: 'fastest', ... });
```

**Scoring formula**: `score = 1 / (finalityMs + 1)`

The fastest strategy picks the chain with the shortest time to finality. Ties are broken by fee — if two chains have equal finality, the cheaper one wins.

**Typical finality times**:
| Chain | Finality |
|---|---|
| Solana | ~400ms |
| Base | ~2000ms |
| Polygon | ~2000ms |
| Stellar | ~5000ms |

**Best for**: Latency-sensitive applications where the agent needs confirmation quickly.

## Balanced

**Use when**: You want a reasonable trade-off between cost and speed.

```typescript
const router = createRouter({ strategy: 'balanced', ... });
```

**Scoring formula**: `score = (0.6 * normalizedFeeScore) + (0.4 * normalizedFinalityScore)`

The balanced strategy normalizes both fee and finality across the candidate set, then applies a weighted sum. The default weights (60% fee, 40% finality) favor cost savings while still penalizing slow chains.

**Normalization**: Each metric is divided by the maximum value in the candidate set, ensuring scores are comparable regardless of absolute values.

**Best for**: General-purpose routing when you don't have a strong preference.

## Custom

**Use when**: You need application-specific scoring logic.

```typescript
const router = createRouter({
  strategy: {
    type: 'custom',
    scorer: (options) => {
      return options.map(option => ({
        ...option,
        score: myCustomScore(option),
      }));
    },
  },
  ...
});
```

The custom strategy receives all eligible `RouteOption` candidates and must return them with `score` values assigned. The highest-scored option is selected.

Each `RouteOption` includes:
- `chainId` — which chain
- `payment` — the `AcceptedPayment` from the 402 response
- `fee` — the `FeeEstimate` (includes `feeUsd`, `finalityMs`, `confidence`)
- `balance` — available token balance on this chain
- `score` — set by your scorer

**Best for**: Domain-specific routing logic (e.g., prefer specific chains for compliance, weight by chain reliability, or factor in historical performance).
