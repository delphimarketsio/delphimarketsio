//! Betting Platform Program
//! This program allows users to create betting pools, deposit funds, and claim winnings.

// Why this is needed: https://stackoverflow.com/questions/79225593/unexpected-cfg-condition-value-solana
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod main_state;
pub mod pool;

pub mod constants;
pub mod error;

use main_state::*;
use pool::*;

declare_id!("Dqxq5nTtVBCBjjWfxnuWMNGNCoB2PQc6JKoM1bQ4PuuE");

#[program]
pub mod betting_program {
    use super::*;

    pub fn init_main_state(ctx: Context<AInitMainState>) -> Result<()> {
        main_state::init_main_state(ctx)
    }

    pub fn update_main_state(
        ctx: Context<AUpdateMainState>,
        input: UpdateMainStateInput,
    ) -> Result<()> {
        main_state::update_main_state(ctx, input)
    }

    pub fn create_pool(ctx: Context<ACreatePool>, input: CreatePoolInput) -> Result<()> {
        pool::create_pool(ctx, input)
    }

    pub fn update_pool(ctx: Context<AUpdatePool>, input: UpdatePoolInput) -> Result<()> {
        pool::update_pool(ctx, input)
    }

    pub fn create_entry(ctx: Context<ACreateEntry>, input: CreateEntryInput) -> Result<()> {
        pool::create_entry(ctx, input)
    }

    pub fn deposit(ctx: Context<ADeposit>, input: DepositInput) -> Result<()> {
        pool::deposit(ctx, input)
    }

    pub fn set_winner(ctx: Context<ASetWinner>, input: SetWinnerInput) -> Result<()> {
        pool::set_winner(ctx, input)
    }

    pub fn claim(ctx: Context<AClaim>, input: ClaimInput) -> Result<()> {
        pool::claim(ctx, input)
    }

    pub fn claim_creator_fee(ctx: Context<AClaimCreatorFee>, input: ClaimCreatorFeeInput) -> Result<()> {
        pool::claim_creator_fee(ctx, input)
    }
}
