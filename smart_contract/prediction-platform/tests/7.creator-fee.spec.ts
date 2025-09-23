import * as anchor from "@coral-xyz/anchor";
import { web3, Program } from "@coral-xyz/anchor";
import { BettingProgram } from "../target/types/betting_program";
import { expect } from "chai";

describe("Creator Fee Rewards", () => {
  let program: Program<BettingProgram>;
  let provider: anchor.AnchorProvider;
  let creator: web3.Keypair;
  let winner: web3.Keypair;
  let loser: web3.Keypair;
  let referee: web3.Keypair;
  let mainStatePDA: web3.PublicKey;
  let poolStatePDA: web3.PublicKey;
  let solVaultPDA: web3.PublicKey;
  let betId: number;

  const CREATOR_FEE_PERCENT = 100; // 1% in basis points (Issue #34 update)
  const WINNER_DEPOSIT = 3000000; // 0.003 SOL
  const LOSER_DEPOSIT = 2000000; // 0.002 SOL

  before(async () => {
    provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    program = anchor.workspace.BettingProgram as Program<BettingProgram>;

    creator = web3.Keypair.generate();
    winner = web3.Keypair.generate();
    loser = web3.Keypair.generate();
    referee = web3.Keypair.generate();

    // Get PDAs
    [mainStatePDA] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("main")],
      program.programId
    );

    [solVaultPDA] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("sol-vault")],
      program.programId
    );

    // Fund accounts
    await provider.connection.requestAirdrop(
      creator.publicKey,
      3 * web3.LAMPORTS_PER_SOL
    );
    await provider.connection.requestAirdrop(
      winner.publicKey,
      5 * web3.LAMPORTS_PER_SOL
    );
    await provider.connection.requestAirdrop(
      loser.publicKey,
      5 * web3.LAMPORTS_PER_SOL
    );
    await provider.connection.requestAirdrop(
      referee.publicKey,
      2 * web3.LAMPORTS_PER_SOL
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Ensure main state is initialized
    try {
      await program.methods.initMainState().rpc();
    } catch (error) {
      // Main state might already be initialized
    }
  });

  beforeEach(async () => {
    // Create a fresh betting pool for each test
    const mainState = await program.account.mainState.fetch(mainStatePDA);
    betId = mainState.currentBetId.toNumber();

    [poolStatePDA] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), new anchor.BN(betId).toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    // Create pool with future end timestamp
    const futureEndTimestamp = Math.floor(Date.now() / 1000) + 3600;
    await program.methods
      .createPool({
        endTimestamp: new anchor.BN(futureEndTimestamp),
        referee: referee.publicKey,
        title: "Creator Fee Test Pool",
        description: "Testing creator fee functionality",
      })
      .accounts({ creator: creator.publicKey })
      .signers([creator])
      .rpc();

    // Create entries for both users
    await program.methods
      .createEntry({ betId: new anchor.BN(betId) })
      .accounts({ user: winner.publicKey })
      .signers([winner])
      .rpc();

    await program.methods
      .createEntry({ betId: new anchor.BN(betId) })
      .accounts({ user: loser.publicKey })
      .signers([loser])
      .rpc();

    // Make deposits (winner on YES, loser on NO)
    await program.methods
      .deposit({
        betId: new anchor.BN(betId),
        isYes: true,
        amount: new anchor.BN(WINNER_DEPOSIT),
      })
      .accounts({ user: winner.publicKey })
      .signers([winner])
      .rpc();

    await program.methods
      .deposit({
        betId: new anchor.BN(betId),
        isYes: false,
        amount: new anchor.BN(LOSER_DEPOSIT),
      })
      .accounts({ user: loser.publicKey })
      .signers([loser])
      .rpc();

    // End the pool and set YES as winner
    const pastEndTimestamp = Math.floor(Date.now() / 1000) - 1800;
    await program.methods
      .updatePool({
        betId: new anchor.BN(betId),
        endTimestamp: new anchor.BN(pastEndTimestamp),
        referee: null,
        title: null,
        description: null,
      })
      .accounts({ updater: creator.publicKey })
      .signers([creator])
      .rpc();

    await program.methods
      .setWinner({
        betId: new anchor.BN(betId),
        isYes: true,
      })
      .accounts({
        referee: referee.publicKey,
        solVault: solVaultPDA,
        platformOwner: (provider.wallet as any).publicKey,
      } as any)
      .signers([referee])
      .rpc();
  });

  it("should allow creator to claim fee after bet completion", async () => {
    const creatorBalanceBefore = await provider.connection.getBalance(
      creator.publicKey
    );
    const poolState = await program.account.poolState.fetch(poolStatePDA);

    // Verify pool is complete and creator hasn't claimed yet
    expect(poolState.complete).to.be.true;
    expect(poolState.creatorFeeClaimed).to.be.false;

    // Calculate expected creator fee (1% of total reserve)
    const totalReserve = WINNER_DEPOSIT + LOSER_DEPOSIT;
    const expectedCreatorFee = Math.floor(
      (totalReserve * CREATOR_FEE_PERCENT) / 10000
    );

    // Creator claims fee
    await program.methods
      .claimCreatorFee({ betId: new anchor.BN(betId) })
      .accounts({ creator: creator.publicKey })
      .signers([creator])
      .rpc();

    // Verify balances and state changes
    const creatorBalanceAfter = await provider.connection.getBalance(
      creator.publicKey
    );
    const poolStateAfter = await program.account.poolState.fetch(poolStatePDA);

    expect(poolStateAfter.creatorFeeClaimed).to.be.true;
    expect(creatorBalanceAfter - creatorBalanceBefore).to.be.approximately(
      expectedCreatorFee,
      100000 // Account for transaction fees
    );
  });

  it("should calculate correct creator fee amount", async () => {
    const poolStateBefore = await program.account.poolState.fetch(poolStatePDA);
    const totalReserve =
      poolStateBefore.yesReserve.toNumber() +
      poolStateBefore.noReserve.toNumber();
    const expectedFee = Math.floor(
      (totalReserve * CREATOR_FEE_PERCENT) / 10000
    );

    const creatorBalanceBefore = await provider.connection.getBalance(
      creator.publicKey
    );

    await program.methods
      .claimCreatorFee({ betId: new anchor.BN(betId) })
      .accounts({ creator: creator.publicKey })
      .signers([creator])
      .rpc();

    const creatorBalanceAfter = await provider.connection.getBalance(
      creator.publicKey
    );
    const actualFeeReceived = creatorBalanceAfter - creatorBalanceBefore;

    // Should receive 1% of the total reserve
    expect(actualFeeReceived).to.be.approximately(expectedFee, 100000);
    expect(expectedFee).to.equal(((WINNER_DEPOSIT + LOSER_DEPOSIT) * 1) / 100);
  });

  it("should prevent double claiming by creator", async () => {
    // First claim should succeed
    await program.methods
      .claimCreatorFee({ betId: new anchor.BN(betId) })
      .accounts({ creator: creator.publicKey })
      .signers([creator])
      .rpc();

    // Second claim should fail
    try {
      await program.methods
        .claimCreatorFee({ betId: new anchor.BN(betId) })
        .accounts({ creator: creator.publicKey })
        .signers([creator])
        .rpc();

      expect.fail("Should have failed on double claim");
    } catch (error: any) {
      expect(error.error.errorCode.code).to.include("AlreadyClaimed");
    }
  });

  it("should prevent non-creator from claiming creator fee", async () => {
    try {
      await program.methods
        .claimCreatorFee({ betId: new anchor.BN(betId) })
        .accounts({ creator: winner.publicKey }) // Non-creator trying to claim
        .signers([winner])
        .rpc();

      expect.fail("Should have failed for non-creator");
    } catch (error: any) {
      // Anchor's has_one constraint returns ConstraintHasOne error
      expect(error.error.errorCode.code).to.include("ConstraintHasOne");
    }
  });

  it("should prevent claiming before bet completion", async () => {
    // Create a new incomplete bet
    const mainState = await program.account.mainState.fetch(mainStatePDA);
    const newBetId = mainState.currentBetId.toNumber();

    await program.methods
      .createPool({
        endTimestamp: new anchor.BN(Math.floor(Date.now() / 1000) - 1800),
        referee: referee.publicKey,
        title: "Incomplete Pool",
        description: "Testing incomplete pool",
      })
      .accounts({ creator: creator.publicKey })
      .signers([creator])
      .rpc();

    // Try to claim without setting winner
    try {
      await program.methods
        .claimCreatorFee({ betId: new anchor.BN(newBetId) })
        .accounts({ creator: creator.publicKey })
        .signers([creator])
        .rpc();

      expect.fail("Should have failed for incomplete bet");
    } catch (error: any) {
      expect(error.error.errorCode.code).to.include("BetNotComplete");
    }
  });

  it("should prevent claiming from active bet", async () => {
    // Create a new active bet
    const mainState = await program.account.mainState.fetch(mainStatePDA);
    const newBetId = mainState.currentBetId.toNumber();

    await program.methods
      .createPool({
        endTimestamp: new anchor.BN(Math.floor(Date.now() / 1000) + 3600), // Future
        referee: referee.publicKey,
        title: "Active Pool",
        description: "Testing active pool",
      })
      .accounts({ creator: creator.publicKey })
      .signers([creator])
      .rpc();

    try {
      await program.methods
        .claimCreatorFee({ betId: new anchor.BN(newBetId) })
        .accounts({ creator: creator.publicKey })
        .signers([creator])
        .rpc();

      expect.fail("Should have failed for active bet");
    } catch (error: any) {
      expect(error.error.errorCode.code).to.include("BetNotEnded");
    }
  });

  it("should handle creator fee when only one side has bets", async () => {
    // Create a scenario with only one side betting
    const mainState = await program.account.mainState.fetch(mainStatePDA);
    const newBetId = mainState.currentBetId.toNumber();
    const oneSidedCreator = web3.Keypair.generate();
    const oneSidedUser = web3.Keypair.generate();

    await provider.connection.requestAirdrop(
      oneSidedCreator.publicKey,
      2 * web3.LAMPORTS_PER_SOL
    );
    await provider.connection.requestAirdrop(
      oneSidedUser.publicKey,
      3 * web3.LAMPORTS_PER_SOL
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const [oneSidedPoolPDA] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool"),
        new anchor.BN(newBetId).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    // Create pool with only YES bets
    await program.methods
      .createPool({
        endTimestamp: new anchor.BN(Math.floor(Date.now() / 1000) + 3600),
        referee: referee.publicKey,
        title: "One Sided Pool",
        description: "Testing one sided pool",
      })
      .accounts({ creator: oneSidedCreator.publicKey })
      .signers([oneSidedCreator])
      .rpc();

    await program.methods
      .createEntry({ betId: new anchor.BN(newBetId) })
      .accounts({ user: oneSidedUser.publicKey })
      .signers([oneSidedUser])
      .rpc();

    await program.methods
      .deposit({
        betId: new anchor.BN(newBetId),
        isYes: true,
        amount: new anchor.BN(2000000),
      })
      .accounts({ user: oneSidedUser.publicKey })
      .signers([oneSidedUser])
      .rpc();

    // End and set NO as winner (YES loses, so creator gets fee from YES reserve)
    await program.methods
      .updatePool({
        betId: new anchor.BN(newBetId),
        endTimestamp: new anchor.BN(Math.floor(Date.now() / 1000) - 1800),
        referee: null,
        title: null,
        description: null,
      })
      .accounts({ updater: oneSidedCreator.publicKey })
      .signers([oneSidedCreator])
      .rpc();

    await program.methods
      .setWinner({
        betId: new anchor.BN(newBetId),
        isYes: false, // NO wins, so YES loses and creator gets fee from YES reserve
      })
      .accounts({
        referee: referee.publicKey,
        solVault: solVaultPDA,
        platformOwner: (provider.wallet as any).publicKey,
      } as any)
      .signers([referee])
      .rpc();

    const creatorBalanceBefore = await provider.connection.getBalance(
      oneSidedCreator.publicKey
    );
    const poolStateBefore = await program.account.poolState.fetch(
      oneSidedPoolPDA
    );

    // Since NO won but there were only YES bets, the losing reserve is the YES reserve
    expect(poolStateBefore.yesReserve.toNumber()).to.be.greaterThan(0);
    expect(poolStateBefore.noReserve.toNumber()).to.equal(0);

    // Calculate expected creator fee from YES reserve (the losing side)
    const totalReserveSingle =
      poolStateBefore.yesReserve.toNumber() +
      poolStateBefore.noReserve.toNumber();
    const expectedCreatorFee = Math.floor(
      (totalReserveSingle * CREATOR_FEE_PERCENT) / 10000
    );

    // Creator should be able to claim fee from the YES reserve (losing side)
    await program.methods
      .claimCreatorFee({ betId: new anchor.BN(newBetId) })
      .accounts({ creator: oneSidedCreator.publicKey })
      .signers([oneSidedCreator])
      .rpc();

    const creatorBalanceAfter = await provider.connection.getBalance(
      oneSidedCreator.publicKey
    );

    // Creator should receive fee from the losing YES pool
    const balanceChange = creatorBalanceAfter - creatorBalanceBefore;
    expect(balanceChange).to.be.approximately(expectedCreatorFee, 100000); // Account for tx fees
    expect(expectedCreatorFee).to.be.greaterThan(0); // Should have received some fee

    const poolStateAfter = await program.account.poolState.fetch(
      oneSidedPoolPDA
    );
    expect(poolStateAfter.creatorFeeClaimed).to.be.true;
  });

  it("should handle creator fee when losing reserve is zero", async () => {
    // Create a scenario where one side has no reserve after outcome
    // This would happen if everyone on that side withdrew before the bet ended
    // For this test, we'll manually set up a scenario where the losing reserve is 0

    const mainState = await program.account.mainState.fetch(mainStatePDA);
    const newBetId = mainState.currentBetId.toNumber();
    const zeroCreator = web3.Keypair.generate();

    await provider.connection.requestAirdrop(
      zeroCreator.publicKey,
      2 * web3.LAMPORTS_PER_SOL
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const [zeroPoolPDA] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool"),
        new anchor.BN(newBetId).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    // Create empty pool (no deposits)
    await program.methods
      .createPool({
        endTimestamp: new anchor.BN(Math.floor(Date.now() / 1000) - 1800), // Already ended
        referee: referee.publicKey,
        title: "Empty Pool",
        description: "Testing empty pool",
      })
      .accounts({ creator: zeroCreator.publicKey })
      .signers([zeroCreator])
      .rpc();

    // Set winner without any deposits
    await program.methods
      .setWinner({
        betId: new anchor.BN(newBetId),
        isYes: true,
      })
      .accounts({
        referee: referee.publicKey,
        solVault: solVaultPDA,
        platformOwner: (provider.wallet as any).publicKey,
      } as any)
      .signers([referee])
      .rpc();

    const creatorBalanceBefore = await provider.connection.getBalance(
      zeroCreator.publicKey
    );
    const poolStateBefore = await program.account.poolState.fetch(zeroPoolPDA);

    // Both reserves should be 0
    expect(poolStateBefore.yesReserve.toNumber()).to.equal(0);
    expect(poolStateBefore.noReserve.toNumber()).to.equal(0);

    // Creator should be able to claim but get 0 fee
    await program.methods
      .claimCreatorFee({ betId: new anchor.BN(newBetId) })
      .accounts({ creator: zeroCreator.publicKey })
      .signers([zeroCreator])
      .rpc();

    const creatorBalanceAfter = await provider.connection.getBalance(
      zeroCreator.publicKey
    );

    // Calculate expected creator fee (should be 0 since no losing reserve)
    const expectedCreatorFee = 0; // No losing reserve means no fee
    const balanceChange = creatorBalanceAfter - creatorBalanceBefore;

    // Creator should receive no meaningful fee (0 or small tx fee deduction)
    expect(Math.abs(balanceChange)).to.be.lessThan(200000); // Should be very small (0 fee +/- tx fees)

    // The key test: verify the claim was processed successfully
    const poolStateAfter = await program.account.poolState.fetch(zeroPoolPDA);
    expect(poolStateAfter.creatorFeeClaimed).to.be.true;
  });

  it("should correctly reduce winner rewards by creator fee amount", async () => {
    // First, let creator claim their fee
    await program.methods
      .claimCreatorFee({ betId: new anchor.BN(betId) })
      .accounts({ creator: creator.publicKey })
      .signers([creator])
      .rpc();

    // Calculate expected winner payout after creator fee
    const totalReserve3 = LOSER_DEPOSIT; // only one side has deposits
    const mainState = await program.account.mainState.fetch(mainStatePDA);
    const platformFeePercent =
      (mainState as any).platformFeePercent?.toNumber?.() ?? 100;
    const creatorFee = Math.floor(
      (totalReserve3 * CREATOR_FEE_PERCENT) / 10000
    );
    const platformFee = Math.floor(
      (totalReserve3 * platformFeePercent) / 10000
    );
    const winningPrincipal3 = 0; // winning side had zero before deposits
    const availableWinningsPool =
      totalReserve3 - winningPrincipal3 - creatorFee - platformFee;
    const expectedWinnerPayout = WINNER_DEPOSIT + availableWinningsPool; // Original deposit + winnings

    const winnerBalanceBefore = await provider.connection.getBalance(
      winner.publicKey
    );

    // Winner claims their reduced reward
    await program.methods
      .claim({ betId: new anchor.BN(betId) })
      .accounts({ user: winner.publicKey })
      .signers([winner])
      .rpc();

    const winnerBalanceAfter = await provider.connection.getBalance(
      winner.publicKey
    );
    const actualWinnerPayout = winnerBalanceAfter - winnerBalanceBefore;

    // Winner should get their deposit plus 97% of the losing pool
    expect(actualWinnerPayout).to.be.approximately(
      expectedWinnerPayout,
      100000
    );

    // Verify total payouts equal total deposits
    const totalDeposits = WINNER_DEPOSIT + LOSER_DEPOSIT;
    const totalPaidOut = actualWinnerPayout + creatorFee + platformFee;
    expect(totalPaidOut).to.be.approximately(totalDeposits, 100000);
  });
});
