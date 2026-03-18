# Chain Adapters

Routex supports four blockchains. Each adapter implements the `ChainAdapter` interface and handles chain-specific balance queries, fee estimation, and payment payload construction.

## Base (`@routexcc/chain-base`)

**Technology**: viem (EVM)
**Finality**: ~2000ms (L2 block time)
**Chain IDs**: 8453 (mainnet), 84532 (Sepolia testnet)

### Installation

```bash
pnpm add @routexcc/chain-base
```

### Setup

```typescript
import { createBaseAdapter } from '@routexcc/chain-base';
import { createPublicClient, http } from 'viem';
import { base, baseSepolia } from 'viem/chains';

// Mainnet
const client = createPublicClient({
  chain: base,
  transport: http('https://base-mainnet.g.alchemy.com/v2/YOUR_KEY'),
});
const adapter = createBaseAdapter(client);

// Testnet
const testClient = createPublicClient({
  chain: baseSepolia,
  transport: http('https://base-sepolia.g.alchemy.com/v2/YOUR_KEY'),
});
const testAdapter = createBaseAdapter(testClient, { testnet: true });
```

### RPC Requirements

- `eth_call` (ERC-20 `balanceOf`)
- `eth_gasPrice`
- `eth_estimateGas`

### Payload Format

EIP-712 signed typed data with domain separator including `chainId` and `verifyingContract`.

---

## Polygon (`@routexcc/chain-polygon`)

**Technology**: viem (EVM), shares `EvmAdapter` base class with Base
**Finality**: ~2000ms
**Chain IDs**: 137 (mainnet), 80002 (Amoy testnet)

### Installation

```bash
pnpm add @routexcc/chain-polygon
```

### Setup

```typescript
import { createPolygonAdapter } from '@routexcc/chain-polygon';
import { createPublicClient, http } from 'viem';
import { polygon } from 'viem/chains';

const client = createPublicClient({
  chain: polygon,
  transport: http('https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY'),
});
const adapter = createPolygonAdapter(client);
```

### RPC Requirements

Same as Base (shared EVM implementation).

---

## Stellar (`@routexcc/chain-stellar`)

**Technology**: @stellar/stellar-sdk
**Finality**: ~5000ms (consensus round)
**Token**: USDC via trustline

### Installation

```bash
pnpm add @routexcc/chain-stellar
```

### Setup

```typescript
import { createStellarAdapter } from '@routexcc/chain-stellar';

const adapter = createStellarAdapter(stellarRpcClient, {
  usdcIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
});
```

### RPC Requirements

- Horizon API: account balances, fee stats
- Stellar RPC: transaction submission

### Notes

- Stellar uses 7-decimal precision internally; the adapter converts to 6-decimal USDC precision.
- USDC balance is read from the account's trustline for the specified issuer.

---

## Solana (`@routexcc/chain-solana`)

**Technology**: @solana/web3.js
**Finality**: ~400ms (slot time)
**Token**: USDC as SPL token

### Installation

```bash
pnpm add @routexcc/chain-solana
```

### Setup

```typescript
import { createSolanaAdapter } from '@routexcc/chain-solana';

const adapter = createSolanaAdapter(solanaRpcClient, {
  usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
});
```

### RPC Requirements

- `getTokenAccountBalance`
- `getTokenAccountsByOwner`
- `getRecentPrioritizationFees`

### Notes

- Fee estimation uses base fee (5000 lamports) plus median prioritization fee.
- Lamport-to-USD conversion uses 9-decimal precision.

---

## Common Interface

All adapters implement `ChainAdapter`:

```typescript
interface ChainAdapter {
  readonly chainId: ChainId;
  getBalance(address: string, token: string): Promise<TokenBalance>;
  estimateFee(payment: AcceptedPayment): Promise<FeeEstimate>;
  buildPaymentPayload(payment: AcceptedPayment, signer: Signer): Promise<PaymentPayload>;
  getFinality(): number;
}
```

The adapter never accesses the signer's private key. It calls `signer.sign()` or `signer.signTypedData()` and receives only the signature.
