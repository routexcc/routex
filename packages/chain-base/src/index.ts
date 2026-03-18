// @routexcc/chain-base — Base chain adapter + shared EVM base class
export { EvmAdapter, type EvmPublicClient, type EvmAdapterConfig } from './EvmAdapter.js';
export {
  createBaseAdapter,
  type BaseAdapterConfig,
  BASE_MAINNET_CHAIN_ID,
  BASE_TESTNET_CHAIN_ID,
  BASE_FINALITY_MS,
} from './BaseAdapter.js';
