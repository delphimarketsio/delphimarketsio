use anchor_lang::prelude::*;

#[account]
pub struct MainState {
    pub initialized: bool,
    pub owner: Pubkey,
    pub scale_factor: u64,
    pub initial_price: u64,
    pub current_bet_id: u64,
    pub creator_fee_percent: u64, // Creator fee percentage in basis points (e.g., 100 = 1%)
    pub platform_fee_percent: u64, // Platform fee percentage in basis points, paid to owner
}

impl MainState {
    pub const MAX_SIZE: usize = std::mem::size_of::<Self>();
    pub const PREFIX_SEED: &'static [u8] = b"main";
}
