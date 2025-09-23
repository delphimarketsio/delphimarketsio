use anchor_lang::prelude::*;

#[account]
pub struct PoolState {
    pub creator: Pubkey,
    pub bet_id: u64,
    pub initial_price: u64,
    pub scale_factor: u64,

    pub total_supply: u64,
    pub total_reserve: u64,
    pub yes_supply: u64,
    pub yes_reserve: u64,
    pub no_supply: u64,
    pub no_reserve: u64,

    pub end_timestamp: i64,
    // New: block time when the pool was created
    pub created_timestamp: i64,
    pub referee: Pubkey,

    pub title: String,       // Bet title (max 100 chars)
    pub description: String, // Bet description (max 500 chars)
    pub share_uuid: String,  // Unique identifier for shareable link (max 50 chars)

    pub winner: String,
    pub complete: bool,
    pub creator_fee_claimed: bool, // Track if creator has claimed their fee
    pub platform_fee_claimed: bool, // Track if platform has claimed its fee
}

impl PoolState {
    pub const MAX_SIZE: usize = 32 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 32 + (4 + 100) + (4 + 500) + (4 + 50) + (4 + 50) + 1 + 1 + 1; // ~852 bytes
    pub const PREFIX_SEED: &'static [u8] = b"pool";
}

// Probability history for a pool (market)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default)]
pub struct ProbabilityPoint {
    pub timestamp: i64,      // block time when recorded
    pub yes_reserve: u64,    // lamports on YES side at this time
    pub no_reserve: u64,     // lamports on NO side at this time
}

#[account]
pub struct PoolHistoryState {
    pub pool: Pubkey,                // reference to the pool
    pub bet_id: u64,                 // convenience: same as pool.bet_id
    pub points: Vec<ProbabilityPoint>, // chronological series of points
}

impl PoolHistoryState {
    // Each ProbabilityPoint = 24 bytes (i64 + u64 + u64)
    // 40 points * 24 = 960 bytes; overhead (pool 32 + bet_id 8 + vec len 4) = 44 bytes; total
    // data size (excluding 8-byte discriminator) ≈ 1004 bytes.
    pub const MAX_POINTS: usize = 40;
    pub const PREFIX_SEED: &'static [u8] = b"history";

    // discriminator (8) + pool(32) + bet_id(8) + vec len(4) + points
    pub const MAX_SIZE: usize = 32 + 8 + 4 + (Self::MAX_POINTS * core::mem::size_of::<ProbabilityPoint>());
}

#[account]
pub struct EntryState {
    pub user: Pubkey,
    pub bet_id: u64,
    pub deposited_sol_amount: u64,
    pub token_balance: u64,
    pub is_yes: bool,
    pub is_claimed: bool,
}

impl EntryState {
    pub const MAX_SIZE: usize = std::mem::size_of::<Self>();
    pub const PREFIX_SEED: &'static [u8] = b"entry";
}
