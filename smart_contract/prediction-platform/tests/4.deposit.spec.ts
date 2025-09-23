import * as anchor from "@coral-xyz/anchor";
import { web3, Program } from "@coral-xyz/anchor";
import { BettingProgram } from "../target/types/betting_program";
import { expect } from "chai";

describe("Deposit", () => {
  let program: Program<BettingProgram>;
  let provider: anchor.AnchorProvider;
  let user: web3.Keypair;
  let creator: web3.Keypair;
  let referee: web3.Keypair;
  let mainStatePDA: web3.PublicKey;
  let poolStatePDA: web3.PublicKey;
  let entryStatePDA: web3.PublicKey;
  let solVaultPDA: web3.PublicKey;
  let historyPDA: web3.PublicKey;
  let betId: number;

  before(async () => {
    provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    program = anchor.workspace.BettingProgram as Program<BettingProgram>;

    user = web3.Keypair.generate();
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
      user.publicKey,
      5 * web3.LAMPORTS_PER_SOL
    );
    await provider.connection.requestAirdrop(
      creator.publicKey,
      2 * web3.LAMPORTS_PER_SOL
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Ensure main state is initialized
    try {
      await program.methods.initMainState().rpc();
    } catch (error) {
      // Main state might already be initialized
    }

    // Create a betting pool
    const mainState = await program.account.mainState.fetch(mainStatePDA);
    betId = mainState.currentBetId.toNumber();

    [poolStatePDA] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), new anchor.BN(betId).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    [historyPDA] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("history"),
        new anchor.BN(betId).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    const endTimestamp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

    await program.methods
      .createPool({
        endTimestamp: new anchor.BN(endTimestamp),
        referee: referee.publicKey,
        title: "Test Pool",
        description: "This is a test betting pool",
      })
      .accounts({
        creator: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    // Create entry for user
    await program.methods
      .createEntry({
        betId: new anchor.BN(betId),
      })
      .accounts({
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

    // Get the entry state PDA
    [entryStatePDA] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("entry"),
        poolStatePDA.toBuffer(),
        user.publicKey.toBuffer(),
      ],
      program.programId
    );
  });

  it("should deposit SOL successfully (YES bet)", async () => {
    const historyBefore = await program.account.poolHistoryState.fetch(
      historyPDA
    );
    const depositAmount = 2000000; // 0.002 SOL in lamports
    const userBalanceBefore = await provider.connection.getBalance(
      user.publicKey
    );
    const vaultBalanceBefore = await provider.connection.getBalance(
      solVaultPDA
    );

    const tx = await program.methods
      .deposit({
        betId: new anchor.BN(betId),
        isYes: true,
        amount: new anchor.BN(depositAmount),
      })
      .accounts({
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

    // Verify the deposit was processed
    const entryState = await program.account.entryState.fetch(entryStatePDA);
    const poolState = await program.account.poolState.fetch(poolStatePDA);

    expect(entryState.depositedSolAmount.toNumber()).to.equal(depositAmount);
    expect(entryState.isYes).to.be.true;
    expect(entryState.tokenBalance.toNumber()).to.be.greaterThan(0);

    expect(poolState.totalReserve.toNumber()).to.equal(depositAmount);
    expect(poolState.yesReserve.toNumber()).to.equal(depositAmount);
    expect(poolState.noReserve.toNumber()).to.equal(0);
    expect(poolState.totalSupply.toNumber()).to.be.greaterThan(0);
    expect(poolState.yesSupply.toNumber()).to.be.greaterThan(0);
    expect(poolState.noSupply.toNumber()).to.equal(0);

    // Verify SOL was transferred
    const userBalanceAfter = await provider.connection.getBalance(
      user.publicKey
    );
    const vaultBalanceAfter = await provider.connection.getBalance(solVaultPDA);

    expect(userBalanceAfter).to.be.lessThan(userBalanceBefore);
    expect(vaultBalanceAfter).to.equal(vaultBalanceBefore + depositAmount);

    // History should have a new snapshot appended
    const historyAfter = await program.account.poolHistoryState.fetch(
      historyPDA
    );
    expect(historyAfter.points.length).to.equal(
      historyBefore.points.length + 1
    );
    const lastPoint = historyAfter.points[historyAfter.points.length - 1];
    expect(lastPoint.yesReserve.toNumber()).to.equal(
      poolState.yesReserve.toNumber()
    );
    expect(lastPoint.noReserve.toNumber()).to.equal(
      poolState.noReserve.toNumber()
    );
  });

  it("should deposit SOL successfully (NO bet)", async () => {
    // Create another user for NO bet
    const user2 = web3.Keypair.generate();
    await provider.connection.requestAirdrop(
      user2.publicKey,
      5 * web3.LAMPORTS_PER_SOL
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Create entry for user2
    await program.methods
      .createEntry({
        betId: new anchor.BN(betId),
      })
      .accounts({
        user: user2.publicKey,
      })
      .signers([user2])
      .rpc();

    const depositAmount = 3000000; // 0.003 SOL in lamports
    const poolStateBefore = await program.account.poolState.fetch(poolStatePDA);

    const historyBefore = await program.account.poolHistoryState.fetch(
      historyPDA
    );

    await program.methods
      .deposit({
        betId: new anchor.BN(betId),
        isYes: false,
        amount: new anchor.BN(depositAmount),
      })
      .accounts({
        user: user2.publicKey,
      })
      .signers([user2])
      .rpc();

    // Get user2's entry state PDA
    const [entry2StatePDA] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("entry"),
        poolStatePDA.toBuffer(),
        user2.publicKey.toBuffer(),
      ],
      program.programId
    );

    const entry2State = await program.account.entryState.fetch(entry2StatePDA);
    const poolStateAfter = await program.account.poolState.fetch(poolStatePDA);

    expect(entry2State.depositedSolAmount.toNumber()).to.equal(depositAmount);
    expect(entry2State.isYes).to.be.false;
    expect(entry2State.tokenBalance.toNumber()).to.be.greaterThan(0);

    expect(poolStateAfter.totalReserve.toNumber()).to.equal(
      poolStateBefore.totalReserve.toNumber() + depositAmount
    );
    expect(poolStateAfter.noReserve.toNumber()).to.equal(depositAmount);
    expect(poolStateAfter.noSupply.toNumber()).to.be.greaterThan(0);

    // History should reflect NO reserve increase
    const historyAfter = await program.account.poolHistoryState.fetch(
      historyPDA
    );
    expect(historyAfter.points.length).to.equal(
      historyBefore.points.length + 1
    );
    const lastPoint = historyAfter.points[historyAfter.points.length - 1];
    expect(lastPoint.yesReserve.toNumber()).to.equal(
      poolStateAfter.yesReserve.toNumber()
    );
    expect(lastPoint.noReserve.toNumber()).to.equal(
      poolStateAfter.noReserve.toNumber()
    );
  });

  it("should allow multiple deposits from same user", async () => {
    const firstDeposit = 1500000; // 0.0015 SOL
    const secondDeposit = 2500000; // 0.0025 SOL

    const entryStateBefore = await program.account.entryState.fetch(
      entryStatePDA
    );
    const poolStateBefore = await program.account.poolState.fetch(poolStatePDA);
    const historyBefore = await program.account.poolHistoryState.fetch(
      historyPDA
    );

    // Second deposit (first deposit was already made in the first test)
    await program.methods
      .deposit({
        betId: new anchor.BN(betId),
        isYes: true,
        amount: new anchor.BN(secondDeposit),
      })
      .accounts({
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

    const entryStateAfter = await program.account.entryState.fetch(
      entryStatePDA
    );
    const poolStateAfter = await program.account.poolState.fetch(poolStatePDA);
    const historyAfter = await program.account.poolHistoryState.fetch(
      historyPDA
    );

    expect(entryStateAfter.depositedSolAmount.toNumber()).to.equal(
      entryStateBefore.depositedSolAmount.toNumber() + secondDeposit
    );
    expect(entryStateAfter.tokenBalance.toNumber()).to.be.greaterThan(
      entryStateBefore.tokenBalance.toNumber()
    );

    expect(poolStateAfter.totalReserve.toNumber()).to.equal(
      poolStateBefore.totalReserve.toNumber() + secondDeposit
    );
    expect(poolStateAfter.yesReserve.toNumber()).to.equal(
      poolStateBefore.yesReserve.toNumber() + secondDeposit
    );

    // History appended again with updated reserves
    expect(historyAfter.points.length).to.equal(
      historyBefore.points.length + 1
    );
    const lastPoint = historyAfter.points[historyAfter.points.length - 1];
    expect(lastPoint.yesReserve.toNumber()).to.equal(
      poolStateAfter.yesReserve.toNumber()
    );
    expect(lastPoint.noReserve.toNumber()).to.equal(
      poolStateAfter.noReserve.toNumber()
    );
  });

  it("should fail when deposit amount is zero", async () => {
    const user3 = web3.Keypair.generate();
    await provider.connection.requestAirdrop(
      user3.publicKey,
      2 * web3.LAMPORTS_PER_SOL
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Create entry for user3
    await program.methods
      .createEntry({
        betId: new anchor.BN(betId),
      })
      .accounts({
        user: user3.publicKey,
      })
      .signers([user3])
      .rpc();

    const zeroAmount = 0; // zero amount should be rejected

    try {
      await program.methods
        .deposit({
          betId: new anchor.BN(betId),
          isYes: true,
          amount: new anchor.BN(zeroAmount),
        })
        .accounts({
          user: user3.publicKey,
        })
        .signers([user3])
        .rpc();

      expect.fail("Should have failed due to zero amount");
    } catch (error: any) {
      expect(error.error.errorCode.code).to.include("InvalidBet");
    }
  });

  it("should fail when trying to switch bet side", async () => {
    // User already has YES bet, try to place NO bet
    try {
      await program.methods
        .deposit({
          betId: new anchor.BN(betId),
          isYes: false, // Trying to switch from YES to NO
          amount: new anchor.BN(2000000),
        })
        .accounts({
          user: user.publicKey,
        })
        .signers([user])
        .rpc();

      expect.fail("Should have failed when trying to switch bet side");
    } catch (error: any) {
      expect(error.error.errorCode.code).to.include("InvalidBet");
    }
  });

  it("should fail when betting period has ended", async () => {
    // Create a new pool with past end timestamp
    const mainState = await program.account.mainState.fetch(mainStatePDA);
    const newBetId = mainState.currentBetId.toNumber();

    const pastEndTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago

    await program.methods
      .createPool({
        endTimestamp: new anchor.BN(pastEndTimestamp),
        referee: referee.publicKey,
        title: "Past Pool",
        description: "This pool has ended",
      })
      .accounts({
        creator: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    // Create entry for this expired pool
    try {
      await program.methods
        .createEntry({
          betId: new anchor.BN(newBetId),
        })
        .accounts({
          user: user.publicKey,
        })
        .signers([user])
        .rpc();
    } catch (error: any) {
      expect(error.error.errorCode.code).to.equal("BetEnded");
    }
  });

  it("should emit DepositEvent when deposit is successful", async () => {
    const user4 = web3.Keypair.generate();
    await provider.connection.requestAirdrop(
      user4.publicKey,
      3 * web3.LAMPORTS_PER_SOL
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Create entry for user4
    await program.methods
      .createEntry({
        betId: new anchor.BN(betId),
      })
      .accounts({
        user: user4.publicKey,
      })
      .signers([user4])
      .rpc();

    const depositAmount = 1500000;
    let eventEmitted = false;

    // Listen for events
    const listener = program.addEventListener("depositEvent", (event) => {
      expect(event.user.toString()).to.equal(user4.publicKey.toString());
      expect(event.betId.toNumber()).to.equal(betId);
      expect(event.solAmount.toNumber()).to.equal(depositAmount);
      expect(event.tokenAmount.toNumber()).to.be.greaterThan(0);
      expect(event.isYes).to.be.true;
      eventEmitted = true;
    });

    await program.methods
      .deposit({
        betId: new anchor.BN(betId),
        isYes: true,
        amount: new anchor.BN(depositAmount),
      })
      .accounts({
        user: user4.publicKey,
      })
      .signers([user4])
      .rpc();

    // Wait a bit for the event to be processed
    await new Promise((resolve) => setTimeout(resolve, 1000));

    program.removeEventListener(listener);
    expect(eventEmitted).to.be.true;
  });
});
