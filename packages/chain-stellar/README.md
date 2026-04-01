# @routexcc/chain-stellar

Stellar chain adapter for [Routex](https://github.com/routexcc/routex) — the multi-chain settlement cost router for the x402 payment protocol.

## Install

```bash
npm install @routexcc/core @routexcc/chain-stellar
```

## Usage

```typescript
import { createStellarAdapter } from '@routexcc/chain-stellar';

const adapter = createStellarAdapter(stellarRpcClient, {
  usdcIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
});
```

## Details

- **Technology**: @stellar/stellar-sdk
- **Finality**: ~5000ms (consensus round)
- **Token**: USDC via trustline
- **RPC**: Horizon API (account balances, fee stats) + Stellar RPC (transaction submission)

Stellar uses 7-decimal precision internally; the adapter converts to 6-decimal USDC precision.

## Exports

- `createStellarAdapter(rpcClient, options)` — factory function
- `StellarAdapter` — adapter class

## Non-Custodial

The adapter calls `signer.sign()` to construct payment payloads. It never accesses `.privateKey`, `.secretKey`, or `.mnemonic`.

## Documentation

See the [full documentation](https://github.com/routexcc/routex) for routing strategies, configuration, and security model.

## License

MIT
