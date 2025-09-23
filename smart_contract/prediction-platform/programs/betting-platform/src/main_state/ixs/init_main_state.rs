use crate::{
    constants::{CREATOR_FEE_PERCENT, INITIAL_PRICE, SCALE_FACTOR, VAULT_SEED, PLATFORM_FEE_PERCENT},
    error::BettingError,
    MainState,
};
use anchor_lang::{prelude::*, solana_program};
use anchor_lang::solana_program::sysvar::rent::Rent;

pub fn init_main_state(ctx: Context<AInitMainState>) -> Result<()> {
    let state = &mut ctx.accounts.main_state;
    require!(
        state.initialized.eq(&false),
        BettingError::AlreadyInitialized
    );

    state.initialized = true;
    state.owner = ctx.accounts.owner.key();
    state.initial_price = INITIAL_PRICE;
    state.scale_factor = SCALE_FACTOR;
    state.current_bet_id = 0;
    state.creator_fee_percent = CREATOR_FEE_PERCENT;
    state.platform_fee_percent = PLATFORM_FEE_PERCENT;

    let ix = solana_program::system_instruction::transfer(
        ctx.accounts.owner.to_account_info().key,
        ctx.accounts.sol_vault.to_account_info().key,
        ctx.accounts.rent.minimum_balance(0),
    );
    solana_program::program::invoke(
        &ix,
        &[
            ctx.accounts.owner.to_account_info(),
            ctx.accounts.sol_vault.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
    )?;

    Ok(())
}

#[derive(Accounts)]
pub struct AInitMainState<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        seeds = [MainState::PREFIX_SEED],
        bump,
        space = 8 + MainState::MAX_SIZE
    )]
    pub main_state: Account<'info, MainState>,

    #[account(
        mut,
        seeds = [VAULT_SEED.as_bytes()],
        bump
    )]
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub sol_vault: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
