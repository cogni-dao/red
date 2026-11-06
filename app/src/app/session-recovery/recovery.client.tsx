// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

"use client";
import { getSession, signOut } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { useAccount, useConfig, useConnections, useDisconnect } from "wagmi";
import { Button } from "@/components";

async function credentialAbsent(): Promise<boolean> {
  const response = await fetch("/api/auth/session-recovery", { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error("verification failed");
  const data: unknown = await response.json();
  if (!data || typeof data !== "object" || !("effectiveSessionCredentialPresent" in data) || typeof data.effectiveSessionCredentialPresent !== "boolean") throw new Error("verification failed");
  return !data.effectiveSessionCredentialPresent;
}

export function Recovery({ initialCredential }: { initialCredential: "present" | "absent" | "unavailable" }) {
  const config = useConfig();
  const account = useAccount();
  const connections = useConnections();
  const accountRef = useRef(account);
  const connectionsRef = useRef(connections);
  accountRef.current = account;
  connectionsRef.current = connections;
  const { disconnectAsync } = useDisconnect();
  const [phase, setPhase] = useState<"checking" | "choice" | "wallet" | "ready">("checking");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [walletHydrated, setWalletHydrated] = useState(false);
  useEffect(() => {
    const store = config._internal.store.persist;
    const unsubscribe = store.onFinishHydration(() => setWalletHydrated(true));
    if (store.hasHydrated()) setWalletHydrated(true);
    return unsubscribe;
  }, [config]);
  useEffect(() => {
    if (initialCredential === "unavailable") {
      setError("Could not check your session. Try again.");
      setPhase("choice");
      return;
    }
    if (initialCredential === "present") {
      setPhase("choice");
      return;
    }
    if (!walletHydrated) return;
    let cancelled = false;
    // The server read does not establish browser cookie or hydrated wallet state.
    void credentialAbsent().then((absent) => {
      if (cancelled) return;
      if (!absent) setPhase("choice");
      else if (accountRef.current.status === "disconnected" && connectionsRef.current.length === 0) setPhase("ready");
      else setPhase("wallet");
    }).catch(() => { if (!cancelled) { setError("Could not check your session. Try again."); setPhase("choice"); } });
    return () => { cancelled = true; };
  }, [initialCredential, walletHydrated]);
  async function finishWallet() {
    if (!(await credentialAbsent())) { setPhase("choice"); throw new Error("session returned"); }
    const state = accountRef.current;
    if (!walletHydrated) throw new Error("wallet not hydrated");
    if (state.status === "connecting" || state.status === "reconnecting") throw new Error("wallet is connecting");
    const connector = connectionsRef.current[0]?.connector;
    if (connector) await disconnectAsync({ connector });
    else if (state.status === "connected") await disconnectAsync();
    // The wagmi store may update after disconnectAsync resolves; require a new render
    // and an explicit retry rather than inferring absence from the promise.
    if (accountRef.current.status !== "disconnected" || connectionsRef.current.length !== 0) { setPhase("wallet"); return; }
    if (!(await credentialAbsent())) { setPhase("choice"); throw new Error("session returned"); }
    await getSession({ broadcast: true });
    window.location.assign("/session-recovery");
  }
  async function run(signOutFirst: boolean) {
    setBusy(true); setError("");
    try {
      if (signOutFirst) {
        const expected = new URL("/session-recovery", window.location.origin).href;
        const result = await signOut({ redirect: false, callbackUrl: expected });
        if (!result || typeof result.url !== "string" || new URL(result.url, window.location.origin).href !== expected) throw new Error("signout refused");
        if (!(await credentialAbsent())) throw new Error("credential remains");
        setPhase("wallet");
      }
      await finishWallet();
    } catch { setError(signOutFirst ? "Could not sign out. Try again." : "Could not finish recovery. Try again."); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-lg space-y-4 p-6">
    <h1 className="text-2xl font-semibold">Session recovery</h1>
    {error && <p role="alert">{error}</p>}
    {phase === "checking" && <p>Checking session…</p>}
    {phase === "choice" && <><p>Your session cannot access an account here. Sign in again to continue.</p><Button disabled={busy} onClick={() => void run(true)}>Sign out and continue</Button></>}
    {phase === "wallet" && <><p>Disconnect your wallet to continue.</p><Button disabled={busy} onClick={() => void run(false)}>Continue recovery</Button></>}
    {phase === "ready" && <><p>No active session. Sign in to continue.</p><Button disabled={busy} onClick={() => {
      setBusy(true); setError("");
      void credentialAbsent().then((absent) => {
        if (!absent) { setPhase("choice"); return; }
        if (!walletHydrated || accountRef.current.status !== "disconnected" || connectionsRef.current.length !== 0) { setPhase("wallet"); return; }
        window.location.assign("/");
      }).catch(() => setError("Could not check your session. Try again.")).finally(() => setBusy(false));
    }}>Sign in</Button></>}
  </main>;
}
