// @routexcc/test-utils — Shared mocks, fixtures, helpers
export {
  createMockEvmClient,
  createMockStellarServer,
  createMockSolanaConnection,
  createMockSigner,
  type MockBehavior,
  type EvmPublicClient,
  type MockEvmClientConfig,
  type StellarRpcClient,
  type StellarBalance,
  type StellarAccountResponse,
  type StellarFeeStats,
  type MockStellarServerConfig,
  type SolanaRpcClient,
  type SolanaTokenBalanceResponse,
  type SolanaTokenAccountsResponse,
  type SolanaPriorityFee,
  type MockSolanaConnectionConfig,
  type MockSignerConfig,
} from './mockRpc.js';

export {
  ADDRESSES,
  USDC_ADDRESSES,
  EVM_CHAIN_IDS,
  STANDARD_AMOUNT,
  LARGE_AMOUNT,
  ZERO_AMOUNT,
  BASE_PAYMENT,
  POLYGON_PAYMENT,
  STELLAR_PAYMENT,
  SOLANA_PAYMENT,
} from './fixtures.js';
