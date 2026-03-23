use anchor_lang::prelude::*;
use anchor_lang::system_program;
use pyth_sdk_solana::load_price_feed_from_account_info;

declare_id!("FVKpLYidJUzoNrniNNXaYHuPegBq4FefFhP4zJAGcbaX");

const MAX_QUESTION_LEN: usize = 80;
const MAX_LABEL_LEN: usize = 16;

#[program]
pub mod prediction_pool {
    use super::*;

    pub fn create_pool(
        ctx: Context<CreatePool>,
        pool_id: u64,
        question: String,
        label_a: String,
        label_b: String,
        entry_fee_lamports: u64,
        close_ts: i64,
        target_price: u64,
        is_oracle_enabled: bool,
    ) -> Result<()> {
        require!(question.len() <= MAX_QUESTION_LEN, ErrorCode::QuestionTooLong);
        require!(label_a.len() <= MAX_LABEL_LEN, ErrorCode::LabelTooLong);
        require!(label_b.len() <= MAX_LABEL_LEN, ErrorCode::LabelTooLong);
        require!(entry_fee_lamports > 0, ErrorCode::InvalidEntryFee);

        let now = Clock::get()?.unix_timestamp;
        require!(close_ts > now, ErrorCode::CloseTimeMustBeFuture);

        let pool = &mut ctx.accounts.pool;
        pool.creator = ctx.accounts.creator.key();
        pool.pool_id = pool_id;
        pool.question = question;
        pool.label_a = label_a;
        pool.label_b = label_b;
        pool.entry_fee_lamports = entry_fee_lamports;
        pool.close_ts = close_ts;
        pool.target_price = target_price;
        pool.is_oracle_enabled = is_oracle_enabled;
        pool.status = 0;
        pool.winning_option = 255;
        pool.total_a = 0;
        pool.total_b = 0;
        pool.bump = ctx.bumps.pool;
        pool.vault_bump = ctx.bumps.vault;
        Ok(())
    }

    pub fn join_pool(ctx: Context<JoinPool>, option: u8) -> Result<()> {
        require!(option <= 1, ErrorCode::InvalidOption);

        let pool = &ctx.accounts.pool;
        require!(pool.status == 0, ErrorCode::PoolNotOpen);

        let now = Clock::get()?.unix_timestamp;
        require!(now < pool.close_ts, ErrorCode::PoolClosed);

        let fee = pool.entry_fee_lamports;

        let cpi_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.user.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        );
        system_program::transfer(cpi_ctx, fee)?;

        let entry = &mut ctx.accounts.entry;
        entry.pool = ctx.accounts.pool.key();
        entry.user = ctx.accounts.user.key();
        entry.option = option;
        entry.amount = fee;
        entry.claimed = false;
        entry.bump = ctx.bumps.entry;

        let pool = &mut ctx.accounts.pool;
        if option == 0 {
            pool.total_a = pool.total_a.checked_add(fee).ok_or(ErrorCode::MathOverflow)?;
        } else {
            pool.total_b = pool.total_b.checked_add(fee).ok_or(ErrorCode::MathOverflow)?;
        }

