# @routexcc/chain-solana

Solana chain adapter for Routex.

## Install

```bash
npm install @routexcc/chain-solana
```

## Usage

```ts
import { createSolanaAdapter } from "@routexcc/chain-solana";
import { Connection } from "@solana/web3.js";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const adapter = createSolanaAdapter(connection);
```

## Documentation

See the [main repo README](https://github.com/routexcc/routex) for full documentation.

Part of the [Routex](https://github.com/routexcc/routex) monorepo by [Thalaxis](https://thalaxis.com).

## License

MIT
