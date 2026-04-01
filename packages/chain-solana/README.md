# @routexcc/chain-solana

Solana chain adapter for [Routex](https://github.com/routexcc/routex) — the multi-chain settlement cost router for the x402 payment protocol.

## Install

```bash
npm install @routexcc/core @routexcc/chain-solana
```

## Usage

```typescript
import { createSolanaAdapter } from '@routexcc/chain-solana';

const adapter = createSolanaAdapter(solanaRpcClient, {
  usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
});
```

## Details

- **Technology**: @solana/web3.js
- **Finality**: ~400ms (slot time)
- **Token**: USDC as SPL token
- **RPC methods**: `getTokenAccountBalance`, `getTokenAccountsByOwner`, `getRecentPrioritizationFees`

Fee estimation uses base fee (5000 lamports) plus median prioritization fee.

## Exports

- `createSolanaAdapter(rpcClient, options)` — factory function
- `SolanaAdapter` — adapter class

## Non-Custodial

The adapter calls `signer.sign()` to construct payment payloads. It never accesses `.privateKey`, `.secretKey`, or `.mnemonic`.

## Documentation

See the [full documentation](https://github.com/routexcc/routex) for routing strategies, configuration, and security model.

## License

MIT
