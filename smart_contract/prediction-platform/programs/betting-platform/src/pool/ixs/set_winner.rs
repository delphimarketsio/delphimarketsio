use crate::{constants::VAULT_SEED, error::BettingError, CompleteEvent, MainState, PoolState};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_instruction;

#[derive(AnchorDeserialize, AnchorSerialize, Clone, Copy, Debug)]
pub struct SetWinnerInput {
    bet_id: u64,
    is_yes: bool,
}

pub fn set_winner(ctx: Context<ASetWinner>, input: SetWinnerInput) -> Result<()> {
    let main_state = &mut ctx.accounts.main_state;
    let pool_state = &mut ctx.accounts.pool_state;

    require!(pool_state.complete.eq(&false), BettingError::BetComplete);
    require!(
        pool_state.referee.eq(ctx.accounts.referee.key)
            || main_state.owner.eq(ctx.accounts.referee.key),
        BettingError::Unauthorized
    );
    // If the market has a fixed end time (>= 0), ensure it has ended before resolving.
    // A negative end_timestamp (e.g. -1) denotes an open-ended market that can be
    // resolved by the referee at any arbitrary moment.
    if pool_state.end_timestamp >= 0 {
        require!(
            pool_state.end_timestamp < Clock::get()?.unix_timestamp,
            BettingError::BetNotEnded
        );
    }

    let referee = ctx.accounts.referee.to_account_info();

    pool_state.complete = true;
    pool_state.winner = if input.is_yes {
        "yes".to_string()
    } else {
        "no".to_string()
    };

    // Auto-claim platform fee at resolution time based on total reserves to keep fee impact
    // symmetric across both sides. (Both sides effectively contribute proportionally.)
    let total_reserve = (pool_state.yes_reserve as u128)
        .saturating_add(pool_state.no_reserve as u128);
    let platform_fee = total_reserve
        .saturating_mul(main_state.platform_fee_percent as u128)
        / 10000u128;
    let platform_fee: u64 = platform_fee.min(u64::MAX as u128) as u64; // saturate to u64

    if platform_fee > 0 {
        let transfer_instruction = system_instruction::transfer(
            &ctx.accounts.sol_vault.to_account_info().key(),
            &main_state.owner,
            platform_fee,
        );

        anchor_lang::solana_program::program::invoke_signed(
            &transfer_instruction,
            &[
                ctx.accounts.sol_vault.to_account_info(),
                ctx.accounts.platform_owner.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[&[VAULT_SEED.as_bytes(), &[ctx.bumps.sol_vault]]],
        )?;
    }

    // Mark platform fee claimed
    pool_state.platform_fee_claimed = true;

    emit!(CompleteEvent {
        referee: referee.key(),
        bet_id: input.bet_id,
        winner: pool_state.winner.clone(),
        timestamp: Clock::get()?.unix_timestamp
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(input: SetWinnerInput)]
pub struct ASetWinner<'info> {
    #[account(mut)]
    pub referee: Signer<'info>,

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
        bump,
    )]
    pub pool_state: Box<Account<'info, PoolState>>,

    #[account(
        mut,
        seeds = [VAULT_SEED.as_bytes()],
        bump
    )]
    /// CHECK: PDA vault only signs to transfer lamports
    pub sol_vault: AccountInfo<'info>,

    #[account(mut, address = main_state.owner)]
    pub platform_owner: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}
