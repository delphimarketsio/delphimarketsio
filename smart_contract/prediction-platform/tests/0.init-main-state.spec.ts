import * as anchor from "@coral-xyz/anchor";
import { web3, Program } from "@coral-xyz/anchor";
import { BettingProgram } from "../target/types/betting_program";
import { expect } from "chai";

describe("Initialization of the Betting Program", () => {
  it("should initialize the main state", async () => {
    anchor.setProvider(anchor.AnchorProvider.env());
    const program = anchor.workspace.BettingProgram as Program<BettingProgram>;

    // Call the initialize function
    const _tx = await program.methods.initMainState().rpc();

    // Check if the main state was created
    const mainState = await program.account.mainState.all();
    expect(mainState.length).to.equal(1, "Main state should be initialized");

    // Check if initMainState is idempotent
    await expect(program.methods.initMainState().rpc()).to.be.rejectedWith(
      web3.SendTransactionError
    );
  });
});
