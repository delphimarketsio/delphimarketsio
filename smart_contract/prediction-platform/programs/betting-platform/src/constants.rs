pub const NATIVE_MINT_STR: &str = "So11111111111111111111111111111111111111112";

pub const INITIAL_PRICE: u64 = 100_000_000;
pub const SCALE_FACTOR: u64 = 10_000_000;

// Creator incentive: 1% of losing pool (100 basis points out of 10,000)
// Updated via Issue #34 to reduce creator fee and improve participant payouts
pub const CREATOR_FEE_PERCENT: u64 = 100; // 1% (in basis points: 100/10000 = 0.01)

// Platform fee paid to MainState.owner after market close, deducted from losing pool
// Updated via Issue #34: Platform fee set to 2% (200 basis points)
pub const PLATFORM_FEE_PERCENT: u64 = 200; // 2%

pub const VAULT_SEED: &str = "sol-vault";
