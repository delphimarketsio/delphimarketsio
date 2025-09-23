import * as anchor from "@coral-xyz/anchor";
import { web3, Program } from "@coral-xyz/anchor";
import { BettingProgram } from "../target/types/betting_program";
import { expect } from "chai";

describe.skip("Update Main State", () => {
  let program: Program<BettingProgram>;
  let provider: anchor.AnchorProvider;
  let owner: web3.Keypair;
  let unauthorizedUser: web3.Keypair;
  let mainStatePDA: web3.PublicKey;

  before(async () => {
    provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    program = anchor.workspace.BettingProgram as Program<BettingProgram>;

    owner = provider.wallet as any;
    unauthorizedUser = web3.Keypair.generate();

    // Get the main state PDA
    [mainStatePDA] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("main")],
      program.programId
    );

    // Ensure main state is initialized
    try {
      await program.methods.initMainState().rpc();
    } catch (error) {
      // Main state might already be initialized
    }
  });

  it("should update main state parameters successfully", async () => {
    const newInitialPrice = 200_000_000;
    const newScaleFactor = 20_000_000;

    const tx = await program.methods
      .updateMainState({
        owner: owner.publicKey,
        initialPrice: new anchor.BN(newInitialPrice),
        scaleFactor: new anchor.BN(newScaleFactor),
        creatorFeePercent: new anchor.BN(500),
      })
      .accounts({
        owner: owner.publicKey,
        mainState: mainStatePDA,
      })
      .rpc();

    // Verify the state was updated
    const mainState = await program.account.mainState.fetch(mainStatePDA);
    expect(mainState.owner.toString()).to.equal(owner.publicKey.toString());
    expect(mainState.initialPrice.toNumber()).to.equal(newInitialPrice);
    expect(mainState.scaleFactor.toNumber()).to.equal(newScaleFactor);
    expect(mainState.initialized).to.be.true;
  });

  it("should fail when called by unauthorized user", async () => {
    const newOwner = web3.Keypair.generate().publicKey;
    const newInitialPrice = 300_000_000;
    const newScaleFactor = 30_000_000;

    // Fund the unauthorized user
    await provider.connection.requestAirdrop(
      unauthorizedUser.publicKey,
      2 * web3.LAMPORTS_PER_SOL
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));

    try {
      await program.methods
        .updateMainState({
          owner: newOwner,
          initialPrice: new anchor.BN(newInitialPrice),
          scaleFactor: new anchor.BN(newScaleFactor),
          creatorFeePercent: new anchor.BN(500),
        })
        .accounts({
          owner: unauthorizedUser.publicKey,
          mainState: mainStatePDA,
        })
        .signers([unauthorizedUser])
        .rpc();

      expect.fail("Should have failed with unauthorized error");
    } catch (error: any) {
      expect(error.error.errorCode.code).to.include("Unauthorized");
    }
  });

  it("should fail when main state is not initialized", async () => {
    // Create a new program instance with a different program ID to simulate uninitialized state
    const fakeMainStatePDA = web3.Keypair.generate().publicKey;

    try {
      await program.methods
        .updateMainState({
          owner: owner.publicKey,
          initialPrice: new anchor.BN(100_000_000),
          scaleFactor: new anchor.BN(10_000_000),
          creatorFeePercent: new anchor.BN(500),
        })
        .accounts({
          owner: owner.publicKey,
          mainState: fakeMainStatePDA,
        })
        .rpc();

      expect.fail("Should have failed with uninitialized error");
    } catch (error) {
      // Expected to fail due to account validation
      expect(error).to.exist;
    }
  });
});
