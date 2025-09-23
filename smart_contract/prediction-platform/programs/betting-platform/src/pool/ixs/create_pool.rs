use crate::{error::BettingError, CreateEvent, MainState, PoolState, PoolHistoryState, ProbabilityPoint};
use anchor_lang::prelude::*;

#[derive(AnchorDeserialize, AnchorSerialize, Clone, Debug)]
pub struct CreatePoolInput {
    pub title: String,
    pub description: String,
    pub end_timestamp: i64,
    pub referee: Pubkey,
}

pub fn create_pool(ctx: Context<ACreatePool>, input: CreatePoolInput) -> Result<()> {
    let main_state = &mut ctx.accounts.main_state;
    require!(
        main_state.initialized.eq(&true),
        BettingError::Uninitialized
    );

    // Validate title and description lengths
    require!(
        input.title.len() <= 100,
        BettingError::TitleTooLong
    );
    require!(
        input.description.len() <= 500,
        BettingError::DescriptionTooLong
    );
    require!(
        !input.title.is_empty(),
        BettingError::TitleEmpty
    );
    require!(
        !input.description.is_empty(),
        BettingError::DescriptionEmpty
    );

    let pool_state = &mut ctx.accounts.pool_state;
    let creator = ctx.accounts.creator.to_account_info();

    // Generate a unique share UUID using bet_id, timestamp, and slot
    let clock = Clock::get()?;
    let share_uuid = format!(
        "{:x}-{:x}-{:x}", 
        main_state.current_bet_id,
        clock.unix_timestamp,
        clock.slot
    );

    pool_state.creator = creator.key();
    pool_state.bet_id = main_state.current_bet_id;
    pool_state.initial_price = main_state.initial_price;
    pool_state.scale_factor = main_state.scale_factor;

    pool_state.total_supply = 0;
    pool_state.total_reserve = 0;
    pool_state.yes_supply = 0;
    pool_state.yes_reserve = 0;
    pool_state.no_supply = 0;
    pool_state.no_reserve = 0;

    pool_state.title = input.title.clone();
    pool_state.description = input.description.clone();
    pool_state.share_uuid = share_uuid.clone();
    // Allow open-ended markets by setting a negative timestamp (e.g., -1)
    pool_state.end_timestamp = input.end_timestamp;
    // Record creation time from current block time
    pool_state.created_timestamp = clock.unix_timestamp;
    pool_state.referee = input.referee;

    pool_state.complete = false;
    pool_state.creator_fee_claimed = false;
    pool_state.platform_fee_claimed = false;

    // Initialize history with an initial point at creation time (all reserves 0)
    let history = &mut ctx.accounts.history_state;
    history.pool = pool_state.key();
    history.bet_id = pool_state.bet_id;
    history.points = Vec::new();
    history.points.push(ProbabilityPoint {
        timestamp: clock.unix_timestamp,
        yes_reserve: 0,
        no_reserve: 0,
    });

    main_state.current_bet_id += 1;

    emit!(CreateEvent {
        creator: pool_state.creator,
        bet_id: pool_state.bet_id,
        title: input.title,
        description: input.description,
        end_timestamp: pool_state.end_timestamp,
        referee: pool_state.referee,
        share_uuid: share_uuid,
        timestamp: Clock::get()?.unix_timestamp
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(input: CreatePoolInput)]
pub struct ACreatePool<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [MainState::PREFIX_SEED],
        bump,
    )]
    pub main_state: Box<Account<'info, MainState>>,

    #[account(
        init,
        payer = creator,
        space = 8 + PoolState::MAX_SIZE,
        seeds =[
            PoolState::PREFIX_SEED,
            &main_state.current_bet_id.to_le_bytes(),
        ],
        bump
    )]
    pub pool_state: Box<Account<'info, PoolState>>,

    #[account(
        init,
        payer = creator,
        space = 8 + PoolHistoryState::MAX_SIZE,
        seeds = [PoolHistoryState::PREFIX_SEED, &main_state.current_bet_id.to_le_bytes()],
        bump
    )]
    pub history_state: Box<Account<'info, PoolHistoryState>>,

    pub system_program: Program<'info, System>,
}
