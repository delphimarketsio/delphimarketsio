/*
 Helper script to ensure the Betting Program's main state PDA is initialized.

 Usage in CI/CD (recommended env vars):
  - ANCHOR_PROVIDER_URL: RPC endpoint (e.g., https://api.devnet.solana.com)
  - ANCHOR_WALLET: Path to a keypair file (JSON array format)

 This script is idempotent: if the main state already exists, it exits successfully.
*/

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const anchor = require("@coral-xyz/anchor");

async function getProvider() {
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL || process.env.RPC_URL;
  const walletPath =
    process.env.ANCHOR_WALLET ||
    process.env.WALLET ||
    process.env.SOLANA_WALLET;

  if (rpcUrl && walletPath) {
    // Build provider manually from env
    const kpRaw = fs.readFileSync(walletPath, { encoding: "utf8" });
    let secret;
    try {
      secret = JSON.parse(kpRaw);
    } catch (e) {
      throw new Error(
        `Failed to parse keypair at ${walletPath}. Ensure it's a JSON array. Original error: ${e.message}`
      );
    }
    const keypair = anchor.web3.Keypair.fromSecretKey(Uint8Array.from(secret));
    const connection = new anchor.web3.Connection(rpcUrl, "confirmed");
    const wallet = new anchor.Wallet(keypair);
    return new anchor.AnchorProvider(connection, wallet, {
      preflightCommitment: "confirmed",
    });
  }

  // Fallback to Anchor's env-based provider (expects ANCHOR_PROVIDER_URL and ANCHOR_WALLET).
  return anchor.AnchorProvider.env();
}

function sha256U8(input) {
  return new Uint8Array(
    crypto.createHash("sha256").update(input).digest().slice(0, 8)
  );
}

function resolveProgramId() {
  // Priority: ENV PROGRAM_ID -> target/deploy/<name>-keypair.json -> IDL address
  if (process.env.PROGRAM_ID) {
    return new anchor.web3.PublicKey(process.env.PROGRAM_ID);
  }

  const programName = process.env.PROGRAM_NAME || "betting_program";
  const keypairPath = path.resolve(
    __dirname,
    "..",
    "target",
    "deploy",
    `${programName}-keypair.json`
  );
  if (fs.existsSync(keypairPath)) {
    try {
      const secret = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
      const kp = anchor.web3.Keypair.fromSecretKey(Uint8Array.from(secret));
      return kp.publicKey;
    } catch (e) {
      console.warn(`Failed to read program keypair: ${e.message}`);
    }
  }

  const idlPath = path.resolve(
    __dirname,
    "..",
    "target",
    "idl",
    "betting_program.json"
  );
  if (fs.existsSync(idlPath)) {
    try {
      const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
      if (idl.address) {
        return new anchor.web3.PublicKey(idl.address);
      }
    } catch (e) {
      console.warn(`Failed to read IDL for program id: ${e.message}`);
    }
  }

  throw new Error(
    "Unable to resolve PROGRAM_ID. Set PROGRAM_ID env or ensure Anchor build artifacts exist."
  );
}

async function ensureMainStateInitialized() {
  // Resolve program id without constructing an Anchor Program
  const programId = resolveProgramId();

  // Provider
  const provider = await getProvider();
  anchor.setProvider(provider);

  // Derive PDAs
  const [mainStatePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("main")],
    programId
  );
  const [solVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("sol-vault")],
    programId
  );

  // Idempotency: if main state exists, exit
  const existing = await provider.connection.getAccountInfo(mainStatePda);
  if (existing) {
    console.log(
      `Main state already initialized at ${mainStatePda.toBase58()}. Skipping.`
    );
    return;
  }

  // Build initMainState instruction manually
  // Anchor discriminator: first 8 bytes of sha256("global:init_main_state")
  const disc = sha256U8("global:init_main_state");
  const data = Buffer.from(disc); // no args

  const keys = [
    { pubkey: provider.wallet.publicKey, isSigner: true, isWritable: true },
    { pubkey: mainStatePda, isSigner: false, isWritable: true },
    { pubkey: solVaultPda, isSigner: false, isWritable: true },
    {
      pubkey: anchor.web3.SystemProgram.programId,
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: anchor.web3.SYSVAR_RENT_PUBKEY,
      isSigner: false,
      isWritable: false,
    },
  ];

  const ix = new anchor.web3.TransactionInstruction({
    programId,
    keys,
    data,
  });

  const tx = new anchor.web3.Transaction().add(ix);
  try {
    const sig = await provider.sendAndConfirm(tx, []);
    console.log(
      `Initialized main state at ${mainStatePda.toBase58()}. Tx: ${sig}`
    );
  } catch (e) {
    const msg = e?.message || String(e);
    if (/already in use|account exists|already initialized/i.test(msg)) {
      console.log(
        `Main state appears to be already initialized (race). Message: ${msg}`
      );
      return;
    }
    console.error("Failed to initialize main state:", e);
    process.exitCode = 1;
  }
}

ensureMainStateInitialized().catch((err) => {
  console.error(err);
  process.exit(1);
});
