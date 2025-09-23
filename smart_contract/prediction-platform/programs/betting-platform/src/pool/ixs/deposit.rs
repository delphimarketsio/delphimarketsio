use crate::constants::VAULT_SEED;
use crate::{error::BettingError, DepositEvent, EntryState, PoolState, PoolHistoryState, ProbabilityPoint};
use anchor_lang::prelude::*;

#[derive(AnchorDeserialize, AnchorSerialize, Clone, Copy, Debug)]
pub struct DepositInput {
    bet_id: u64,
    is_yes: bool,
    amount: u64,
}

pub fn deposit(ctx: Context<ADeposit>, input: DepositInput) -> Result<()> {
    let pool_state = &mut ctx.accounts.pool_state;
    let entry_state = &mut ctx.accounts.entry_state;
    let history_state = &mut ctx.accounts.history_state;
    let system_program = &ctx.accounts.system_program;

    // Disallow deposits once the market is completed
    require!(!pool_state.complete, BettingError::BetComplete);

    // For markets with a fixed end time (>= 0), disallow deposits after end.
    // Open-ended markets (negative end_timestamp) remain open for deposits until resolved.
    if pool_state.end_timestamp >= 0 {
        require!(
            pool_state.end_timestamp > Clock::get()?.unix_timestamp,
            BettingError::BetEnded
        );
    }

    // Minimum buy amount removed: allow any positive deposit amount.
    // Frontend should still nudge users to avoid dust values that may be uneconomical.
    require!(input.amount > 0, BettingError::InvalidBet);

    require!(
        entry_state.token_balance == 0 || entry_state.is_yes.eq(&input.is_yes),
        BettingError::InvalidBet
    );

    let user = &ctx.accounts.user.to_account_info();

    // Compute token amount and (optionally) prices using extracted helper.
    let (token_amount, _yes_price, _no_price) = calculate_token_amount_and_prices(
        input.amount,
        input.is_yes,
        pool_state.yes_reserve,
        pool_state.no_reserve,
    )?;

    pool_state.total_supply += token_amount;
    pool_state.total_reserve += input.amount;
    if input.is_yes.eq(&true) {
        pool_state.yes_supply += token_amount;
        pool_state.yes_reserve += input.amount;
    } else {
        pool_state.no_supply += token_amount;
        pool_state.no_reserve += input.amount;
    }

    entry_state.deposited_sol_amount += input.amount;
    entry_state.token_balance += token_amount;
    entry_state.is_yes = input.is_yes;

    // Transfer SOL from the user to the pool PDA
    anchor_lang::system_program::transfer(
        CpiContext::new(
            system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: user.clone(),
                to: ctx.accounts.sol_vault.to_account_info(),
            },
        ),
        input.amount,
    )?;

        emit!(DepositEvent {
            user: *ctx.accounts.user.key,
            bet_id: pool_state.bet_id,
            sol_amount: input.amount,
            token_amount,
            is_yes: input.is_yes,
            timestamp: Clock::get()?.unix_timestamp
        });

    let now = Clock::get()?.unix_timestamp;
    // Ensure history_state is initialized (in case of legacy pools)
    if history_state.bet_id == 0 {
        history_state.bet_id = pool_state.bet_id;
        history_state.pool = pool_state.key();
        if history_state.points.is_empty() {
            history_state.points.push(ProbabilityPoint {
                timestamp: now,
                yes_reserve: 0,
                no_reserve: 0,
            });
        }
    }

    // Append probability snapshot after deposit
    let point = ProbabilityPoint {
        timestamp: now,
        yes_reserve: pool_state.yes_reserve,
        no_reserve: pool_state.no_reserve,
    };
    history_state.points.push(point);
    // Cap number of points to avoid unbounded growth
    if history_state.points.len() > PoolHistoryState::MAX_POINTS {
        // Remove oldest
        let overflow = history_state.points.len() - PoolHistoryState::MAX_POINTS;
        history_state.points.drain(0..overflow);
    }

    Ok(())
}

// ---------------------------------------------------------------------
// Pricing Helper
// ---------------------------------------------------------------------
// Encapsulates the ratio-based pricing with virtual reserves to keep the main
// instruction logic focused. Returning prices as well can enable future event
// emission or analytics without recalculating.
// ---------------------------------------------------------------------
fn calculate_token_amount_and_prices(
    deposit_amount: u64,
    is_yes: bool,
    yes_reserve: u64,
    no_reserve: u64,
) -> Result<(u64, u128, u128)> {
    // Virtual reserve (1 SOL) to stabilize early odds & avoid div-by-zero
    const VIRTUAL_AMOUNT: u64 = 1_000_000_000; // lamports
    const SCALE: u128 = 1_000_000_000u128; // probability precision (1e9)

    let virtual_yes: u128 = (yes_reserve as u128) + (VIRTUAL_AMOUNT as u128);
    let virtual_no: u128 = (no_reserve as u128) + (VIRTUAL_AMOUNT as u128);
    let denom: u128 = virtual_yes + virtual_no; // guaranteed > 0

    let yes_price: u128 = virtual_yes * SCALE / denom; // scaled price
    let no_price: u128 = virtual_no * SCALE / denom;

    let selected_price = if is_yes { yes_price } else { no_price };

    // token_amount = deposit * SCALE / selected_price
    let token_amount: u64 = ((deposit_amount as u128) * SCALE / selected_price)
        .try_into()
        .map_err(|_| error!(BettingError::MathOverflow))?;

    Ok((token_amount, yes_price, no_price))
}

#[derive(Accounts)]
#[instruction(input: DepositInput)]
pub struct ADeposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

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
        init_if_needed,
        payer = user,
        space = 8 + PoolHistoryState::MAX_SIZE,
        seeds = [PoolHistoryState::PREFIX_SEED, &input.bet_id.to_le_bytes()],
        bump
    )]
    pub history_state: Box<Account<'info, PoolHistoryState>>,

    #[account(
        mut,
        seeds = [VAULT_SEED.as_bytes()],
        bump
    )]
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub sol_vault: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}
