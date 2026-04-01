# @routexcc/chain-base

Base (L2) chain adapter for [Routex](https://github.com/routexcc/routex) — the multi-chain settlement cost router for the x402 payment protocol.

## Install

```bash
npm install @routexcc/core @routexcc/chain-base
```

## Usage

```typescript
import { createBaseAdapter } from '@routexcc/chain-base';
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';

const client = createPublicClient({
  chain: base,
  transport: http('https://base-mainnet.g.alchemy.com/v2/YOUR_KEY'),
});

const adapter = createBaseAdapter(client);
// Testnet: createBaseAdapter(client, { testnet: true })
```

## Details

- **Technology**: viem (EVM)
- **Finality**: ~2000ms (L2 block time)
- **Chain IDs**: 8453 (mainnet), 84532 (Sepolia testnet)
- **Signing**: EIP-712 typed data with chain-specific domain separator
- **RPC methods**: `eth_call`, `eth_gasPrice`, `eth_estimateGas`

## Exports

- `createBaseAdapter(client, options?)` — factory function
- `EvmAdapter` — shared EVM base class (also used by `@routexcc/chain-polygon`)

## Non-Custodial

The adapter calls `signer.sign()` or `signer.signTypedData()` to construct payment payloads. It never accesses `.privateKey`, `.secretKey`, or `.mnemonic`.

## Documentation

See the [full documentation](https://github.com/routexcc/routex) for routing strategies, configuration, and security model.

## License

MIT
