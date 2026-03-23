import BN from "bn.js";
import * as web3 from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import type { PredictionPool } from "../target/types/prediction_pool";

// Configure the client to use the local cluster
anchor.setProvider(anchor.AnchorProvider.env());

const program = anchor.workspace.PredictionPool as anchor.Program<PredictionPool>;


async function chainNowSec(): Promise<number> {
  const slot = await program.provider.connection.getSlot("confirmed");
  const t = await program.provider.connection.getBlockTime(slot);
  return t ?? Math.floor(Date.now() / 1000);
}

async function waitUntil(ts: number) {
  while (true) {
    const t = await chainNowSec();
    if (t >= ts) return;
    // "yield" without setTimeout
    await program.provider.connection.getLatestBlockhash("confirmed");
  }
}

(async () => {
  console.log("Wallet:", program.provider.publicKey.toBase58());

  const bal = await program.provider.connection.getBalance(program.provider.publicKey);
  console.log("Balance:", bal / web3.LAMPORTS_PER_SOL, "SOL");

  // --- Unique poolId (avoid collisions)
  const poolIdNum = Date.now(); // fits u64
  const poolId = new anchor.BN(poolIdNum);

  const question = "Will option A win?";
  const labelA = "A";
  const labelB = "B";
  const entryFeeLamports = new anchor.BN(0.05 * web3.LAMPORTS_PER_SOL); // 0.05 SOL

  const now = await chainNowSec();
  const closeTsNum = now + 8; // closes in ~8s
  const closeTs = new anchor.BN(closeTsNum);

  // --- PDAs
  const [poolPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), program.provider.publicKey.toBuffer(), poolId.toArrayLike(Buffer, "le", 8)],
    program.programId
  );

  const [vaultPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), poolPda.toBuffer()],
    program.programId
  );

  const [entryPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("entry"), poolPda.toBuffer(), program.provider.publicKey.toBuffer()],
    program.programId
  );

  console.log("Pool PDA:", poolPda.toBase58());
  console.log("Vault PDA:", vaultPda.toBase58());
  console.log("Entry PDA:", entryPda.toBase58());

  // 1) create_pool
  console.log("\n1) create_pool...");
  const tx1 = await program.methods
    .createPool(poolId, question, labelA, labelB, entryFeeLamports, closeTs)
    .accounts({
      creator: program.provider.publicKey,
      pool: poolPda,
      vault: vaultPda,
      systemProgram: web3.SystemProgram.programId,
    })
    .rpc();
  console.log("create_pool tx:", tx1);

  // 2) join_pool (A=0)
  console.log("\n2) join_pool (A)...");
  const tx2 = await program.methods
    .joinPool(0)
    .accounts({
      user: program.provider.publicKey,
      pool: poolPda,
      vault: vaultPda,
      entry: entryPda,
      systemProgram: web3.SystemProgram.programId,
    })
    .rpc();
  console.log("join_pool tx:", tx2);

  // Confirm entry exists
  const info = await program.provider.connection.getAccountInfo(entryPda);
  console.log("ENTRY exists?", !!info, "owner:", info?.owner?.toBase58(), "len:", info?.data?.length);

  // wait close
  console.log(`\nWaiting until closeTs=${closeTsNum} (on-chain)...`);
  await waitUntil(closeTsNum);
  console.log("Closed ✅");

  // 3) resolve_pool (winner A=0)
  console.log("\n3) resolve_pool (winner A=0)...");
  const tx3 = await program.methods
    .resolvePool(0)
    .accounts({ creator: program.provider.publicKey, pool: poolPda })
    .rpc();
  console.log("resolve_pool tx:", tx3);

  // 4) claim
  console.log("\n4) claim...");
  const tx4 = await program.methods
    .claim()
    .accounts({
      user: program.provider.publicKey,
      pool: poolPda,
      vault: vaultPda,
      entry: entryPda,
      systemProgram: web3.SystemProgram.programId,
    })
    .rpc();
  console.log("claim tx:", tx4);

  const bal2 = await program.provider.connection.getBalance(program.provider.publicKey);
  console.log("\nFinal balance:", bal2 / web3.LAMPORTS_PER_SOL, "SOL");
})();