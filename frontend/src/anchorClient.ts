import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import idl from "./idl/prediction_pool.json";

// 1. EL NUEVO ID (Copiado de tu última captura)
export const PROGRAM_ID = new PublicKey("FVKpLYidJUzoNrniNNXaYHuPegBq4FefFhP4zJAGcbaX");

export { BN };

export function getProvider(connection: Connection, wallet: WalletContextState) {
  // Si la wallet no está conectada, esto evita el error '_bn'
  if (!wallet.publicKey) return null;

  return new AnchorProvider(connection, wallet as any, {
    commitment: "confirmed",
  });
}

export function getProgram(connection: Connection, wallet: WalletContextState) {
  const provider = getProvider(connection, wallet);
  if (!provider) return null;

  // Inyectamos la dirección en una propiedad llamada 'metadata' 
  // que es lo que busca Anchor 0.29 para no dar el error '_bn'
  const idlWithMetadata = {
    ...idl,
    metadata: {
      address: PROGRAM_ID.toBase58(),
    },
  };

  return new Program(idlWithMetadata as any, PROGRAM_ID, provider);
}
/**
 * Serializa un bigint como 8 bytes little-endian usando DataView nativo.
 * Sin ninguna dependencia de Buffer.
 */
export function u64ToLeBytes(n: bigint): Uint8Array {
  const ab = new ArrayBuffer(8);
  new DataView(ab).setBigUint64(0, n, /* littleEndian */ true);
  return new Uint8Array(ab);
}

/**
 * Deriva las tres PDAs del programa.
 * Usa TextEncoder (nativo del browser) para los seeds de string,
 * evitando cualquier dependencia de Buffer en nuestro código.
 * u64ToLeBytes usa ArrayBuffer/DataView nativo.
 */
export function derivePdas(
  user: PublicKey,
  poolIdBig: bigint,
  programId: PublicKey
) {
  const enc = new TextEncoder();

  const [pool] = PublicKey.findProgramAddressSync(
    [enc.encode("pool"), user.toBuffer(), u64ToLeBytes(poolIdBig)],
    programId
  );
  const [vault] = PublicKey.findProgramAddressSync(
    [enc.encode("vault"), pool.toBuffer()],
    programId
  );
  const [entry] = PublicKey.findProgramAddressSync(
    [enc.encode("entry"), pool.toBuffer(), user.toBuffer()],
    programId
  );
  return { pool, vault, entry };
}

export function explorerTx(sig: string) {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}
