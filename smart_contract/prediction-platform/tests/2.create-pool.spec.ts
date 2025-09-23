import * as anchor from "@coral-xyz/anchor";
import { web3, Program } from "@coral-xyz/anchor";
import { BettingProgram } from "../target/types/betting_program";
import { expect } from "chai";

describe("Create Pool", () => {
  let program: Program<BettingProgram>;
  let provider: anchor.AnchorProvider;
  let creator: web3.Keypair;
  let referee: web3.Keypair;
  let mainStatePDA: web3.PublicKey;

  before(async () => {
    provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    program = anchor.workspace.BettingProgram as Program<BettingProgram>;

    creator = web3.Keypair.generate();
    referee = web3.Keypair.generate();

    // Get the main state PDA
    [mainStatePDA] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("main")],
      program.programId
    );

    // Fund the creator
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
  });

  it("should create a betting pool successfully", async () => {
    const mainState = await program.account.mainState.fetch(mainStatePDA);
    const currentBetId = mainState.currentBetId;

    const endTimestamp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    const createdLowerBound = Math.floor(Date.now() / 1000) - 5; // allow small clock skew

    // Get the pool state PDA
    const [poolStatePDA] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), currentBetId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const tx = await program.methods
      .createPool({
        title: "Test Pool",
        description: "This is a test betting pool",
        endTimestamp: new anchor.BN(endTimestamp),
        referee: referee.publicKey,
      })
      .accounts({
        creator: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    // Verify the pool was created
    const poolState = await program.account.poolState.fetch(poolStatePDA);
    expect(poolState.creator.toString()).to.equal(creator.publicKey.toString());
    expect(poolState.betId.toNumber()).to.equal(currentBetId.toNumber());
    expect(poolState.title).to.equal("Test Pool");
    expect(poolState.description).to.equal("This is a test betting pool");
    expect(poolState.endTimestamp.toNumber()).to.equal(endTimestamp);
    // createdTimestamp should be set and reasonable
    const createdTs = poolState.createdTimestamp.toNumber();
    expect(createdTs).to.be.a("number");
    expect(createdTs).to.be.greaterThan(0);
    expect(createdTs).to.be.at.least(createdLowerBound);
    expect(createdTs).to.be.at.most(endTimestamp);
    expect(poolState.referee.toString()).to.equal(referee.publicKey.toString());
    // minBuyAmount removed from protocol; no assertion
    expect(poolState.complete).to.be.false;
    expect(poolState.totalSupply.toNumber()).to.equal(0);
    expect(poolState.totalReserve.toNumber()).to.equal(0);

    // Verify main state bet ID was incremented
    const updatedMainState = await program.account.mainState.fetch(
      mainStatePDA
    );
    expect(updatedMainState.currentBetId.toNumber()).to.equal(
      currentBetId.toNumber() + 1
    );

    // Verify history state was initialized with an initial point
    const [historyPDA] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("history"), currentBetId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const historyState = await program.account.poolHistoryState.fetch(
      historyPDA
    );
    expect(historyState.pool.toString()).to.equal(poolStatePDA.toString());
    expect(historyState.betId.toNumber()).to.equal(currentBetId.toNumber());
    // Should have at least the initial snapshot
    expect(historyState.points.length).to.be.greaterThanOrEqual(1);
    const firstPoint = historyState.points[0];
    expect(firstPoint.yesReserve.toNumber()).to.equal(0);
    expect(firstPoint.noReserve.toNumber()).to.equal(0);
    // Timestamp should be reasonable
    expect(firstPoint.timestamp.toNumber()).to.be.at.least(createdLowerBound);
  });

  it("should create multiple pools with different bet IDs", async () => {
    const mainState = await program.account.mainState.fetch(mainStatePDA);
    const currentBetId = mainState.currentBetId;

    const endTimestamp = Math.floor(Date.now() / 1000) + 7200; // 2 hours from now

    // Get the pool state PDA for the new bet ID
    const [poolStatePDA] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), currentBetId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    await program.methods
      .createPool({
        title: "Second Test Pool",
        description: "This is another test betting pool",
        endTimestamp: new anchor.BN(endTimestamp),
        referee: referee.publicKey,
      })
      .accounts({
        creator: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    // Verify the second pool was created with incremented bet ID
    const poolState = await program.account.poolState.fetch(poolStatePDA);
    expect(poolState.betId.toNumber()).to.equal(currentBetId.toNumber());
    expect(poolState.title).to.equal("Second Test Pool");
    expect(poolState.description).to.equal("This is another test betting pool");
    expect(poolState.endTimestamp.toNumber()).to.equal(endTimestamp);
    // minBuyAmount removed from protocol; no assertion
  });

  /*it("should fail when main state is not initialized", async () => {
        // Create a fake main state PDA that doesn't exist
        const fakeMainStatePDA = web3.Keypair.generate().publicKey;
        const fakeBetId = new anchor.BN(999);
        
        const [poolStatePDA] = web3.PublicKey.findProgramAddressSync(
            [Buffer.from("pool"), fakeBetId.toArrayLike(Buffer, "le", 8)],
            program.programId
        );

        try {
            await program.methods
                .createPool({
                    endTimestamp: new anchor.BN(Math.floor(Date.now() / 1000) + 3600),
                    referee: referee.publicKey,
                    // minBuyAmount removed
                    title: "Fake Pool",
                    description: "This is a fake betting pool",
                })
                .accounts({
                    creator: creator.publicKey,
                    mainState: fakeMainStatePDA,
                    poolState: poolStatePDA,
                    systemProgram: web3.SystemProgram.programId,
                })
                .signers([creator])
                .rpc();
                
            expect.fail("Should have failed due to invalid main state");
        } catch (error: any) {
            // Expected to fail due to account validation
            expect(error).to.exist;
        }
    });

    it("should emit CreateEvent when pool is created", async () => {
        const mainState = await program.account.mainState.fetch(mainStatePDA);
        const currentBetId = mainState.currentBetId;
        
        const endTimestamp = Math.floor(Date.now() / 1000) + 1800; // 30 minutes from now
  // minBuyAmount removed from protocol

        const [poolStatePDA] = web3.PublicKey.findProgramAddressSync(
            [Buffer.from("pool"), currentBetId.toArrayLike(Buffer, "le", 8)],
            program.programId
        );

        // Listen for events
        let eventEmitted = false;
        const listener = program.addEventListener("CreateEvent", (event) => {
            expect(event.creator.toString()).to.equal(creator.publicKey.toString());
            expect(event.betId.toNumber()).to.equal(currentBetId.toNumber());
            expect(event.endTimestamp.toNumber()).to.equal(endTimestamp);
            expect(event.referee.toString()).to.equal(referee.publicKey.toString());
            // minBuyAmount removed from CreateEvent
            eventEmitted = true;
        });

        await program.methods
            .createPool({
                endTimestamp: new anchor.BN(endTimestamp),
                referee: referee.publicKey,
                // minBuyAmount removed
                title: "Test Pool",
                description: "This is a test betting pool",
            })
            .accounts({
                creator: creator.publicKey,
                mainState: mainStatePDA,
                poolState: poolStatePDA,
                systemProgram: web3.SystemProgram.programId,
            })
            .signers([creator])
            .rpc();

        // Wait a bit for the event to be processed
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        program.removeEventListener(listener);
        expect(eventEmitted).to.be.true;
    });*/
});
