# Batch Settlement

Routex Cloud batches micropayments into single on-chain transactions via Permit2, reducing gas costs by up to 99%.

## How it works

```
Agent SDK                    Oracle Service                    Chain
    │                             │                              │
    │  POST /v1/batch/submit      │                              │
    │  (EIP-712 signed intent)    │                              │
    │────────────────────────────>│                              │
    │                             │  validate sig + nonce        │
    │                             │  enqueue in Redis            │
    │                             │                              │
    │                             │  [batch window: 5min/$1]     │
    │                             │                              │
    │                             │  build Permit2 multicall     │
    │                             │─────────────────────────────>│
    │                             │  transferFrom × N intents    │
    │                             │<─────────────────────────────│
    │                             │  record settlement           │
```

1. **Intent signing**: Agent signs an EIP-712 `RoutexBatchIntent` struct with their wallet
2. **Submission**: `POST /v1/batch/submit` with Bearer `rtx_` key authentication
3. **Validation**: Signature verified, nonce checked (monotonic per `from,to`), deadline checked
4. **Queueing**: Intent enqueued in per-chain Redis queue
5. **Batch close**: Window closes after 5 minutes or $1.00 accumulated value
6. **Settlement**: Worker builds Permit2 `transferFrom` multicall transaction
7. **Fee split**: 0.02% to treasury, remainder to payment recipient

## Supported chains

Batch settlement uses Permit2, which is EVM-only. Currently supported:

| Chain | Chain ID | USDC Contract |
|---|---|---|
| Base | 8453 | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Polygon | 137 | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` |

Permit2 address (same on all EVM chains): `0x000000000022D473030F116dDEE9F6B43aC78BA3`

## EIP-712 Intent Structure

```
Domain:
  name: "Routex"
  version: "1"
  chainId: <8453 or 137>
  verifyingContract: <Permit2 address>

RoutexBatchIntent:
  from:     address  — agent's wallet
  to:       address  — payment recipient
  amount:   uint256  — USDC amount (6 decimals)
  token:    address  — USDC contract
  nonce:    uint256  — monotonic per (from, to)
  deadline: uint256  — unix timestamp expiry
  chainId:  uint256  — prevents cross-chain replay
```

The domain separator includes `chainId` and `verifyingContract`, making signatures chain-specific. A signature for Base cannot be replayed on Polygon.

## Nonce management

- Nonces are monotonically increasing per `(from, to)` pair
- Must be exactly `previous + 1` — no gaps allowed
- **Consumed on submission**, not on settlement
- Even if a settlement fails, the nonce is consumed — this prevents replay attacks via forced failure
- To retry after a failed settlement, create a new intent with the next nonce

## Fee structure

```
feeRate     = 0.0002  (0.02%, 2 basis points)
feeAmount   = totalAmount * feeRate
serverAmount = totalAmount - feeAmount

Invariant: serverAmount + feeAmount === totalAmount (BigInt, zero rounding loss)
```

The fee rate is a hardcoded source code constant — not configurable via environment variables or API.

## Partial settlement

If the agent's on-chain USDC balance is insufficient to cover all intents in a batch:

1. Intents are sorted by nonce (oldest first)
2. As many intents as possible are settled within the available balance
3. Remaining intents are marked as failed
4. Failed intents' nonces are consumed (cannot be reused)
5. Agent creates new intents with new nonces to retry

## Rate limiting

- **100 intents/second** per API key (enforced via Redis Lua script)
- **100 settlements/hour** globally (settlement worker rate limit)
- **Anomaly detection**: >50 settlements in 10 minutes triggers alert and pause

## Security

| Property | Guarantee |
|---|---|
| Replay protection | Nonce consumed on submission, domain separator per chain |
| Fund safety | Permit2 allowance scoped, hot wallet holds gas only ($50 max) |
| Fee integrity | Rate is a source code constant, invariant checked on every split |
| Recipient match | Multicall rejects if intent `to` differs from batch recipient |
| Failover | Active-passive via Redis heartbeat (30s TTL, 90s takeover) |

## Trust model

- **Non-custodial**: Routex never holds agent funds. Permit2 `transferFrom` moves USDC directly from agent to recipient.
- **Agent controls allowance**: Agent grants Permit2 a limited, time-scoped allowance (recommended: max $10, 48-hour expiry).
- **Verifiable**: All settlements are on-chain transactions with tx hashes. Dashboard shows per-intent settlement status.
