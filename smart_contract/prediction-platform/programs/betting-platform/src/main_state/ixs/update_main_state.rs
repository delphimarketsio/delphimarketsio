use crate::{error::BettingError, MainState};
use anchor_lang::prelude::*;

#[derive(AnchorDeserialize, AnchorSerialize, Debug, Clone, Copy)]
pub struct UpdateMainStateInput {
    owner: Pubkey,
    initial_price: u64,
    scale_factor: u64,
    creator_fee_percent: u64,
    platform_fee_percent: u64,
}

pub fn update_main_state(
    ctx: Context<AUpdateMainState>,
    input: UpdateMainStateInput,
) -> Result<()> {
    let state = &mut ctx.accounts.main_state;
    require!(state.initialized.eq(&true), BettingError::Uninitialized);

    state.owner = input.owner;
    state.initial_price = input.initial_price;
    state.scale_factor = input.scale_factor;
    state.creator_fee_percent = input.creator_fee_percent;
    state.platform_fee_percent = input.platform_fee_percent;

    Ok(())
}

#[derive(Accounts)]
pub struct AUpdateMainState<'info> {
    #[account(mut, address = main_state.owner @ BettingError::Unauthorized)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [MainState::PREFIX_SEED],
        bump,
        has_one = owner,
    )]
    pub main_state: Account<'info, MainState>,
}
