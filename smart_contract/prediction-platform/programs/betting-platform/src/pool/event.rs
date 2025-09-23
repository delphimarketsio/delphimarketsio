use anchor_lang::prelude::*;

#[event]
pub struct CreateEvent {
    pub creator: Pubkey,
    pub bet_id: u64,
    pub title: String,
    pub description: String,
    pub end_timestamp: i64,
    pub referee: Pubkey,
    pub share_uuid: String,
    pub timestamp: i64,
}

#[event]
pub struct DepositEvent {
    pub user: Pubkey,
    pub bet_id: u64,
    pub sol_amount: u64,
    pub token_amount: u64,
    pub is_yes: bool,
    pub timestamp: i64,
}

#[event]
pub struct CompleteEvent {
    pub referee: Pubkey,
    pub bet_id: u64,
    pub winner: String,
    pub timestamp: i64,
}
