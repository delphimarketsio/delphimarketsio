use crate::{error::BettingError, MainState, PoolState};
use anchor_lang::prelude::*;

#[derive(AnchorDeserialize, AnchorSerialize, Clone, Debug)]
pub struct UpdatePoolInput {
    pub bet_id: u64,
    pub title: Option<String>,
    pub description: Option<String>,
    pub end_timestamp: Option<i64>,
    pub referee: Option<Pubkey>,
}

pub fn update_pool(ctx: Context<AUpdatePool>, input: UpdatePoolInput) -> Result<()> {
    let main_state = &ctx.accounts.main_state;
    let pool_state = &mut ctx.accounts.pool_state;
    let updater = &ctx.accounts.updater;

    // Only pool creator or main state owner can update the pool
    require!(
        pool_state.creator.eq(&updater.key()) || main_state.owner.eq(&updater.key()),
        BettingError::Unauthorized
    );

    // Cannot update a completed pool
    require!(
        !pool_state.complete,
        BettingError::BetComplete
    );

    // Update title if provided
    if let Some(title) = input.title {
        require!(
            title.len() <= 100,
            BettingError::TitleTooLong
        );
        require!(
            !title.is_empty(),
            BettingError::TitleEmpty
        );
        pool_state.title = title;
    }

    // Update description if provided
    if let Some(description) = input.description {
        require!(
            description.len() <= 500,
            BettingError::DescriptionTooLong
        );
        require!(
            !description.is_empty(),
            BettingError::DescriptionEmpty
        );
        pool_state.description = description;
    }

    // Update other parameters if provided
    if let Some(end_timestamp) = input.end_timestamp {
        pool_state.end_timestamp = end_timestamp;
    }

    if let Some(referee) = input.referee {
        pool_state.referee = referee;
    }

    // min_buy_amount removed

    Ok(())
}

#[derive(Accounts)]
#[instruction(input: UpdatePoolInput)]
pub struct AUpdatePool<'info> {
    #[account(mut)]
    pub updater: Signer<'info>,

    #[account(
        seeds = [MainState::PREFIX_SEED],
        bump,
    )]
    pub main_state: Box<Account<'info, MainState>>,

    #[account(
        mut,
        seeds = [
            PoolState::PREFIX_SEED,
            &input.bet_id.to_le_bytes(),
        ],
        bump
    )]
    pub pool_state: Box<Account<'info, PoolState>>,
}
