use crate::constants::VAULT_SEED;
use crate::{error::BettingError, MainState, PoolState};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_instruction;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct ClaimCreatorFeeInput {
    bet_id: u64,
}

pub fn claim_creator_fee(ctx: Context<AClaimCreatorFee>, _input: ClaimCreatorFeeInput) -> Result<()> {
    let pool_state = &mut ctx.accounts.pool_state;
    let main_state = &ctx.accounts.main_state;
    let creator = &ctx.accounts.creator;

    require!(
        pool_state.creator == creator.key(),
        BettingError::Unauthorized
    );
    require!(
        !pool_state.creator_fee_claimed,
        BettingError::AlreadyClaimed
    );
    // For fixed-time markets, ensure end time passed; open-ended markets use completion only.
    if pool_state.end_timestamp >= 0 {
        require!(
            pool_state.end_timestamp < Clock::get()?.unix_timestamp,
            BettingError::BetNotEnded
        );
    }
    require!(pool_state.complete, BettingError::BetNotComplete);

    // Mark as claimed first to prevent reentrancy
    pool_state.creator_fee_claimed = true;

    // Fee taken proportionally from total reserve
    let total_reserve = (pool_state.yes_reserve as u128)
        .saturating_add(pool_state.no_reserve as u128);
    let creator_fee = total_reserve
        .saturating_mul(main_state.creator_fee_percent as u128)
        / 10000u128;
    let creator_fee: u64 = creator_fee.min(u64::MAX as u128) as u64;

    // Only transfer if there's actually a fee to claim
    if creator_fee > 0 {
        let transfer_instruction = system_instruction::transfer(
            &ctx.accounts.sol_vault.to_account_info().key(),
            &creator.to_account_info().key(),
            creator_fee,
        );

        // Invoke the transfer instruction with the PDA's seeds
        anchor_lang::solana_program::program::invoke_signed(
            &transfer_instruction,
            &[
                ctx.accounts.sol_vault.to_account_info(),
                creator.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[&[VAULT_SEED.as_bytes(), &[ctx.bumps.sol_vault]]],
        )?;
    }

    Ok(())
}

#[derive(Accounts)]
#[instruction(input: ClaimCreatorFeeInput)]
pub struct AClaimCreatorFee<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        seeds = [MainState::PREFIX_SEED],
        bump
    )]
    pub main_state: Account<'info, MainState>,

    #[account(
        mut,
        seeds =[
            PoolState::PREFIX_SEED,
            &input.bet_id.to_le_bytes(),
        ],
        bump,
        has_one = creator
    )]
    pub pool_state: Box<Account<'info, PoolState>>,

    #[account(
        mut,
        seeds = [VAULT_SEED.as_bytes()],
        bump
    )]
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub sol_vault: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}
