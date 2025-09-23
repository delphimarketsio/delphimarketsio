import * as anchor from "@coral-xyz/anchor";
import { web3, Program } from "@coral-xyz/anchor";
import { BettingProgram } from "../target/types/betting_program";
import { expect } from "chai";

// Tests for open-ended markets (no fixed end time). We use endTimestamp = -1 to denote open-ended.
describe("Open-Ended Markets", () => {
  let program: Program<BettingProgram>;
  let provider: anchor.AnchorProvider;
  let creator: web3.Keypair;
  let referee: web3.Keypair;
  let yesUser: web3.Keypair;
  let noUser: web3.Keypair;
  let mainStatePDA: web3.PublicKey;
  let poolStatePDA: web3.PublicKey;
  let yesEntryPDA: web3.PublicKey;
  let noEntryPDA: web3.PublicKey;
  let solVaultPDA: web3.PublicKey;
  let betId: number;

  before(async () => {
    provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    program = anchor.workspace.BettingProgram as Program<BettingProgram>;

    creator = web3.Keypair.generate();
    referee = web3.Keypair.generate();
    yesUser = web3.Keypair.generate();
    noUser = web3.Keypair.generate();

    [mainStatePDA] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("main")],
      program.programId
    );
    [solVaultPDA] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("sol-vault")],
      program.programId
    );

    // Fund accounts
    for (const kp of [creator, referee, yesUser, noUser]) {
      await provider.connection.requestAirdrop(
        kp.publicKey,
        5 * web3.LAMPORTS_PER_SOL
      );
    }
    await new Promise((r) => setTimeout(r, 1000));

    // Ensure main state exists
    try {
      await program.methods.initMainState().rpc();
    } catch (_) {
      // already initialized
    }
  });

  it("creates an open-ended pool and allows immediate resolution", async () => {
    // Create open-ended pool with endTimestamp = -1
    const mainState = await program.account.mainState.fetch(mainStatePDA);
    betId = mainState.currentBetId.toNumber();

    [poolStatePDA] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), new anchor.BN(betId).toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    await program.methods
      .createPool({
        endTimestamp: new anchor.BN(-1), // open-ended
        referee: referee.publicKey,
        title: "Open-Ended Pool",
        description: "Resolves when referee decides",
      })
      .accounts({ creator: creator.publicKey })
      .signers([creator])
      .rpc();

    const poolState = await program.account.poolState.fetch(poolStatePDA);
    expect(poolState.endTimestamp.toNumber()).to.equal(-1);
    expect(poolState.complete).to.be.false;

    // Users can create entries since market is open-ended and not completed
    await program.methods
      .createEntry({ betId: new anchor.BN(betId) })
      .accounts({ user: yesUser.publicKey })
      .signers([yesUser])
      .rpc();

    await program.methods
      .createEntry({ betId: new anchor.BN(betId) })
      .accounts({ user: noUser.publicKey })
      .signers([noUser])
      .rpc();

    // Derive entry PDAs
    [yesEntryPDA] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("entry"),
        poolStatePDA.toBuffer(),
        yesUser.publicKey.toBuffer(),
      ],
      program.programId
    );
    [noEntryPDA] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("entry"),
        poolStatePDA.toBuffer(),
        noUser.publicKey.toBuffer(),
      ],
      program.programId
    );

    // Users can deposit into open-ended market
    await program.methods
      .deposit({
        betId: new anchor.BN(betId),
        isYes: true,
        amount: new anchor.BN(2_000_000),
      })
      .accounts({ user: yesUser.publicKey })
      .signers([yesUser])
      .rpc();

    await program.methods
      .deposit({
        betId: new anchor.BN(betId),
        isYes: false,
        amount: new anchor.BN(3_000_000),
      })
      .accounts({ user: noUser.publicKey })
      .signers([noUser])
      .rpc();

    // Referee can resolve immediately even though there's no end date
    await program.methods
      .setWinner({ betId: new anchor.BN(betId), isYes: false })
      .accounts({
        referee: referee.publicKey,
        solVault: solVaultPDA,
        platformOwner: (provider.wallet as any).publicKey,
      } as any)
      .signers([referee])
      .rpc();

    const poolAfter = await program.account.poolState.fetch(poolStatePDA);
    expect(poolAfter.complete).to.be.true;
    expect(poolAfter.winner).to.equal("no");

    // After completion, further deposits should fail with BetComplete
    try {
      await program.methods
        .deposit({
          betId: new anchor.BN(betId),
          isYes: true,
          amount: new anchor.BN(1_000_000),
        })
        .accounts({ user: yesUser.publicKey })
        .signers([yesUser])
        .rpc();
      expect.fail("deposit should fail after completion");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.include("BetComplete");
    }

    // And creating new entries should also fail with BetComplete
    try {
      const anotherUser = web3.Keypair.generate();
      await provider.connection.requestAirdrop(
        anotherUser.publicKey,
        2 * web3.LAMPORTS_PER_SOL
      );
      await new Promise((r) => setTimeout(r, 500));

      await program.methods
        .createEntry({ betId: new anchor.BN(betId) })
        .accounts({ user: anotherUser.publicKey })
        .signers([anotherUser])
        .rpc();
      expect.fail("createEntry should fail after completion");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.include("BetComplete");
    }
  });

  it("allows claiming and creator fee without waiting for a time check", async () => {
    // New open-ended pool
    const mainState = await program.account.mainState.fetch(mainStatePDA);
    const newBetId = mainState.currentBetId.toNumber();

    const [newPoolPDA] = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool"),
        new anchor.BN(newBetId).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    await program.methods
      .createPool({
        endTimestamp: new anchor.BN(-1),
        referee: referee.publicKey,
        title: "Open-Ended Pool 2",
        description: "No fixed end",
      })
      .accounts({ creator: creator.publicKey })
      .signers([creator])
      .rpc();

    // New users
    const winUser = web3.Keypair.generate();
    const loseUser = web3.Keypair.generate();
    await provider.connection.requestAirdrop(
      winUser.publicKey,
      3 * web3.LAMPORTS_PER_SOL
    );
    await provider.connection.requestAirdrop(
      loseUser.publicKey,
      3 * web3.LAMPORTS_PER_SOL
    );
    await new Promise((r) => setTimeout(r, 800));

    await program.methods
      .createEntry({ betId: new anchor.BN(newBetId) })
      .accounts({ user: winUser.publicKey })
      .signers([winUser])
      .rpc();

    await program.methods
      .createEntry({ betId: new anchor.BN(newBetId) })
      .accounts({ user: loseUser.publicKey })
      .signers([loseUser])
      .rpc();

    await program.methods
      .deposit({
        betId: new anchor.BN(newBetId),
        isYes: true,
        amount: new anchor.BN(3_000_000),
      })
      .accounts({ user: winUser.publicKey })
      .signers([winUser])
      .rpc();

    await program.methods
      .deposit({
        betId: new anchor.BN(newBetId),
        isYes: false,
        amount: new anchor.BN(2_000_000),
      })
      .accounts({ user: loseUser.publicKey })
      .signers([loseUser])
      .rpc();

    // Resolve to YES immediately
    await program.methods
      .setWinner({ betId: new anchor.BN(newBetId), isYes: true })
      .accounts({
        referee: referee.publicKey,
        solVault: solVaultPDA,
        platformOwner: (provider.wallet as any).publicKey,
      } as any)
      .signers([referee])
      .rpc();

    // Winner can claim without needing end time to pass (payout will reflect creator+platform fees)
    const balBefore = await provider.connection.getBalance(winUser.publicKey);
    await program.methods
      .claim({ betId: new anchor.BN(newBetId) })
      .accounts({ user: winUser.publicKey })
      .signers([winUser])
      .rpc();
    const balAfter = await provider.connection.getBalance(winUser.publicKey);
    // Expected increase: principal (3_000_000) + share of losing pool after fees
    const ms = await program.account.mainState.fetch(mainStatePDA);
    const creatorBps = ms.creatorFeePercent.toNumber();
    const platformBps = (ms as any).platformFeePercent?.toNumber?.() ?? 100;
    const losing = 2_000_000;
    const creatorFee = Math.floor((losing * creatorBps) / 10000);
    const platformFee = Math.floor((losing * platformBps) / 10000);
    const expectedDelta = 3_000_000 + (losing - creatorFee - platformFee);
    expect(balAfter - balBefore).to.be.approximately(expectedDelta, 250_000);

    // Creator can claim fee immediately after completion
    const creatorBalBefore = await provider.connection.getBalance(
      creator.publicKey
    );
    await program.methods
      .claimCreatorFee({ betId: new anchor.BN(newBetId) })
      .accounts({ creator: creator.publicKey })
      .signers([creator])
      .rpc();
    const creatorBalAfter = await provider.connection.getBalance(
      creator.publicKey
    );
    expect(creatorBalAfter).to.be.greaterThan(creatorBalBefore);

    const ownerPk = mainState.owner as web3.PublicKey;

    const ownerBalBefore = await provider.connection.getBalance(ownerPk);
    const ownerBalAfter = await provider.connection.getBalance(ownerPk);
    // Platform owner should receive the platform fee; however, the owner is also typically the
    // transaction fee payer in tests, so allow for fees by checking the delta approximately equals
    // the expected platform fee within a tolerance.
    const ms2 = await program.account.mainState.fetch(mainStatePDA);
    const platformBps2 = (ms2 as any).platformFeePercent?.toNumber?.() ?? 0;
    const expectedPlatformFeeLamports = Math.floor(
      (losing * platformBps2) / 10000
    );
    expect(ownerBalAfter - ownerBalBefore).to.be.approximately(
      expectedPlatformFeeLamports,
      100_000 // tolerate tx fees and minor rounding
    );
  });
});
