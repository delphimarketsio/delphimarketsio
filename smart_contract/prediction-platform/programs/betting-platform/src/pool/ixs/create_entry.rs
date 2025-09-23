use anchor_lang::prelude::*;

use crate::{error::BettingError, EntryState, MainState, PoolState};

#[derive(AnchorDeserialize, AnchorSerialize, Clone, Copy, Debug)]
pub struct CreateEntryInput {
    pub bet_id: u64,
}

pub fn create_entry(ctx: Context<ACreateEntry>, input: CreateEntryInput) -> Result<()> {
    let entry_state = &mut ctx.accounts.entry_state;
    let pool_state = &mut ctx.accounts.pool_state;

    // Disallow creating entries after the market is completed
    require!(!pool_state.complete, BettingError::BetComplete);

    // For fixed-time markets, prevent creating entries after end. Open-ended markets (negative
    // end_timestamp) allow entries until the market is resolved.
    if pool_state.end_timestamp >= 0 {
        require!(
            pool_state.end_timestamp > Clock::get()?.unix_timestamp,
            BettingError::BetEnded
        );
    }

    entry_state.user = ctx.accounts.user.key();
    entry_state.bet_id = input.bet_id;
    entry_state.deposited_sol_amount = 0;
    entry_state.token_balance = 0;
    entry_state.is_yes = true;
    entry_state.is_claimed = false;

    Ok(())
}

#[derive(Accounts)]
#[instruction(input: CreateEntryInput)]
pub struct ACreateEntry<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [MainState::PREFIX_SEED],
        bump,
    )]
    pub main_state: Box<Account<'info, MainState>>,

    #[account(
        mut,
        seeds =[
            PoolState::PREFIX_SEED,
            &input.bet_id.to_le_bytes(),
        ],
        bump
    )]
    pub pool_state: Box<Account<'info, PoolState>>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + EntryState::MAX_SIZE,
        seeds = [
            EntryState::PREFIX_SEED,
            &pool_state.key().to_bytes(),
            &user.key().to_bytes()
        ],
        bump
    )]
    pub entry_state: Account<'info, EntryState>,

    pub system_program: Program<'info, System>,
}
