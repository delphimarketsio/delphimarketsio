import * as anchor from "@coral-xyz/anchor";
import { web3, Program } from "@coral-xyz/anchor";
import { BettingProgram } from "../target/types/betting_program";
import { expect } from "chai";

describe("Set Winner", () => {
  let program: Program<BettingProgram>;
  let provider: anchor.AnchorProvider;
  let owner: web3.Keypair;
  let creator: web3.Keypair;
  let referee: web3.Keypair;
  let unauthorizedUser: web3.Keypair;
  let mainStatePDA: web3.PublicKey;
  let poolStatePDA: web3.PublicKey;
  let betId: number;

  before(async () => {
    provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    program = anchor.workspace.BettingProgram as Program<BettingProgram>;

    owner = provider.wallet as any;
    creator = web3.Keypair.generate();
    referee = web3.Keypair.generate();
    unauthorizedUser = web3.Keypair.generate();

    // Get the main state PDA
    [mainStatePDA] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("main")],
      program.programId
    );

    // Fund accounts
    await provider.connection.requestAirdrop(
      creator.publicKey,
      2 * web3.LAMPORTS_PER_SOL
    );
    await provider.connection.requestAirdrop(
      referee.publicKey,
      2 * web3.LAMPORTS_PER_SOL
    );
    await provider.connection.requestAirdrop(
      unauthorizedUser.publicKey,
      2 * web3.LAMPORTS_PER_SOL
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Ensure main state is initialized
    try {
      await program.methods.initMainState().rpc();
    } catch (error) {
      // Main state might already be initialized
    }

    // Create a betting pool with past end timestamp (so we can set winner)
    const mainState = await program.account.mainState.fetch(mainStatePDA);
    betId = mainState.currentBetId.toNumber();

    [poolStatePDA] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), new anchor.BN(betId).toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const pastEndTimestamp = Math.floor(Date.now() / 1000) - 1800; // 30 minutes ago

    await program.methods
      .createPool({
        endTimestamp: new anchor.BN(pastEndTimestamp),
        referee: referee.publicKey,
        title: "Test Pool",
        description: "This is a test betting pool",
      })
      .accounts({
        creator: creator.publicKey,
      })
      .signers([creator])
      .rpc();
  });

  it("should set winner successfully by referee (YES)", async () => {
    const tx = await program.methods
      .setWinner({
        betId: new anchor.BN(betId),
        isYes: true,
      })
      .accounts({
        referee: referee.publicKey,
        solVault: web3.PublicKey.findProgramAddressSync(
          [Buffer.from("sol-vault")],
          program.programId
        )[0],
        platformOwner: (provider.wallet as any).publicKey,
      } as any)
      .signers([referee])
      .rpc();

    // Verify the winner was set
    const poolState = await program.account.poolState.fetch(poolStatePDA);
    expect(poolState.complete).to.be.true;
    expect(poolState.winner).to.equal("yes");
  });

  it("should create another pool and set winner to NO", async () => {
    // Create another pool for NO winner test
    const mainState = await program.account.mainState.fetch(mainStatePDA);
    const newBetId = mainState.currentBetId.toNumber();

    const [newPoolStatePDA] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool"),
        new anchor.BN(newBetId).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    const pastEndTimestamp = Math.floor(Date.now() / 1000) - 900; // 15 minutes ago

    await program.methods
      .createPool({
        endTimestamp: new anchor.BN(pastEndTimestamp),
        referee: referee.publicKey,
        title: "Test Pool NO",
        description: "This is a test betting pool for NO",
      })
      .accounts({
        creator: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    await program.methods
      .setWinner({
        betId: new anchor.BN(newBetId),
        isYes: false,
      })
      .accounts({
        referee: referee.publicKey,
        solVault: web3.PublicKey.findProgramAddressSync(
          [Buffer.from("sol-vault")],
          program.programId
        )[0],
        platformOwner: (provider.wallet as any).publicKey,
      } as any)
      .signers([referee])
      .rpc();

    // Verify the winner was set to NO
    const poolState = await program.account.poolState.fetch(newPoolStatePDA);
    expect(poolState.complete).to.be.true;
    expect(poolState.winner).to.equal("no");
  });

  it("should allow owner to set winner", async () => {
    // Create another pool for owner test
    const mainState = await program.account.mainState.fetch(mainStatePDA);
    const newBetId = mainState.currentBetId.toNumber();

    const [newPoolStatePDA] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool"),
        new anchor.BN(newBetId).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    const pastEndTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago

    await program.methods
      .createPool({
        endTimestamp: new anchor.BN(pastEndTimestamp),
        referee: referee.publicKey,
        title: "Test Pool Owner",
        description: "This is a test betting pool for owner",
      })
      .accounts({
        creator: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    // Owner should be able to set winner
    await program.methods
      .setWinner({
        betId: new anchor.BN(newBetId),
        isYes: true,
      })
      .accounts({
        referee: (provider.wallet as any).publicKey,
        solVault: web3.PublicKey.findProgramAddressSync(
          [Buffer.from("sol-vault")],
          program.programId
        )[0],
        platformOwner: (provider.wallet as any).publicKey,
      } as any)
      .rpc();

    const poolState = await program.account.poolState.fetch(newPoolStatePDA);
    expect(poolState.complete).to.be.true;
    expect(poolState.winner).to.equal("yes");
  });

  it("should fail when called by unauthorized user", async () => {
    // Create another pool for unauthorized test
    const mainState = await program.account.mainState.fetch(mainStatePDA);
    const newBetId = mainState.currentBetId.toNumber();

    const pastEndTimestamp = Math.floor(Date.now() / 1000) - 300; // 5 minutes ago

    await program.methods
      .createPool({
        endTimestamp: new anchor.BN(pastEndTimestamp),
        referee: referee.publicKey,
        title: "Test Pool Unauthorized",
        description: "This is a test betting pool for unauthorized user",
      })
      .accounts({
        creator: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    try {
      await program.methods
        .setWinner({
          betId: new anchor.BN(newBetId),
          isYes: true,
        })
        .accounts({
          referee: unauthorizedUser.publicKey,
          solVault: web3.PublicKey.findProgramAddressSync(
            [Buffer.from("sol-vault")],
            program.programId
          )[0],
          platformOwner: (provider.wallet as any).publicKey,
        } as any)
        .signers([unauthorizedUser])
        .rpc();

      expect.fail("Should have failed with unauthorized error");
    } catch (error: any) {
      expect(error.error.errorCode.code).to.include("Unauthorized");
    }
  });

  it("should fail when bet has not ended yet", async () => {
    // Create a pool with future end timestamp
    const mainState = await program.account.mainState.fetch(mainStatePDA);
    const newBetId = mainState.currentBetId.toNumber();

    const futureEndTimestamp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

    await program.methods
      .createPool({
        endTimestamp: new anchor.BN(futureEndTimestamp),
        referee: referee.publicKey,
        title: "Future Pool",
        description: "This is a test betting pool for future",
      })
      .accounts({
        creator: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    try {
      await program.methods
        .setWinner({
          betId: new anchor.BN(newBetId),
          isYes: true,
        })
        .accounts({
          referee: referee.publicKey,
          solVault: web3.PublicKey.findProgramAddressSync(
            [Buffer.from("sol-vault")],
            program.programId
          )[0],
          platformOwner: (provider.wallet as any).publicKey,
        } as any)
        .signers([referee])
        .rpc();

      expect.fail("Should have failed because bet has not ended");
    } catch (error: any) {
      expect(error.error.errorCode.code).to.include("BetNotEnded");
    }
  });

  it("should fail when bet is already complete", async () => {
    // Try to set winner again on an already completed bet
    try {
      await program.methods
        .setWinner({
          betId: new anchor.BN(betId),
          isYes: false, // Try to change from YES to NO
        })
        .accounts({
          referee: referee.publicKey,
          solVault: web3.PublicKey.findProgramAddressSync(
            [Buffer.from("sol-vault")],
            program.programId
          )[0],
          platformOwner: (provider.wallet as any).publicKey,
        } as any)
        .signers([referee])
        .rpc();

      expect.fail("Should have failed because bet is already complete");
    } catch (error: any) {
      expect(error.error.errorCode.code).to.include("BetComplete");
    }
  });

  it("should emit CompleteEvent when winner is set", async () => {
    // Create another pool for event test
    const mainState = await program.account.mainState.fetch(mainStatePDA);
    const newBetId = mainState.currentBetId.toNumber();

    const pastEndTimestamp = Math.floor(Date.now() / 1000) - 120; // 2 minutes ago

    await program.methods
      .createPool({
        endTimestamp: new anchor.BN(pastEndTimestamp),
        referee: referee.publicKey,
        title: "Event Test Pool",
        description: "This is a test betting pool for event",
      })
      .accounts({
        creator: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    let eventEmitted = false;
    const listener = program.addEventListener("completeEvent", (event) => {
      expect(event.referee.toString()).to.equal(referee.publicKey.toString());
      expect(event.betId.toNumber()).to.equal(newBetId);
      expect(event.winner).to.equal("no");
      eventEmitted = true;
    });

    await program.methods
      .setWinner({
        betId: new anchor.BN(newBetId),
        isYes: false,
      })
      .accounts({
        referee: referee.publicKey,
        solVault: web3.PublicKey.findProgramAddressSync(
          [Buffer.from("sol-vault")],
          program.programId
        )[0],
        platformOwner: (provider.wallet as any).publicKey,
      } as any)
      .signers([referee])
      .rpc();

    // Wait a bit for the event to be processed
    await new Promise((resolve) => setTimeout(resolve, 1000));

    program.removeEventListener(listener);
    expect(eventEmitted).to.be.true;
  });

  it("should fail with invalid bet ID", async () => {
    const invalidBetId = 9999;

    try {
      await program.methods
        .setWinner({
          betId: new anchor.BN(invalidBetId),
          isYes: true,
        })
        .accounts({
          referee: referee.publicKey,
          solVault: web3.PublicKey.findProgramAddressSync(
            [Buffer.from("sol-vault")],
            program.programId
          )[0],
          platformOwner: (provider.wallet as any).publicKey,
        } as any)
        .signers([referee])
        .rpc();

      expect.fail("Should have failed with invalid bet ID");
    } catch (error) {
      // Expected to fail due to account validation
      expect(error).to.exist;
    }
  });
});