        Ok(())
    }

    pub fn resolve_pool(ctx: Context<ResolvePool>, winning_option: u8) -> Result<()> {
        require!(winning_option <= 1, ErrorCode::InvalidOption);

        let pool = &mut ctx.accounts.pool;
        require!(pool.status == 0, ErrorCode::PoolNotOpen);

        let now = Clock::get()?.unix_timestamp;
        require!(now >= pool.close_ts, ErrorCode::TooEarlyToResolve);

        let win_total = if winning_option == 0 { pool.total_a } else { pool.total_b };
        require!(win_total > 0, ErrorCode::NoWinnersOnThatOption);

        pool.status = 1;
        pool.winning_option = winning_option;
        Ok(())
    }

    pub fn resolve_with_pyth(ctx: Context<ResolveWithPyth>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        require!(pool.is_oracle_enabled, ErrorCode::OracleNotEnabled);
        require!(pool.status == 0, ErrorCode::PoolNotOpen);

        let now = Clock::get()?.unix_timestamp;
        require!(now >= pool.close_ts, ErrorCode::TooEarlyToResolve);

        let price_account_info = &ctx.accounts.pyth_price_feed;
        let price_feed = load_price_feed_from_account_info(price_account_info).map_err(|_| ErrorCode::PythError)?;
        
        let current_price = price_feed.get_price_unchecked();
        
        // El precio se compara como u64 según esquema
        let final_price = current_price.price as u64; 
        
        if final_price >= pool.target_price {
            pool.winning_option = 0; // Ganó Opción A
        } else {
            pool.winning_option = 1; // Ganó Opción B
        }
        
        pool.status = 1;
        Ok(())
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let pool = &ctx.accounts.pool;
        require!(pool.status == 1, ErrorCode::PoolNotResolved);

        let entry = &ctx.accounts.entry;
        require!(!entry.claimed, ErrorCode::AlreadyClaimed);
        require!(entry.option == pool.winning_option, ErrorCode::NotAWinningEntry);

        let total = pool.total_a.checked_add(pool.total_b).ok_or(ErrorCode::MathOverflow)?;
        let win_total = if pool.winning_option == 0 { pool.total_a } else { pool.total_b };
        require!(win_total > 0, ErrorCode::NoWinnersOnThatOption);

        let payout = entry.amount
            .checked_mul(total).ok_or(ErrorCode::MathOverflow)?
            .checked_div(win_total).ok_or(ErrorCode::MathOverflow)?;

        ctx.accounts.entry.claimed = true;

        let pool_key = pool.key();
        let vault_bump = pool.vault_bump;
        let bump_arr = [vault_bump];
        let vault_seeds: &[&[u8]] = &[b"vault", pool_key.as_ref(), &bump_arr];
        let signer_seeds = &[vault_seeds];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.user.to_account_info(),
            },
            signer_seeds,
        );
        system_program::transfer(cpi_ctx, payout)?;

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct CreatePool<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + Pool::MAX_SIZE,
        seeds = [b"pool", creator.key().as_ref(), &pool_id.to_le_bytes()],
        bump
    )]
    pub pool: Account<'info, Pool>,

    /// CHECK: vault PDA escrow, se inicializa al primer depósito
    #[account(
        mut,
        seeds = [b"vault", pool.key().as_ref()],
        bump
    )]
    pub vault: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinPool<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut)]
    pub pool: Account<'info, Pool>,

    /// CHECK: vault PDA escrow
    #[account(
        mut,
        seeds = [b"vault", pool.key().as_ref()],
        bump = pool.vault_bump
    )]
    pub vault: UncheckedAccount<'info>,

    #[account(
        init,
        payer = user,
        space = 8 + Entry::MAX_SIZE,
        seeds = [b"entry", pool.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub entry: Account<'info, Entry>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResolvePool<'info> {
    pub creator: Signer<'info>,

    #[account(mut, has_one = creator)]
    pub pool: Account<'info, Pool>,
}

#[derive(Accounts)]
pub struct ResolveWithPyth<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut)]
    pub pool: Account<'info, Pool>,

    /// CHECK: Validado por Pyth SDK
    pub pyth_price_feed: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    pub pool: Account<'info, Pool>,

    /// CHECK: vault PDA escrow
    #[account(
        mut,
        seeds = [b"vault", pool.key().as_ref()],
        bump = pool.vault_bump
    )]
    pub vault: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"entry", pool.key().as_ref(), user.key().as_ref()],
        bump = entry.bump
    )]
    pub entry: Account<'info, Entry>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct Pool {
    pub creator: Pubkey,
    pub pool_id: u64,
    pub question: String,
    pub label_a: String,
    pub label_b: String,
    pub entry_fee_lamports: u64,
    pub close_ts: i64,
    pub status: u8,
    pub winning_option: u8,
    pub total_a: u64,
    pub total_b: u64,
    pub bump: u8,
    pub vault_bump: u8,
    pub target_price: u64,
    pub is_oracle_enabled: bool,
}

impl Pool {
    pub const MAX_SIZE: usize =
        32 + 8 +
        (4 + MAX_QUESTION_LEN) +
        (4 + MAX_LABEL_LEN) +
        (4 + MAX_LABEL_LEN) +
        8 + 8 + 1 + 1 + 8 + 8 + 1 + 1 +
        8 + 1;
}

#[account]
pub struct Entry {
    pub pool: Pubkey,
    pub user: Pubkey,
    pub option: u8,
    pub amount: u64,
    pub claimed: bool,
    pub bump: u8,
}

impl Entry {
    pub const MAX_SIZE: usize = 32 + 32 + 1 + 8 + 1 + 1;
}

#[error_code]
pub enum ErrorCode {
    #[msg("Question too long")]
    QuestionTooLong,
    #[msg("Label too long")]
    LabelTooLong,
    #[msg("Invalid entry fee")]
    InvalidEntryFee,
    #[msg("Close time must be in the future")]
    CloseTimeMustBeFuture,
    #[msg("Invalid option (must be 0 or 1)")]
    InvalidOption,
    #[msg("Pool is not open")]
    PoolNotOpen,
    #[msg("Pool is closed")]
    PoolClosed,
    #[msg("Too early to resolve")]
    TooEarlyToResolve,
    #[msg("Pool not resolved yet")]
    PoolNotResolved,
    #[msg("Entry already claimed")]
    AlreadyClaimed,
    #[msg("Not a winning entry")]
    NotAWinningEntry,
    #[msg("No bets on winning option")]
    NoWinnersOnThatOption,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Pyth error")]
    PythError,
    #[msg("Price is too old")]
    PriceTooOld,
    #[msg("Oracle is not enabled for this pool")]
    OracleNotEnabled,
}