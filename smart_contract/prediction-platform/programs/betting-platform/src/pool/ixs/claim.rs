use crate::constants::VAULT_SEED;
use crate::{error::BettingError, EntryState, MainState, PoolState};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_instruction;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct ClaimInput {
    bet_id: u64,
}

pub fn claim(ctx: Context<AClaim>, _input: ClaimInput) -> Result<()> {
    let pool_state = &mut ctx.accounts.pool_state;
    let entry_state = &mut ctx.accounts.entry_state;
    let main_state = &ctx.accounts.main_state;
    let _system_program = &ctx.accounts.system_program;
    let user = &ctx.accounts.user;

    require!(
        !entry_state.is_claimed,
        BettingError::AlreadyClaimed
    );
    // For fixed-time markets, ensure the end time passed; for open-ended markets, completion suffices.
    if pool_state.end_timestamp >= 0 {
        require!(
            pool_state.end_timestamp < Clock::get()?.unix_timestamp,
            BettingError::BetNotEnded
        );
    }
    require!(pool_state.complete, BettingError::BetNotComplete);
    let winner: bool = pool_state.winner.eq(&"yes");
    require!(entry_state.is_yes == winner, BettingError::WrongBet);

    entry_state.is_claimed = true;

    // ------------------------------------------------------------------
    // PRINCIPAL + LOSING RESERVE PROFIT MODEL
    // New model: A correct (winning side) participant always receives:
    //    payout = principal_deposit + pro_rata_share_of(post_fee_losing_reserve)
    // Token weights (minted at deposit time via virtual-reserve pricing) are used ONLY to
    // apportion the profit component (post-fee losing reserve). This preserves time/price
    // differentiation for profits while guaranteeing a winner never receives less than their
    // deposited principal.
    // ------------------------------------------------------------------

    // Identify reserves & supplies by outcome
    let (yes_reserve, no_reserve, winning_supply, user_tokens) = if winner {
        (
            pool_state.yes_reserve as u128,
            pool_state.no_reserve as u128,
            pool_state.yes_supply as u128,
            entry_state.token_balance as u128,
        )
    } else {
        (
            pool_state.yes_reserve as u128,
            pool_state.no_reserve as u128,
            pool_state.no_supply as u128,
            entry_state.token_balance as u128,
        )
    };

    require!(winning_supply > 0, BettingError::MathOverflow);
    require!(user_tokens > 0, BettingError::WrongBet);

    let total_reserve = yes_reserve.saturating_add(no_reserve);

    // Fees now applied on total reserve (both sides contribute)
    let creator_fee = total_reserve
        .saturating_mul(main_state.creator_fee_percent as u128)
        / 10000u128;
    let platform_fee = total_reserve
        .saturating_mul(main_state.platform_fee_percent as u128)
        / 10000u128;

    // Principal of winning side is the sum of deposits represented by its token supply.
    // We reconstruct an approximate principal_winning_side by summing reserves on that side.
    let winning_reserve = if winner { yes_reserve } else { no_reserve };

    // Available profit after removing winning principal and fees
    let available_profit = total_reserve
        .saturating_sub(winning_reserve)
        .saturating_sub(creator_fee)
        .saturating_sub(platform_fee);

    let profit_share_u128 = if available_profit > 0 {
        user_tokens
            .saturating_mul(available_profit)
            / winning_supply
    } else { 0 };

    let principal_u128: u128 = entry_state.deposited_sol_amount as u128;
    let claim_total_u128 = principal_u128.saturating_add(profit_share_u128);

    let claimable_amount: u64 = claim_total_u128
        .try_into()
        .map_err(|_| error!(BettingError::MathOverflow))?;

    let transfer_instruction = system_instruction::transfer(
        &ctx.accounts.sol_vault.to_account_info().key(),
        &user.to_account_info().key(),
        claimable_amount,
    );

    // Invoke the transfer instruction with the PDA's seeds
    anchor_lang::solana_program::program::invoke_signed(
        &transfer_instruction,
        &[
            ctx.accounts.sol_vault.to_account_info(),
            user.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        &[&[VAULT_SEED.as_bytes(), &[ctx.bumps.sol_vault]]],
    )?;

    Ok(())
}

#[derive(Accounts)]
#[instruction(input: ClaimInput)]
pub struct AClaim<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

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
    )]
    pub pool_state: Box<Account<'info, PoolState>>,

    #[account(
        mut,
        seeds = [
            EntryState::PREFIX_SEED,
            &pool_state.key().to_bytes(),
            &user.key().to_bytes()
        ],
        bump
    )]
    pub entry_state: Account<'info, EntryState>,

    #[account(
        mut,
        seeds = [VAULT_SEED.as_bytes()],
        bump
    )]
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub sol_vault: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}
