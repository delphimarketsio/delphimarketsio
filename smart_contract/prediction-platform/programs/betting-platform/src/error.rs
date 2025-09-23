use anchor_lang::prelude::error_code;

#[error_code]
pub enum BettingError {
    #[msg("Is not initialized")]
    Uninitialized,

    #[msg("Is already initialized")]
    AlreadyInitialized,

    #[msg("Is unauthorized")]
    Unauthorized,

    #[msg("Bet has ended")]
    BetEnded,

    #[msg("Invalid bet")]
    InvalidBet,

    #[msg("Bet is complete")]
    BetComplete,

    #[msg("Bet has not ended")]
    BetNotEnded,

    #[msg("Already claimed")]
    AlreadyClaimed,

    #[msg("Bet has not completed")]
    BetNotComplete,

    #[msg("Wrong bet")]
    WrongBet,

    #[msg("Title is too long (max 100 characters)")]
    TitleTooLong,

    #[msg("Description is too long (max 500 characters)")]
    DescriptionTooLong,

    #[msg("Title cannot be empty")]
    TitleEmpty,

    #[msg("Description cannot be empty")]
    DescriptionEmpty,

    #[msg("Math overflow")]
    MathOverflow,
}
