import React, { useMemo, useState, useEffect, useCallback } from "react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { BN, getProgram, derivePdas } from "./anchorClient";

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface PoolAccount {
  publicKey: { toBase58(): string };
  account: {
    creator: { toBase58(): string };
    question: string;
    labelA: string;
    labelB: string;
    entryFeeLamports: { toNumber(): number };
    closeTs: { toNumber(): number };
    status: number;
    totalA: { toNumber(): number };
    totalB: { toNumber(): number };
    isOracleEnabled?: boolean;
    targetPrice?: { toNumber(): number };
  };
}

// ─── Ayudantes ─────────────────────────────────────────────────────────────────
const fmtSol = (lamports: number) => (lamports / 1e9).toFixed(4);
const fmtDate = (ts: number) =>
  new Date(ts * 1000).toLocaleString("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  });
const statusLabel = (s: number) =>
  s === 0 ? "🟢 Abierto" : s === 1 ? "✅ Resuelto" : "🔒 Cerrado";

// ─── Componente principal ─────────────────────────────────────────────────────
export default function App() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const program = useMemo(() => {
    if (connection && wallet.connected) {
      return getProgram(connection, wallet);
    }
    return null;
  }, [connection, wallet]);

  // ── Estado del formulario ──────────────────────────────────────────────────
  const [question, setQuestion] = useState("Will option A win?");
  const [labelA, setLabelA] = useState("A");
  const [labelB, setLabelB] = useState("B");
  const [feeSol, setFeeSol] = useState("0.05");
  const [closeInSec, setCloseInSec] = useState("30");
  const [useOracle, setUseOracle] = useState(false);
  const [targetPrice, setTargetPrice] = useState("");

  // ── Estado de UI ──────────────────────────────────────────────────────────
  const [poolPda, setPoolPda] = useState("");
  const [vaultPda, setVaultPda] = useState("");
  const [lastTx, setLastTx] = useState("");
  const [status, setStatus] = useState("");

  // ── Estado de pools ───────────────────────────────────────────────────────
  const [pools, setPools] = useState<PoolAccount[]>([]);
  const [loadingPools, setLoadingPools] = useState(false);

  // ── fetchPools ─────────────────────────────────────────────────────────────
  const fetchPools = useCallback(async () => {
    if (!program) return;
    setLoadingPools(true);
    try {
      const all = await (program.account as any).pool.all();
      // Ordenar por closeTs descendente (más reciente primero)
      all.sort(
        (a: PoolAccount, b: PoolAccount) =>
          b.account.closeTs.toNumber() - a.account.closeTs.toNumber()
      );
      setPools(all);
    } catch (e) {
      console.error("Error al cargar pools:", e);
    } finally {
      setLoadingPools(false);
    }
  }, [program]);

  // Carga automática cuando program está listo
  useEffect(() => {
    if (program) {
      console.log("¡Programa listo!", program.programId.toBase58());
      fetchPools();
    }
  }, [program, fetchPools]);

  // ── onCreatePool ──────────────────────────────────────────────────────────
  async function onCreatePool() {
    try {
      if (!program || !wallet.publicKey) {
        alert("Por favor conecta tu wallet de Phantom primero.");
        return;
      }

      setStatus("Armando la transacción...");

      // ID único generado automáticamente con el timestamp actual (ms)
      const uniquePoolId = new BN(Date.now());
      const feeLamportsBN = new BN(Math.floor(Number(feeSol) * 1_000_000_000));
      const closeTsBN = new BN(Math.floor(Date.now() / 1000) + Number(closeInSec));
      const targetPriceBN = new BN(Math.floor(Number(targetPrice || "0") * 100000000));
      const { pool, vault } = derivePdas(wallet.publicKey, BigInt(uniquePoolId.toString()), program.programId);

      setPoolPda(pool.toBase58());
      setVaultPda(vault.toBase58());

      // Interceptor de debug — atrapa Buffer.from(undefined) de Anchor internamente
      if ((globalThis as any).Buffer) {
        const originalFrom = (globalThis as any).Buffer.from;
        (globalThis as any).Buffer.from = function (val: any, enc: any, len: any) {
          if (val === undefined) {
            console.error("🚨 Buffer.from(undefined) detectado:");
            console.trace();
            return originalFrom.call((globalThis as any).Buffer, "", enc, len);
          }
          return originalFrom.call((globalThis as any).Buffer, val, enc, len);
        };
      }

      const sig = await program.methods
        .createPool(uniquePoolId, question, labelA, labelB, feeLamportsBN, closeTsBN, targetPriceBN, useOracle)
        .accounts({
          creator: wallet.publicKey,
          pool,
          vault,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      setLastTx(sig);
      setStatus("✅ Pool creado exitosamente");

      // Actualizar lista tras crear
      await fetchPools();
    } catch (e: any) {
      console.error("Error al crear pool:", e);
      setStatus("❌ Error: " + (e?.message ?? String(e)));
    }
  }

  // ── handleJoinPool ────────────────────────────────────────────────────────
  async function handleJoinPool(poolPubkey: PublicKey, option: number) {
    if (!program || !wallet.publicKey) {
      alert("Conecta tu wallet primero.");
      return;
    }

    try {
      const enc = new TextEncoder();

      // Deriva la vault PDA: seeds = ["vault", poolPubkey]
      const [vaultPda] = PublicKey.findProgramAddressSync(
        [enc.encode("vault"), poolPubkey.toBuffer()],
        program.programId
      );

      // Deriva la entry PDA: seeds = ["entry", poolPubkey, userPubkey]
      const [entryPda] = PublicKey.findProgramAddressSync(
        [enc.encode("entry"), poolPubkey.toBuffer(), wallet.publicKey.toBuffer()],
        program.programId
      );

      console.log(`Votando opción ${option} en pool ${poolPubkey.toBase58()}...`);

      const sig = await program.methods
        .joinPool(option)
        .accounts({
          user: wallet.publicKey,
          pool: poolPubkey,
          vault: vaultPda,
          entry: entryPda,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      console.log("✅ Voto registrado:", sig);
      alert(`✅ Voto registrado. Tx: ${sig.slice(0, 20)}…`);

      // Actualizar pools para reflejar los nuevos totales
      await fetchPools();
    } catch (e: any) {
      console.error("Error al votar:", e);
      alert("❌ Error al votar: " + (e?.message ?? String(e)));
    }
  }

  // ── handleResolveWithPyth ────────────────────────────────────────────────
  async function handleResolveWithPyth(poolPubkey: PublicKey) {
    if (!program || !wallet.publicKey) {
      alert("Conecta tu wallet primero.");
      return;
    }

    try {
      const PYTH_PRICE_FEED_DEVNET = new PublicKey("J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix");
      const sig = await program.methods
        .resolveWithPyth()
        .accounts({
          payer: wallet.publicKey,
          pool: poolPubkey,
          pythPriceFeed: PYTH_PRICE_FEED_DEVNET,
        } as any)
        .rpc();

      console.log("✅ Pool resuelta con Pyth:", sig);
      alert(`✅ Pool resuelta con Pyth. Tx: ${sig.slice(0, 20)}…`);
      await fetchPools();
    } catch (e: any) {
      console.error("Error al resolver con Pyth:", e);
      alert("❌ Error al resolver con Pyth: " + (e?.message ?? String(e)));
    }
  }

  // ── handleResolvePool ────────────────────────────────────────────────
  async function handleResolvePool(poolPubkey: PublicKey, winningOption: number) {
    if (!program || !wallet.publicKey) {
      alert("Conecta tu wallet primero.");
      return;
    }

    try {
      const sig = await program.methods
        .resolvePool(winningOption)
        .accounts({
          creator: wallet.publicKey,
          pool: poolPubkey,
        } as any)
        .rpc();

      console.log("✅ Pool resuelta:", sig);
      alert(`✅ Pool resuelta. Ganador declarado. Tx: ${sig.slice(0, 20)}…`);
      await fetchPools();
    } catch (e: any) {
      console.error("Error al resolver pool:", e);
      alert("❌ Error al resolver: " + (e?.message ?? String(e)));
    }
  }

  // ── handleClaim ────────────────────────────────────────────────────────
  async function handleClaim(poolPubkey: PublicKey) {
    if (!program || !wallet.publicKey) {
      alert("Conecta tu wallet primero.");
      return;
    }
    try {
      const enc = new TextEncoder();

      const [vaultPda] = PublicKey.findProgramAddressSync(
        [enc.encode("vault"), poolPubkey.toBuffer()],
        program.programId
      );
      const [entryPda] = PublicKey.findProgramAddressSync(
        [enc.encode("entry"), poolPubkey.toBuffer(), wallet.publicKey.toBuffer()],
        program.programId
      );

      const sig = await program.methods
        .claim()
        .accounts({
          user: wallet.publicKey,
          pool: poolPubkey,
          vault: vaultPda,
          entry: entryPda,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      console.log("✅ Premio reclamado:", sig);
      alert(`✅ Premio reclamado. Tx: ${sig.slice(0, 20)}…`);
      await fetchPools();
    } catch (e: any) {
      console.error("Error al reclamar:", e);
      alert("❌ Error al reclamar: " + (e?.message ?? String(e)));
    }
  }

  // ─── Estilos base ─────────────────────────────────────────────────────
  // Glassmorphism card — fondo semi-transparente, blur y borde neón
  const card: React.CSSProperties = {
    background: "rgba(15, 23, 42, 0.75)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    borderRadius: 16,
    padding: "24px",
    border: "1px solid rgba(139, 92, 246, 0.45)",
    boxShadow: "0 4px 32px rgba(139, 92, 246, 0.12), inset 0 1px 0 rgba(255,255,255,0.06)",
  };

  const inputSt: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid rgba(139, 92, 246, 0.35)",
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    color: "#e2e8f0",
    boxSizing: "border-box",
    fontSize: 14,
    outline: "none",
    transition: "border-color 0.2s",
  };

  const labelSt: React.CSSProperties = {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: "#94a3b8",
    marginBottom: 6,
  };

  // ─── JSX ──────────────────────────────────────────────────────────────────
  return (
    <div style={{
      background: "linear-gradient(135deg, #0f172a 0%, #000000 100%)",
      minHeight: "100vh", color: "white", padding: "40px 20px",
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 36 }}>
          <div>
            <h1 style={{
              margin: 0,
              fontSize: 28,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              background: "linear-gradient(to right, #e2e8f0, #a5b4fc)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              textShadow: "none",
              filter: "drop-shadow(0 0 12px rgba(139, 92, 246, 0.6))",
            }}>⬡ Prediction Pool</h1>
            <p style={{ margin: "6px 0 0", color: "#64748b", fontSize: 13, fontFamily: "monospace" }}>
              Devnet &bull; {program ? program.programId.toBase58().slice(0, 16) + "…" : "// wallet desconectada"}
            </p>
          </div>
          <WalletMultiButton style={{
            background: "linear-gradient(to right, #581c87, #312e81)",
            border: "1px solid rgba(139, 92, 246, 0.5)",
            boxShadow: "0 0 12px rgba(139, 92, 246, 0.35)",
          }} />
        </div>

        {/* ── Formulario ── */}
        <div style={{ ...card, marginBottom: 24 }}>
          <h2 style={{
            color: "transparent",
            background: "linear-gradient(to right, #22d3ee, #a78bfa)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            marginTop: 0, marginBottom: 22,
            fontSize: 18, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase",
          }}>// Create Pool</h2>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelSt}>Entry Fee (SOL)</label>
              <input type="number" step="0.01" value={feeSol} onChange={e => setFeeSol(e.target.value)} style={inputSt} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelSt}>Question</label>
              <input value={question} onChange={e => setQuestion(e.target.value)} style={inputSt} />
            </div>
            <div>
              <label style={labelSt}>Label A</label>
              <input value={labelA} onChange={e => setLabelA(e.target.value)} style={inputSt} />
            </div>
            <div>
              <label style={labelSt}>Label B</label>
              <input value={labelB} onChange={e => setLabelB(e.target.value)} style={inputSt} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelSt}>Close in (seconds)</label>
              <input type="number" value={closeInSec} onChange={e => setCloseInSec(e.target.value)} style={inputSt} />
            </div>

            <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 10 }}>
              <input type="checkbox" id="useOracle" checked={useOracle} onChange={e => setUseOracle(e.target.checked)} style={{ width: 18, height: 18, accentColor: "#8b5cf6", cursor: "pointer" }} />
              <label htmlFor="useOracle" style={{ ...labelSt, marginBottom: 0, cursor: "pointer" }}>¿Usar Oráculo de Pyth?</label>
            </div>
            {useOracle && (
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={labelSt}>Precio Objetivo (USD)</label>
                <input type="number" step="0.01" value={targetPrice} onChange={e => setTargetPrice(e.target.value)} style={inputSt} placeholder="Ej. 165.50" />
              </div>
            )}
          </div>

          <button
            onClick={onCreatePool}
            style={{
              width: "100%", padding: "14px 0", border: "none", borderRadius: 10,
              background: "linear-gradient(to right, #8b5cf6, #d946ef)",
              color: "white", fontSize: 15, fontWeight: 700, cursor: "pointer",
              letterSpacing: "0.05em",
              boxShadow: "0 0 15px rgba(139, 92, 246, 0.7), 0 0 30px rgba(217, 70, 239, 0.35)",
              transition: "box-shadow 0.2s, transform 0.1s",
            }}
            onMouseOver={e => {
              e.currentTarget.style.boxShadow = "0 0 25px rgba(139, 92, 246, 0.95), 0 0 50px rgba(217, 70, 239, 0.6)";
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseOut={e => {
              e.currentTarget.style.boxShadow = "0 0 15px rgba(139, 92, 246, 0.7), 0 0 30px rgba(217, 70, 239, 0.35)";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            ⚡ CREATE POOL
          </button>

          {status && (
            <p style={{ margin: "12px 0 0", fontSize: 13, color: status.startsWith("✅") ? "#4ade80" : status.startsWith("❌") ? "#f87171" : "#94a3b8" }}>
              {status}
            </p>
          )}
        </div>

        {/* ── PDAs derivadas ── */}
        {(poolPda) && (
          <div style={{ ...card, marginBottom: 16, fontSize: 12 }}>
            <h4 style={{ margin: "0 0 8px", color: "#cbd5e1" }}>PDAs derivadas</h4>
            {[["Pool", poolPda], ["Vault", vaultPda]].map(([k, v]) => (
              <p key={k} style={{ margin: "3px 0", fontFamily: "monospace" }}>
                <span style={{ color: "#64748b", display: "inline-block", width: 40 }}>{k}:</span>
                <span style={{ color: "#f8fafc" }}>{v}</span>
              </p>
            ))}
          </div>
        )}

        {/* ── Última tx ── */}
        {lastTx && (
          <div style={{ ...card, marginBottom: 24, border: "1px solid #059669", backgroundColor: "#064e3b" }}>
            <h4 style={{ margin: "0 0 8px", color: "#34d399" }}>✅ Transacción Exitosa</h4>
            <a href={`https://explorer.solana.com/tx/${lastTx}?cluster=devnet`} target="_blank" rel="noreferrer"
              style={{ color: "#a7f3d0", fontSize: 13, wordBreak: "break-all" }}>
              Ver en Solana Explorer ↗
            </a>
          </div>
        )}

        {/* ══ Lista de Pools ══ */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h2 style={{ margin: 0, color: "#38bdf8" }}>
            Active Pools {pools.length > 0 && <span style={{ color: "#64748b", fontSize: 16 }}>({pools.length})</span>}
          </h2>
          <button
            onClick={fetchPools}
            disabled={!program || loadingPools}
            style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid #334155", backgroundColor: "#1e293b", color: "#94a3b8", cursor: program ? "pointer" : "not-allowed", fontSize: 13 }}
          >
            {loadingPools ? "Cargando…" : "↻ Refrescar"}
          </button>
        </div>

        {!program && (
          <p style={{ color: "#64748b", textAlign: "center", padding: 32 }}>
            Conecta tu wallet para ver los pools.
          </p>
        )}

        {program && !loadingPools && pools.length === 0 && (
          <p style={{ color: "#64748b", textAlign: "center", padding: 32 }}>
            No hay pools creados todavía.
          </p>
        )}

        <div style={{ display: "grid", gap: 16 }}>
          {pools.map((p) => {
            const acc = p.account;
            const feeLamports = acc.entryFeeLamports.toNumber();
            const closeTs = acc.closeTs.toNumber();
            const isOpen = acc.status === 0;
            // Pool desierta: expirada pero sin ningún voto en ninguna opción
            const isDeserted = Date.now() > closeTs * 1000
              && acc.totalA.toNumber() === 0
              && acc.totalB.toNumber() === 0;

            return (
              <div key={p.publicKey.toBase58()} style={{ ...card, display: "grid", gap: 14 }}>
                {/* Cabecera */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <h3 style={{ margin: 0, color: "#f1f5f9", fontSize: 16, lineHeight: 1.4 }}>{acc.question}</h3>
                  {/* Badge de estado con color neón por tipo */}
                  <span style={{
                    fontSize: 11, whiteSpace: "nowrap", fontWeight: 700,
                    letterSpacing: "0.05em", padding: "3px 8px", borderRadius: 20,
                    ...(isDeserted
                      ? { color: "#64748b", background: "rgba(100,116,139,0.15)", border: "1px solid rgba(100,116,139,0.3)" }
                      : isOpen
                        ? {
                          color: "#4ade80", background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.35)",
                          textShadow: "0 0 8px rgba(74,222,128,0.7)"
                        }
                        : acc.status === 1
                          ? {
                            color: "#10b981", background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.4)",
                            textShadow: "0 0 8px rgba(16,185,129,0.8)"
                          }
                          : {
                            color: "#fb923c", background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.4)",
                            textShadow: "0 0 8px rgba(251,146,60,0.7)"
                          })
                  }}>
                    {isDeserted ? "🚫 Desierta" : statusLabel(acc.status)}
                  </span>
                </div>

                {/* Meta */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 13 }}>
                  {/* Entry fee */}
                  <div style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(99,102,241,0.25)", borderRadius: 10, padding: "10px 14px" }}>
                    <span style={{ color: "#64748b", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>Entry fee</span>
                    <p style={{ margin: "4px 0 0", color: "#c7d2fe", fontWeight: 700 }}>{fmtSol(feeLamports)} SOL</p>
                  </div>
                  {/* Cierra */}
                  <div style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(99,102,241,0.25)", borderRadius: 10, padding: "10px 14px" }}>
                    <span style={{ color: "#64748b", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>Cierra</span>
                    <p style={{ margin: "4px 0 0", color: "#e2e8f0" }}>{fmtDate(closeTs)}</p>
                  </div>
                  {/* Pool A */}
                  <div style={{ background: "rgba(6,182,212,0.06)", border: "1px solid rgba(6,182,212,0.3)", borderRadius: 10, padding: "10px 14px" }}>
                    <span style={{ color: "#22d3ee", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>Pool A &mdash; {acc.labelA}</span>
                    <p style={{ margin: "4px 0 0", color: "#10b981", fontWeight: 700, fontSize: 15 }}>{fmtSol(acc.totalA.toNumber())} <span style={{ fontSize: 11, fontWeight: 400, color: "#34d399" }}>SOL</span></p>
                  </div>
                  {/* Pool B */}
                  <div style={{ background: "rgba(217,70,239,0.06)", border: "1px solid rgba(217,70,239,0.3)", borderRadius: 10, padding: "10px 14px" }}>
                    <span style={{ color: "#e879f9", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>Pool B &mdash; {acc.labelB}</span>
                    <p style={{ margin: "4px 0 0", color: "#10b981", fontWeight: 700, fontSize: 15 }}>{fmtSol(acc.totalB.toNumber())} <span style={{ fontSize: 11, fontWeight: 400, color: "#34d399" }}>SOL</span></p>
                  </div>
                </div>

                {/* Botones de voto */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {/* Botón A — cian/azul neón */}
                  <button
                    disabled={!isOpen || !wallet.publicKey}
                    onClick={() => handleJoinPool(p.publicKey as unknown as PublicKey, 0)}
                    style={{
                      padding: "11px 0", borderRadius: 10, border: "none", fontWeight: 700, fontSize: 13,
                      letterSpacing: "0.04em",
                      cursor: isOpen && wallet.publicKey ? "pointer" : "not-allowed",
                      background: isOpen && wallet.publicKey
                        ? "linear-gradient(to right, #3b82f6, #06b6d4)"
                        : "rgba(30,41,59,0.6)",
                      color: isOpen && wallet.publicKey ? "white" : "#475569",
                      boxShadow: isOpen && wallet.publicKey
                        ? "0 0 12px rgba(6,182,212,0.55), 0 0 24px rgba(59,130,246,0.3)"
                        : "none",
                      transition: "box-shadow 0.2s, transform 0.1s",
                    }}
                    onMouseOver={e => {
                      if (isOpen && wallet.publicKey) {
                        e.currentTarget.style.boxShadow = "0 0 20px rgba(6,182,212,0.85), 0 0 40px rgba(59,130,246,0.5)";
                        e.currentTarget.style.transform = "translateY(-1px)";
                      }
                    }}
                    onMouseOut={e => {
                      if (isOpen && wallet.publicKey) {
                        e.currentTarget.style.boxShadow = "0 0 12px rgba(6,182,212,0.55), 0 0 24px rgba(59,130,246,0.3)";
                        e.currentTarget.style.transform = "translateY(0)";
                      }
                    }}
                  >
                    ▲ {acc.labelA}
                  </button>
                  {/* Botón B — magenta/púrpura neón */}
                  <button
                    disabled={!isOpen || !wallet.publicKey}
                    onClick={() => handleJoinPool(p.publicKey as unknown as PublicKey, 1)}
                    style={{
                      padding: "11px 0", borderRadius: 10, border: "none", fontWeight: 700, fontSize: 13,
                      letterSpacing: "0.04em",
                      cursor: isOpen && wallet.publicKey ? "pointer" : "not-allowed",
                      background: isOpen && wallet.publicKey
                        ? "linear-gradient(to right, #d946ef, #8b5cf6)"
                        : "rgba(30,41,59,0.6)",
                      color: isOpen && wallet.publicKey ? "white" : "#475569",
                      boxShadow: isOpen && wallet.publicKey
                        ? "0 0 12px rgba(217,70,239,0.55), 0 0 24px rgba(139,92,246,0.3)"
                        : "none",
                      transition: "box-shadow 0.2s, transform 0.1s",
                    }}
                    onMouseOver={e => {
                      if (isOpen && wallet.publicKey) {
                        e.currentTarget.style.boxShadow = "0 0 20px rgba(217,70,239,0.85), 0 0 40px rgba(139,92,246,0.5)";
                        e.currentTarget.style.transform = "translateY(-1px)";
                      }
                    }}
                    onMouseOut={e => {
                      if (isOpen && wallet.publicKey) {
                        e.currentTarget.style.boxShadow = "0 0 12px rgba(217,70,239,0.55), 0 0 24px rgba(139,92,246,0.3)";
                        e.currentTarget.style.transform = "translateY(0)";
                      }
                    }}
                  >
                    ▼ {acc.labelB}
                  </button>
                </div>

                {/* Pool address */}
                <p style={{ margin: 0, fontSize: 11, color: "#475569", fontFamily: "monospace" }}>
                  {p.publicKey.toBase58()}
                </p>

                {/* Botones de resolución */}
                {acc.status === 0 && !isDeserted && (
                  <div style={{ borderTop: "1px solid rgba(139,92,246,0.2)", paddingTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {acc.isOracleEnabled ? (
                      <button
                        onClick={() => handleResolveWithPyth(p.publicKey as unknown as PublicKey)}
                        style={{
                          gridColumn: "1 / -1", padding: "12px 0", borderRadius: 10, fontWeight: 800, fontSize: 13,
                          letterSpacing: "0.04em", cursor: "pointer", border: "none",
                          background: "linear-gradient(to right, #3b82f6, #8b5cf6)",
                          color: "white",
                          boxShadow: "0 0 15px rgba(139,92,246,0.6)",
                          transition: "box-shadow 0.2s, transform 0.1s",
                        }}
                      >
                        ⚡ RESOLVER AUTOMÁTICAMENTE CON PYTH
                      </button>
                    ) : (
                      wallet.publicKey?.toBase58() === acc.creator.toBase58() && (
                        <>
                          <p style={{
                            gridColumn: "1 / -1", margin: "0 0 8px", fontSize: 11,
                            color: "#fbbf24", fontWeight: 700, letterSpacing: "0.06em",
                            textShadow: "0 0 8px rgba(251,191,36,0.6)"
                          }}>
                            ⚡ SOLO TÚ &mdash; DECLARAR GANADOR:
                          </p>
                          {/* Botón ganador A — gradiente dorado */}
                          <button
                            onClick={() => handleResolvePool(p.publicKey as unknown as PublicKey, 0)}
                            style={{
                              padding: "11px 0", borderRadius: 10, fontWeight: 800, fontSize: 13,
                              letterSpacing: "0.05em", cursor: "pointer", border: "none",
                              background: "linear-gradient(to right, #f59e0b, #eab308)",
                              color: "#1c1917",
                              boxShadow: "0 0 15px rgba(234,179,8,0.7), 0 0 30px rgba(245,158,11,0.35)",
                              transition: "box-shadow 0.2s, transform 0.1s",
                            }}
                            onMouseOver={e => {
                              e.currentTarget.style.boxShadow = "0 0 25px rgba(234,179,8,1), 0 0 50px rgba(245,158,11,0.6)";
                              e.currentTarget.style.transform = "translateY(-1px)";
                            }}
                            onMouseOut={e => {
                              e.currentTarget.style.boxShadow = "0 0 15px rgba(234,179,8,0.7), 0 0 30px rgba(245,158,11,0.35)";
                              e.currentTarget.style.transform = "translateY(0)";
                            }}
                          >
                            🏆 {acc.labelA}
                          </button>
                          {/* Botón ganador B — gradiente dorado */}
                          <button
                            onClick={() => handleResolvePool(p.publicKey as unknown as PublicKey, 1)}
                            style={{
                              padding: "11px 0", borderRadius: 10, fontWeight: 800, fontSize: 13,
                              letterSpacing: "0.05em", cursor: "pointer", border: "none",
                              background: "linear-gradient(to right, #eab308, #d97706)",
                              color: "#1c1917",
                              boxShadow: "0 0 15px rgba(234,179,8,0.7), 0 0 30px rgba(245,158,11,0.35)",
                              transition: "box-shadow 0.2s, transform 0.1s",
                            }}
                            onMouseOver={e => {
                              e.currentTarget.style.boxShadow = "0 0 25px rgba(234,179,8,1), 0 0 50px rgba(245,158,11,0.6)";
                              e.currentTarget.style.transform = "translateY(-1px)";
                            }}
                            onMouseOut={e => {
                              e.currentTarget.style.boxShadow = "0 0 15px rgba(234,179,8,0.7), 0 0 30px rgba(245,158,11,0.35)";
                              e.currentTarget.style.transform = "translateY(0)";
                            }}
                          >
                            🏆 {acc.labelB}
                          </button>
                        </>
                      )
                    )}
                  </div>
                )}

                {/* Botón Reclamar Premio — glow esmeralda cuando activo */}
                {wallet.publicKey && (
                  <div style={{ borderTop: "1px solid rgba(139,92,246,0.2)", paddingTop: 12 }}>
                    <button
                      disabled={acc.status !== 1}
                      onClick={() => handleClaim(p.publicKey as unknown as PublicKey)}
                      style={{
                        width: "100%", padding: "12px 0", borderRadius: 10, border: "none",
                        fontWeight: 800, fontSize: 14, letterSpacing: "0.05em",
                        cursor: acc.status === 1 ? "pointer" : "not-allowed",
                        background: acc.status === 1
                          ? "linear-gradient(to right, #059669, #10b981)"
                          : "rgba(15,23,42,0.6)",
                        color: acc.status === 1 ? "white" : "#475569",
                        opacity: acc.status === 1 ? 1 : 0.5,
                        boxShadow: acc.status === 1
                          ? "0 0 15px rgba(16,185,129,0.7), 0 0 30px rgba(5,150,105,0.35)"
                          : "none",
                        transition: "box-shadow 0.2s, transform 0.1s",
                      }}
                      onMouseOver={e => {
                        if (acc.status === 1) {
                          e.currentTarget.style.boxShadow = "0 0 25px rgba(16,185,129,1), 0 0 50px rgba(5,150,105,0.6)";
                          e.currentTarget.style.transform = "translateY(-1px)";
                        }
                      }}
                      onMouseOut={e => {
                        if (acc.status === 1) {
                          e.currentTarget.style.boxShadow = "0 0 15px rgba(16,185,129,0.7), 0 0 30px rgba(5,150,105,0.35)";
                          e.currentTarget.style.transform = "translateY(0)";
                        }
                      }}
                    >
                      {acc.status === 1 ? "💰 RECLAMAR PREMIO" : "💰 Reclamar (pool no resuelta aún)"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}