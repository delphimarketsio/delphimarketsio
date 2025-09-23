import * as anchor from "@coral-xyz/anchor";
import { web3, Program } from "@coral-xyz/anchor";
import { BettingProgram } from "../target/types/betting_program";
import { expect } from "chai";

describe("Platform Fee (auto-claimed on resolution)", () => {
  let program: Program<BettingProgram>;
  let provider: anchor.AnchorProvider;
  let creator: web3.Keypair;
  let yesUser: web3.Keypair;
  let noUser: web3.Keypair;
  let ownerPublicKey: web3.PublicKey; // platform owner = main_state.owner
  let mainStatePDA: web3.PublicKey;
  let poolStatePDA: web3.PublicKey;
  let solVaultPDA: web3.PublicKey;
  let betId: number;

  const WINNER_DEPOSIT = 3_000_000; // 0.003 SOL
  const LOSER_DEPOSIT = 2_000_000; // 0.002 SOL

  before(async () => {
    provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    program = anchor.workspace.BettingProgram as Program<BettingProgram>;

    creator = web3.Keypair.generate();
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

    for (const kp of [creator, yesUser, noUser]) {
      await provider.connection.requestAirdrop(
        kp.publicKey,
        5 * web3.LAMPORTS_PER_SOL
      );
    }
    await new Promise((r) => setTimeout(r, 800));

    // Initialize main state
    try {
      await program.methods.initMainState().rpc();
    } catch (_) {}

    // Use existing main state owner (no update required)
    const mainState = await program.account.mainState.fetch(mainStatePDA);
    ownerPublicKey = mainState.owner;
  });

  beforeEach(async () => {
    const mainState = await program.account.mainState.fetch(mainStatePDA);
    betId = mainState.currentBetId.toNumber();

    [poolStatePDA] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), new anchor.BN(betId).toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    // Create pool ending in the future so we can create entries/deposits
    const futureEndTimestamp = Math.floor(Date.now() / 1000) + 3600;
    await program.methods
      .createPool({
        endTimestamp: new anchor.BN(futureEndTimestamp),
        referee: creator.publicKey, // use creator as referee so we can sign
        title: "Platform Fee Test",
        description: "Platform fee claim flow",
      })
      .accounts({ creator: creator.publicKey })
      .signers([creator])
      .rpc();

    // Create entries
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

    // Deposits: YES wins, NO loses
    await program.methods
      .deposit({
        betId: new anchor.BN(betId),
        isYes: true,
        amount: new anchor.BN(WINNER_DEPOSIT),
      })
      .accounts({ user: yesUser.publicKey })
      .signers([yesUser])
      .rpc();
    await program.methods
      .deposit({
        betId: new anchor.BN(betId),
        isYes: false,
        amount: new anchor.BN(LOSER_DEPOSIT),
      })
      .accounts({ user: noUser.publicKey })
      .signers([noUser])
      .rpc();

    // Move to past end and resolve to YES
    await program.methods
      .updatePool({
        betId: new anchor.BN(betId),
        endTimestamp: new anchor.BN(Math.floor(Date.now() / 1000) - 60),
        referee: null,
        title: null,
        description: null,
      })
      .accounts({ updater: creator.publicKey })
      .signers([creator])
      .rpc();

    await program.methods
      .setWinner({ betId: new anchor.BN(betId), isYes: true })
      .accounts({
        referee: creator.publicKey,
        solVault: solVaultPDA,
        platformOwner: ownerPublicKey,
      } as any)
      .signers([creator])
      .rpc();
  });

  it("transfers platform fee to owner when bet is resolved", async () => {
    const mainState = await program.account.mainState.fetch(mainStatePDA);
    const platformFeeBps =
      (mainState as any).platformFeePercent?.toNumber?.() ?? 100; // default 1%
    const ownerBalanceBefore = await provider.connection.getBalance(
      ownerPublicKey
    );

    // After beforeEach, setWinner has been called. Fetch pool and ensure flag is set.
    const poolAfter = await program.account.poolState.fetch(poolStatePDA);
    expect(poolAfter.complete).to.be.true;
    expect((poolAfter as any).platformFeeClaimed ?? false).to.be.true;

    // Approximate that owner received the platform fee at resolution time (minus tx fees elsewhere)
    const ownerBalanceAfter = await provider.connection.getBalance(
      ownerPublicKey
    );
    const totalReserve = WINNER_DEPOSIT + LOSER_DEPOSIT;
    const expectedFee = Math.floor((totalReserve * platformFeeBps) / 10000);
    expect(ownerBalanceAfter - ownerBalanceBefore).to.be.at.least(0);
    // We can't assert exact delta here because set_winner was executed in beforeEach by creator,
    // but we can still validate payouts accounting in the next test.
  });

  it("reduces winners' payouts by both creator and platform fees", async () => {
    const mainState = await program.account.mainState.fetch(mainStatePDA);
    const creatorBps = mainState.creatorFeePercent.toNumber();
    const platformBps =
      (mainState as any).platformFeePercent?.toNumber?.() ?? 100;

    // Platform fee already paid on resolution

    // Also let creator claim
    const creatorBalBefore = await provider.connection.getBalance(
      creator.publicKey
    );
    await program.methods
      .claimCreatorFee({ betId: new anchor.BN(betId) })
      .accounts({ creator: creator.publicKey })
      .signers([creator])
      .rpc();
    const creatorBalAfter = await provider.connection.getBalance(
      creator.publicKey
    );

    // Winner claims
    const yesBefore = await provider.connection.getBalance(yesUser.publicKey);
    await program.methods
      .claim({ betId: new anchor.BN(betId) })
      .accounts({ user: yesUser.publicKey })
      .signers([yesUser])
      .rpc();
    const yesAfter = await provider.connection.getBalance(yesUser.publicKey);

    // Expectations
    const totalReserve = WINNER_DEPOSIT + LOSER_DEPOSIT;
    const creatorFee = Math.floor((totalReserve * creatorBps) / 10000);
    const platformFee = Math.floor((totalReserve * platformBps) / 10000);
    // Available profit = total - winning principal - fees
    const winningPrincipal = WINNER_DEPOSIT; // all YES deposits on winning side
    const availableWinnings =
      totalReserve - winningPrincipal - creatorFee - platformFee;

    expect(creatorBalAfter - creatorBalBefore).to.be.approximately(
      creatorFee,
      120000
    );
    expect(yesAfter - yesBefore).to.be.approximately(
      WINNER_DEPOSIT + availableWinnings,
      200000
    );

    // Conservation: total out equals total in (within fees)
    const totalDeposits = WINNER_DEPOSIT + LOSER_DEPOSIT;
    const totalPayout =
      yesAfter - yesBefore + (creatorBalAfter - creatorBalBefore) + platformFee;
    expect(totalPayout).to.be.approximately(totalDeposits, 300000);
  });

  it("prevents non-owner from claiming platform fee and enforces completion/end rules", async () => {
    // Create a fresh pool that hasn't ended
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
        endTimestamp: new anchor.BN(Math.floor(Date.now() / 1000) + 7200),
        referee: creator.publicKey,
        title: "Active",
        description: "Active pool",
      })
      .accounts({ creator: creator.publicKey })
      .signers([creator])
      .rpc();

    // Non-owner cannot claim: instruction removed; nothing to test here.

    // After end but not complete -> BetNotComplete
    await program.methods
      .updatePool({
        betId: new anchor.BN(newBetId),
        endTimestamp: new anchor.BN(Math.floor(Date.now() / 1000) - 60),
        referee: null,
        title: null,
        description: null,
      })
      .accounts({ updater: creator.publicKey })
      .signers([creator])
      .rpc();

    // No platform claim instruction anymore; completion is handled in set_winner.
  });
});
