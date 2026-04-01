# @routexcc/chain-polygon

Polygon chain adapter for [Routex](https://github.com/routexcc/routex) — the multi-chain settlement cost router for the x402 payment protocol.

## Install

```bash
npm install @routexcc/core @routexcc/chain-polygon
```

## Usage

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

## Details

- **Technology**: viem (EVM), shares `EvmAdapter` base class with `@routexcc/chain-base`
- **Finality**: ~2000ms
- **Chain IDs**: 137 (mainnet), 80002 (Amoy testnet)
- **Signing**: EIP-712 typed data with chain-specific domain separator

## Exports

- `createPolygonAdapter(client, options?)` — factory function
- Re-exports `EvmAdapter` from `@routexcc/chain-base`

## Non-Custodial

The adapter calls `signer.sign()` or `signer.signTypedData()` to construct payment payloads. It never accesses `.privateKey`, `.secretKey`, or `.mnemonic`.

## Documentation

See the [full documentation](https://github.com/routexcc/routex) for routing strategies, configuration, and security model.

## License

MIT
