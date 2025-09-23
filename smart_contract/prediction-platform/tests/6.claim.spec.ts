import * as anchor from "@coral-xyz/anchor";
import { web3, Program } from "@coral-xyz/anchor";
import { BettingProgram } from "../target/types/betting_program";
import { expect } from "chai";

describe("Claim", () => {
  let program: Program<BettingProgram>;
  let provider: anchor.AnchorProvider;
  let winnerUser: web3.Keypair;
  let loserUser: web3.Keypair;
  let creator: web3.Keypair;
  let referee: web3.Keypair;
  let mainStatePDA: web3.PublicKey;
  let poolStatePDA: web3.PublicKey;
  let winnerEntryStatePDA: web3.PublicKey;
  let loserEntryStatePDA: web3.PublicKey;
  let solVaultPDA: web3.PublicKey;
  let betId: number;

  before(async () => {
    provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    program = anchor.workspace.BettingProgram as Program<BettingProgram>;

    winnerUser = web3.Keypair.generate();
    loserUser = web3.Keypair.generate();
    creator = web3.Keypair.generate();
    referee = web3.Keypair.generate();

    // Get the main state PDA
    [mainStatePDA] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("main")],
      program.programId
    );

    // Get sol vault PDA
    [solVaultPDA] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("sol-vault")],
      program.programId
    );

    // Fund accounts
    await provider.connection.requestAirdrop(
      winnerUser.publicKey,
      5 * web3.LAMPORTS_PER_SOL
    );
    await provider.connection.requestAirdrop(
      loserUser.publicKey,
      5 * web3.LAMPORTS_PER_SOL
    );
    await provider.connection.requestAirdrop(
      creator.publicKey,
      2 * web3.LAMPORTS_PER_SOL
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

    // Create a betting pool with FUTURE end timestamp (so we can create entries)
    const mainState = await program.account.mainState.fetch(mainStatePDA);
    betId = mainState.currentBetId.toNumber();

    [poolStatePDA] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), new anchor.BN(betId).toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const futureEndTimestamp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

    await program.methods
      .createPool({
        endTimestamp: new anchor.BN(futureEndTimestamp),
        referee: referee.publicKey,
        title: "Test Pool",
        description: "This is a test betting pool",
      })
      .accounts({
        creator: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    // Create entries for both users (while pool is still active)
    await program.methods
      .createEntry({
        betId: new anchor.BN(betId),
      })
      .accounts({
        user: winnerUser.publicKey,
      })
      .signers([winnerUser])
      .rpc();

    await program.methods
      .createEntry({
        betId: new anchor.BN(betId),
      })
      .accounts({
        user: loserUser.publicKey,
      })
      .signers([loserUser])
      .rpc();

    // Get entry state PDAs
    [winnerEntryStatePDA] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("entry"),
        poolStatePDA.toBuffer(),
        winnerUser.publicKey.toBuffer(),
      ],
      program.programId
    );

    [loserEntryStatePDA] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("entry"),
        poolStatePDA.toBuffer(),
        loserUser.publicKey.toBuffer(),
      ],
      program.programId
    );

    // Both users make deposits (winner on YES, loser on NO)
    const winnerDeposit = 3000000; // 0.003 SOL
    const loserDeposit = 2000000; // 0.002 SOL

    await program.methods
      .deposit({
        betId: new anchor.BN(betId),
        isYes: true,
        amount: new anchor.BN(winnerDeposit),
      })
      .accounts({
        user: winnerUser.publicKey,
      })
      .signers([winnerUser])
      .rpc();

    await program.methods
      .deposit({
        betId: new anchor.BN(betId),
        isYes: false,
        amount: new anchor.BN(loserDeposit),
      })
      .accounts({
        user: loserUser.publicKey,
      })
      .signers([loserUser])
      .rpc();

    // Update pool to have past end timestamp so we can set winner
    const pastEndTimestamp = Math.floor(Date.now() / 1000) - 1800; // 30 minutes ago
    await program.methods
      .updatePool({
        betId: new anchor.BN(betId),
        endTimestamp: new anchor.BN(pastEndTimestamp),
        referee: null,
        title: null,
        description: null,
      })
      .accounts({
        updater: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    // Set winner to YES (so winnerUser wins)
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

  it("should allow winner to claim rewards successfully", async () => {
    const winnerBalanceBefore = await provider.connection.getBalance(
      winnerUser.publicKey
    );
    const vaultBalanceBefore = await provider.connection.getBalance(
      solVaultPDA
    );
    const entryStateBefore = await program.account.entryState.fetch(
      winnerEntryStatePDA
    );
    const poolStateBefore = await program.account.poolState.fetch(poolStatePDA);

    const tx = await program.methods
      .claim({
        betId: new anchor.BN(betId),
      })
      .accounts({
        user: winnerUser.publicKey,
      })
      .signers([winnerUser])
      .rpc();

    // Verify the claim was processed
    const entryStateAfter = await program.account.entryState.fetch(
      winnerEntryStatePDA
    );
    expect(entryStateAfter.isClaimed).to.be.true;

    // Winner should receive their deposit + share of loser's deposit (minus creator fee)
    const winnerBalanceAfter = await provider.connection.getBalance(
      winnerUser.publicKey
    );
    const vaultBalanceAfter = await provider.connection.getBalance(solVaultPDA);

    expect(winnerBalanceAfter).to.be.greaterThan(winnerBalanceBefore);
    expect(vaultBalanceAfter).to.be.lessThan(vaultBalanceBefore);

    // Calculate expected payout (original deposit + winnings after creator fee deduction)
    const totalReserve =
      poolStateBefore.yesReserve.toNumber() +
      poolStateBefore.noReserve.toNumber();
    const mainStateForFee = await program.account.mainState.fetch(mainStatePDA);
    const creatorFeePercent = mainStateForFee.creatorFeePercent.toNumber();
    const platformFeePercent =
      (mainStateForFee as any).platformFeePercent?.toNumber?.() ?? 100; // default 1% if missing
    const winningPrincipal = poolStateBefore.yesReserve.toNumber();
    const creatorFee = Math.floor((totalReserve * creatorFeePercent) / 10000);
    const platformFee = Math.floor((totalReserve * platformFeePercent) / 10000);
    const availableWinnings =
      totalReserve - winningPrincipal - creatorFee - platformFee;
    const expectedPayout =
      entryStateBefore.depositedSolAmount.toNumber() + availableWinnings;

    // The claimed amount should be approximately the expected payout
    expect(winnerBalanceAfter - winnerBalanceBefore).to.be.approximately(
      expectedPayout,
      150000 // Account for transaction fees and rounding
    );
  });

  it("should fail when loser tries to claim", async () => {
    try {
      await program.methods
        .claim({
          betId: new anchor.BN(betId),
        })
        .accounts({
          user: loserUser.publicKey,
        })
        .signers([loserUser])
        .rpc();

      expect.fail("Should have failed because user is on losing side");
    } catch (error: any) {
      expect(error.error.errorCode.code).to.include("WrongBet");
    }
  });

  it("should fail when user tries to claim twice", async () => {
    try {
      await program.methods
        .claim({
          betId: new anchor.BN(betId),
        })
        .accounts({
          user: winnerUser.publicKey,
        })
        .signers([winnerUser])
        .rpc();

      expect.fail("Should have failed because already claimed");
    } catch (error: any) {
      expect(error.error.errorCode.code).to.include("AlreadyClaimed");
    }
  });

  it("should fail when trying to claim from incomplete bet", async () => {
    // Create a new pool that's ended but not completed (no winner set)
    const mainState = await program.account.mainState.fetch(mainStatePDA);
    const newBetId = mainState.currentBetId.toNumber();

    const futureEndTimestamp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

    await program.methods
      .createPool({
        endTimestamp: new anchor.BN(futureEndTimestamp),
        referee: referee.publicKey,
        title: "Test Pool",
        description: "This is a test betting pool",
      })
      .accounts({
        creator: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    // Create entry and deposit while pool is still active
    await program.methods
      .createEntry({
        betId: new anchor.BN(newBetId),
      })
      .accounts({
        user: winnerUser.publicKey,
      })
      .signers([winnerUser])
      .rpc();

    await program.methods
      .deposit({
        betId: new anchor.BN(newBetId),
        isYes: true,
        amount: new anchor.BN(2000000),
      })
      .accounts({
        user: winnerUser.publicKey,
      })
      .signers([winnerUser])
      .rpc();

    // Now update the pool to have ended but no winner set
    const pastEndTimestamp = Math.floor(Date.now() / 1000) - 900; // 15 minutes ago
    await program.methods
      .updatePool({
        betId: new anchor.BN(newBetId),
        endTimestamp: new anchor.BN(pastEndTimestamp),
        referee: null,
        title: null,
        description: null,
      })
      .accounts({
        updater: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    try {
      await program.methods
        .claim({
          betId: new anchor.BN(newBetId),
        })
        .accounts({
          user: winnerUser.publicKey,
        })
        .signers([winnerUser])
        .rpc();

      expect.fail("Should have failed because bet is not complete");
    } catch (error: any) {
      expect(error.error.errorCode.code).to.include("BetNotComplete");
    }
  });

  it("should fail when trying to claim from active bet", async () => {
    // Create a new pool that hasn't ended yet
    const mainState = await program.account.mainState.fetch(mainStatePDA);
    const newBetId = mainState.currentBetId.toNumber();

    const futureEndTimestamp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

    await program.methods
      .createPool({
        endTimestamp: new anchor.BN(futureEndTimestamp),
        referee: referee.publicKey,
        title: "Test Pool",
        description: "This is a test betting pool",
      })
      .accounts({
        creator: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    // Create entry and deposit
    await program.methods
      .createEntry({
        betId: new anchor.BN(newBetId),
      })
      .accounts({
        user: winnerUser.publicKey,
      })
      .signers([winnerUser])
      .rpc();

    await program.methods
      .deposit({
        betId: new anchor.BN(newBetId),
        isYes: true,
        amount: new anchor.BN(2000000),
      })
      .accounts({
        user: winnerUser.publicKey,
      })
      .signers([winnerUser])
      .rpc();

    try {
      await program.methods
        .claim({
          betId: new anchor.BN(newBetId),
        })
        .accounts({
          user: winnerUser.publicKey,
        })
        .signers([winnerUser])
        .rpc();

      expect.fail("Should have failed because bet has not ended");
    } catch (error: any) {
      expect(error.error.errorCode.code).to.include("BetNotEnded");
    }
  });

  it("should handle claiming with NO winner", async () => {
    // Create a new completed pool where NO wins
    const mainState = await program.account.mainState.fetch(mainStatePDA);
    const newBetId = mainState.currentBetId.toNumber();

    const [newPoolStatePDA] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool"),
        new anchor.BN(newBetId).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    const futureEndTimestamp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

    await program.methods
      .createPool({
        endTimestamp: new anchor.BN(futureEndTimestamp),
        referee: referee.publicKey,
        title: "Test Pool",
        description: "This is a test betting pool",
      })
      .accounts({
        creator: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    // Create new users for this test
    const noWinner = web3.Keypair.generate();
    const yesLoser = web3.Keypair.generate();

    await provider.connection.requestAirdrop(
      noWinner.publicKey,
      3 * web3.LAMPORTS_PER_SOL
    );
    await provider.connection.requestAirdrop(
      yesLoser.publicKey,
      3 * web3.LAMPORTS_PER_SOL
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Create entries and deposits while pool is active
    await program.methods
      .createEntry({
        betId: new anchor.BN(newBetId),
      })
      .accounts({
        user: noWinner.publicKey,
      })
      .signers([noWinner])
      .rpc();

    await program.methods
      .createEntry({
        betId: new anchor.BN(newBetId),
      })
      .accounts({
        user: yesLoser.publicKey,
      })
      .signers([yesLoser])
      .rpc();

    await program.methods
      .deposit({
        betId: new anchor.BN(newBetId),
        isYes: false, // NO bet
        amount: new anchor.BN(2500000),
      })
      .accounts({
        user: noWinner.publicKey,
      })
      .signers([noWinner])
      .rpc();

    await program.methods
      .deposit({
        betId: new anchor.BN(newBetId),
        isYes: true, // YES bet
        amount: new anchor.BN(1500000),
      })
      .accounts({
        user: yesLoser.publicKey,
      })
      .signers([yesLoser])
      .rpc();

    // Now update the pool to have ended
    const pastEndTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
    await program.methods
      .updatePool({
        betId: new anchor.BN(newBetId),
        endTimestamp: new anchor.BN(pastEndTimestamp),
        referee: null,
        title: null,
        description: null,
      })
      .accounts({
        updater: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    // Set winner to NO
    await program.methods
      .setWinner({
        betId: new anchor.BN(newBetId),
        isYes: false,
      })
      .accounts({
        referee: referee.publicKey,
        solVault: solVaultPDA,
        platformOwner: (provider.wallet as any).publicKey,
      } as any)
      .signers([referee])
      .rpc();

    // NO winner should be able to claim (with reduced amount due to creator fee)
    const balanceBefore = await provider.connection.getBalance(
      noWinner.publicKey
    );
    const poolStateBefore = await program.account.poolState.fetch(
      newPoolStatePDA
    );

    await program.methods
      .claim({
        betId: new anchor.BN(newBetId),
      })
      .accounts({
        user: noWinner.publicKey,
      })
      .signers([noWinner])
      .rpc();

    const balanceAfter = await provider.connection.getBalance(
      noWinner.publicKey
    );
    expect(balanceAfter).to.be.greaterThan(balanceBefore);

    // Verify the winner gets their deposit plus winnings after creator fee
    const totalReserve2 =
      poolStateBefore.yesReserve.toNumber() +
      poolStateBefore.noReserve.toNumber();
    const mainStateForFee = await program.account.mainState.fetch(mainStatePDA);
    const creatorFeePercent2 = mainStateForFee.creatorFeePercent.toNumber();
    const platformFeePercent2 =
      (mainStateForFee as any).platformFeePercent?.toNumber?.() ?? 100;
    const winningPrincipal2 = poolStateBefore.noReserve.toNumber();
    const creatorFee2 = Math.floor(
      (totalReserve2 * creatorFeePercent2) / 10000
    );
    const platformFee2 = Math.floor(
      (totalReserve2 * platformFeePercent2) / 10000
    );
    const availableWinnings =
      totalReserve2 - winningPrincipal2 - creatorFee2 - platformFee2;
    const expectedPayout = 2500000 + availableWinnings; // Original NO deposit + available winnings

    expect(balanceAfter - balanceBefore).to.be.approximately(
      expectedPayout,
      150000 // Account for transaction fees
    );

    // YES loser should not be able to claim
    try {
      await program.methods
        .claim({
          betId: new anchor.BN(newBetId),
        })
        .accounts({
          user: yesLoser.publicKey,
        })
        .signers([yesLoser])
        .rpc();

      expect.fail("YES loser should not be able to claim");
    } catch (error: any) {
      expect(error.error.errorCode.code).to.include("WrongBet");
    }
  });

  it("should fail with invalid bet ID", async () => {
    const invalidBetId = 9999;

    try {
      await program.methods
        .claim({
          betId: new anchor.BN(invalidBetId),
        })
        .accounts({
          user: winnerUser.publicKey,
        })
        .signers([winnerUser])
        .rpc();

      expect.fail("Should have failed with invalid bet ID");
    } catch (error) {
      // Expected to fail due to account validation
      expect(error).to.exist;
    }
  });

  it("should distribute profit pro-rata by token weight with multiple winners", async () => {
    // Create a fresh pool to simulate early vs late YES depositors plus a NO loser
    const mainState = await program.account.mainState.fetch(mainStatePDA);
    const multiBetId = mainState.currentBetId.toNumber();

    const [multiPoolPDA] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool"),
        new anchor.BN(multiBetId).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    const futureEndTimestamp = Math.floor(Date.now() / 1000) + 1800; // 30 min from now
    await program.methods
      .createPool({
        endTimestamp: new anchor.BN(futureEndTimestamp),
        referee: referee.publicKey,
        title: "Multi Winner Pool",
        description: "Profit split test",
      })
      .accounts({ creator: creator.publicKey })
      .signers([creator])
      .rpc();

    // Participants
    const earlyYes = web3.Keypair.generate();
    const lateYes = web3.Keypair.generate();
    const noLoser = web3.Keypair.generate();

    for (const kp of [earlyYes, lateYes, noLoser]) {
      await provider.connection.requestAirdrop(
        kp.publicKey,
        2 * web3.LAMPORTS_PER_SOL
      );
    }
    await new Promise((r) => setTimeout(r, 1000));

    // Create entries
    for (const [kp] of [[earlyYes], [lateYes], [noLoser]]) {
      await program.methods
        .createEntry({ betId: new anchor.BN(multiBetId) })
        .accounts({ user: kp.publicKey })
        .signers([kp])
        .rpc();
    }

    // Derive entry PDAs
    const [earlyYesEntryPDA] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("entry"),
        multiPoolPDA.toBuffer(),
        earlyYes.publicKey.toBuffer(),
      ],
      program.programId
    );
    const [lateYesEntryPDA] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("entry"),
        multiPoolPDA.toBuffer(),
        lateYes.publicKey.toBuffer(),
      ],
      program.programId
    );
    const [noLoserEntryPDA] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("entry"),
        multiPoolPDA.toBuffer(),
        noLoser.publicKey.toBuffer(),
      ],
      program.programId
    );

    // EARLY YES deposit (smaller pool -> cheaper tokens)
    const earlyYesDeposit = 2_000_000; // 0.002 SOL
    await program.methods
      .deposit({
        betId: new anchor.BN(multiBetId),
        isYes: true,
        amount: new anchor.BN(earlyYesDeposit),
      })
      .accounts({ user: earlyYes.publicKey })
      .signers([earlyYes])
      .rpc();

    // NO loser deposit
    const noLoserDeposit = 3_000_000; // 0.003 SOL
    await program.methods
      .deposit({
        betId: new anchor.BN(multiBetId),
        isYes: false,
        amount: new anchor.BN(noLoserDeposit),
      })
      .accounts({ user: noLoser.publicKey })
      .signers([noLoser])
      .rpc();

    // LATE YES deposit (after liquidity increased -> more expensive tokens)
    const lateYesDeposit = 4_000_000; // 0.004 SOL
    await program.methods
      .deposit({
        betId: new anchor.BN(multiBetId),
        isYes: true,
        amount: new anchor.BN(lateYesDeposit),
      })
      .accounts({ user: lateYes.publicKey })
      .signers([lateYes])
      .rpc();

    // End pool
    const pastEndTimestamp = Math.floor(Date.now() / 1000) - 60;
    await program.methods
      .updatePool({
        betId: new anchor.BN(multiBetId),
        endTimestamp: new anchor.BN(pastEndTimestamp),
        referee: null,
        title: null,
        description: null,
      })
      .accounts({ updater: creator.publicKey })
      .signers([creator])
      .rpc();

    // Set winner = YES
    await program.methods
      .setWinner({ betId: new anchor.BN(multiBetId), isYes: true })
      .accounts({
        referee: referee.publicKey,
        solVault: solVaultPDA,
        platformOwner: (provider.wallet as any).publicKey,
      } as any)
      .signers([referee])
      .rpc();

    const poolState = await program.account.poolState.fetch(multiPoolPDA);
    const mainStateForFee = await program.account.mainState.fetch(mainStatePDA);
    const creatorBps = mainStateForFee.creatorFeePercent.toNumber();
    const platformBps =
      (mainStateForFee as any).platformFeePercent?.toNumber?.() ?? 100;

    const yesSupply = poolState.yesSupply.toNumber();
    const yesReserve = poolState.yesReserve.toNumber();
    const noReserve = poolState.noReserve.toNumber(); // losing reserve

    const creatorFee = Math.floor((noReserve * creatorBps) / 10000);
    const platformFee = Math.floor((noReserve * platformBps) / 10000);
    const postFeeLosing = Math.max(noReserve - creatorFee - platformFee, 0);

    const earlyEntry = await program.account.entryState.fetch(earlyYesEntryPDA);
    const lateEntry = await program.account.entryState.fetch(lateYesEntryPDA);
    const earlyTokens = earlyEntry.tokenBalance.toNumber();
    const lateTokens = lateEntry.tokenBalance.toNumber();

    // Sanity: both winners present
    expect(earlyTokens).to.be.greaterThan(0);
    expect(lateTokens).to.be.greaterThan(0);
    expect(yesSupply).to.equal(earlyTokens + lateTokens);

    const expectedEarlyProfit = Math.floor(
      (earlyTokens * postFeeLosing) / yesSupply
    );
    const expectedLateProfit = Math.floor(
      (lateTokens * postFeeLosing) / yesSupply
    );

    // Invariants:
    // 1. Profit per TOKEN should be (almost) identical (floored division can cause at most 1 lamport diff across winners)
    const profitPerTokenEarly = expectedEarlyProfit / earlyTokens;
    const profitPerTokenLate = expectedLateProfit / lateTokens;
    expect(Math.abs(profitPerTokenEarly - profitPerTokenLate)).to.be.lessThan(
      1
    );

    // 2. Sum of individual profits must be <= postFeeLosing with small dust (< number_of_winners lamports)
    const totalDistributed = expectedEarlyProfit + expectedLateProfit;
    expect(totalDistributed).to.be.at.most(postFeeLosing);
    const dust = postFeeLosing - totalDistributed;
    expect(dust).to.be.lessThan(2); // with 2 winners, dust < 2 lamports

    // (Informational only) Tokens per lamport can move either way due to intervening opposite-side deposits; no assertion.

    // Claim early winner
    const earlyBalBefore = await provider.connection.getBalance(
      earlyYes.publicKey
    );
    await program.methods
      .claim({ betId: new anchor.BN(multiBetId) })
      .accounts({ user: earlyYes.publicKey })
      .signers([earlyYes])
      .rpc();
    const earlyBalAfter = await provider.connection.getBalance(
      earlyYes.publicKey
    );
    const earlyDelta = earlyBalAfter - earlyBalBefore;
    const expectedEarlyTotal = earlyYesDeposit + expectedEarlyProfit;
    expect(earlyDelta).to.be.approximately(expectedEarlyTotal, 200000); // allow fee margin

    // Claim late winner
    const lateBalBefore = await provider.connection.getBalance(
      lateYes.publicKey
    );
    await program.methods
      .claim({ betId: new anchor.BN(multiBetId) })
      .accounts({ user: lateYes.publicKey })
      .signers([lateYes])
      .rpc();
    const lateBalAfter = await provider.connection.getBalance(
      lateYes.publicKey
    );
    const lateDelta = lateBalAfter - lateBalBefore;
    const expectedLateTotal = lateYesDeposit + expectedLateProfit;
    expect(lateDelta).to.be.approximately(expectedLateTotal, 200000);

    // Loser should fail to claim
    try {
      await program.methods
        .claim({ betId: new anchor.BN(multiBetId) })
        .accounts({ user: noLoser.publicKey })
        .signers([noLoser])
        .rpc();
      expect.fail("Loser should not be able to claim in multi-winner test");
    } catch (error: any) {
      expect(error.error.errorCode.code).to.include("WrongBet");
    }
  });
});
