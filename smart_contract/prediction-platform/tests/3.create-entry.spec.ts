import * as anchor from "@coral-xyz/anchor";
import { web3, Program } from "@coral-xyz/anchor";
import { BettingProgram } from "../target/types/betting_program";
import { expect } from "chai";

describe("Create Entry", () => {
  let program: Program<BettingProgram>;
  let provider: anchor.AnchorProvider;
  let user: web3.Keypair;
  let creator: web3.Keypair;
  let referee: web3.Keypair;
  let mainStatePDA: web3.PublicKey;
  let poolStatePDA: web3.PublicKey;
  let entryStatePDA: web3.PublicKey;
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

    // Fund accounts
    await provider.connection.requestAirdrop(
      user.publicKey,
      2 * web3.LAMPORTS_PER_SOL
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

    // Create a betting pool first
    const mainState = await program.account.mainState.fetch(mainStatePDA);
    betId = mainState.currentBetId.toNumber();

    [poolStatePDA] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), new anchor.BN(betId).toArrayLike(Buffer, "le", 8)],
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

  it("should create an entry successfully", async () => {
    const tx = await program.methods
      .createEntry({
        betId: new anchor.BN(betId),
      })
      .accounts({
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

    // Verify the entry was created
    const entryState = await program.account.entryState.fetch(entryStatePDA);
    expect(entryState.user.toString()).to.equal(user.publicKey.toString());
    expect(entryState.betId.toNumber()).to.equal(betId);
    expect(entryState.depositedSolAmount.toNumber()).to.equal(0);
    expect(entryState.tokenBalance.toNumber()).to.equal(0);
    expect(entryState.isYes).to.be.true;
    expect(entryState.isClaimed).to.be.false;
  });

  it("should create multiple entries for different users", async () => {
    const user2 = web3.Keypair.generate();

    // Fund user2
    await provider.connection.requestAirdrop(
      user2.publicKey,
      2 * web3.LAMPORTS_PER_SOL
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Get entry state PDA for user2
    const [entryState2PDA] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("entry"),
        poolStatePDA.toBuffer(),
        user2.publicKey.toBuffer(),
      ],
      program.programId
    );

    await program.methods
      .createEntry({
        betId: new anchor.BN(betId),
      })
      .accounts({
        user: user2.publicKey,
      })
      .signers([user2])
      .rpc();

    // Verify both entries exist
    const entryState1 = await program.account.entryState.fetch(entryStatePDA);
    const entryState2 = await program.account.entryState.fetch(entryState2PDA);

    expect(entryState1.user.toString()).to.equal(user.publicKey.toString());
    expect(entryState2.user.toString()).to.equal(user2.publicKey.toString());
    expect(entryState1.betId.toNumber()).to.equal(betId);
    expect(entryState2.betId.toNumber()).to.equal(betId);
  });

  it("should fail when betting period has ended", async () => {
    // Create a new pool with past end timestamp
    const mainState = await program.account.mainState.fetch(mainStatePDA);
    const newBetId = mainState.currentBetId.toNumber();

    const [newPoolStatePDA] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool"),
        new anchor.BN(newBetId).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

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

    const [newEntryStatePDA] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("entry"),
        newPoolStatePDA.toBuffer(),
        user.publicKey.toBuffer(),
      ],
      program.programId
    );

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

      expect.fail("Should have failed because betting period has ended");
    } catch (error: any) {
      expect(error.error.errorCode.code).to.equal("BetEnded");
    }
  });

  it("should handle idempotent entry creation", async () => {
    // Try to create the same entry again
    const tx = await program.methods
      .createEntry({
        betId: new anchor.BN(betId),
      })
      .accounts({
        user: user.publicKey,
      })
      .signers([user])
      .rpc();

    // Should succeed without error due to init_if_needed
    const entryState = await program.account.entryState.fetch(entryStatePDA);
    expect(entryState.user.toString()).to.equal(user.publicKey.toString());
    expect(entryState.betId.toNumber()).to.equal(betId);
  });

  it("should fail with invalid bet ID", async () => {
    const invalidBetId = 9999;
    const [invalidPoolStatePDA] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool"),
        new anchor.BN(invalidBetId).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    const [invalidEntryStatePDA] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("entry"),
        invalidPoolStatePDA.toBuffer(),
        user.publicKey.toBuffer(),
      ],
      program.programId
    );

    try {
      await program.methods
        .createEntry({
          betId: new anchor.BN(invalidBetId),
        })
        .accounts({
          user: user.publicKey,
        })
        .signers([user])
        .rpc();

      expect.fail("Should have failed with invalid bet ID");
    } catch (error) {
      // Expected to fail due to account validation
      expect(error).to.exist;
    }
  });
});
