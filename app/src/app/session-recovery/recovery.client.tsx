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
  const attempt = useRef(0);
  useEffect(() => () => { attempt.current++; }, []);
  const [walletHydrated, setWalletHydrated] = useState(false);
  useEffect(() => {
    // Wagmi 2.19.5 runs Zustand persist hydration inside its SSR provider.
    // Its exposed store type can collapse to never with the installed Zustand
    // types, so inspect the runtime API and fail closed if it is unavailable.
    const store: unknown = config._internal.store;
    if (!store || typeof store !== "object" || !("persist" in store)) return;
    const persist = store.persist;
    if (!persist || typeof persist !== "object" || !("onFinishHydration" in persist) || typeof persist.onFinishHydration !== "function" || !("hasHydrated" in persist) || typeof persist.hasHydrated !== "function") return;
    const unsubscribe: unknown = persist.onFinishHydration(() => setWalletHydrated(true));
    if (persist.hasHydrated()) setWalletHydrated(true);
    return () => { if (typeof unsubscribe === "function") unsubscribe(); };
  }, [config]);
  useEffect(() => {
    if (attempt.current !== 0) return;
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
  async function finishWallet(current: number) {
    const active = () => attempt.current === current;
    const absent = await credentialAbsent();
    if (!active()) return;
    if (!absent) { setPhase("choice"); throw new Error("session returned"); }
    const state = accountRef.current;
    if (!walletHydrated) throw new Error("wallet not hydrated");
    if (state.status === "connecting" || state.status === "reconnecting") throw new Error("wallet is connecting");
    const connector = connectionsRef.current[0]?.connector;
    if (connector) await disconnectAsync({ connector });
    else if (state.status === "connected") await disconnectAsync();
    if (!active()) return;
    if (accountRef.current.status !== "disconnected" || connectionsRef.current.length !== 0) { setPhase("wallet"); return; }
    const stillAbsent = await credentialAbsent();
    if (!active()) return;
    if (!stillAbsent) { setPhase("choice"); throw new Error("session returned"); }
    await getSession({ broadcast: true });
    if (!active()) return;
    window.location.assign("/session-recovery");
  }
  async function run(signOutFirst: boolean) {
    const current = ++attempt.current;
    const active = () => attempt.current === current;
    setBusy(true); setError("");
    try {
      if (signOutFirst) {
        const expected = new URL("/session-recovery", window.location.origin).href;
        const result = await signOut({ redirect: false, callbackUrl: expected });
        if (!active()) return;
        if (!result || typeof result.url !== "string" || new URL(result.url, window.location.origin).href !== expected) throw new Error("signout refused");
        const absent = await credentialAbsent();
        if (!active()) return;
        if (!absent) throw new Error("credential remains");
        setPhase("wallet");
      }
      await finishWallet(current);
    } catch { if (active()) setError(signOutFirst ? "Could not sign out. Try again." : "Could not finish recovery. Try again."); }
    finally { if (active()) setBusy(false); }
  }
  return <main className="mx-auto max-w-lg space-y-4 p-6">
    <h1 className="text-2xl font-semibold">Session recovery</h1>
    {error && <p role="alert">{error}</p>}
    {phase === "checking" && <p>Checking session…</p>}
    {phase === "choice" && <><p>Your session cannot access an account here. Sign in again to continue.</p><Button disabled={busy} onClick={() => void run(true)}>Sign out and continue</Button></>}
    {phase === "wallet" && <><p>Disconnect your wallet to continue.</p><Button disabled={busy} onClick={() => void run(false)}>Continue recovery</Button></>}
    {phase === "ready" && <><p>No active session. Sign in to continue.</p><Button disabled={busy} onClick={() => {
      const current = ++attempt.current;
      setBusy(true); setError("");
      void credentialAbsent().then((absent) => {
        if (attempt.current !== current) return;
        if (!absent) { setPhase("choice"); return; }
        if (!walletHydrated || accountRef.current.status !== "disconnected" || connectionsRef.current.length !== 0) { setPhase("wallet"); return; }
        window.location.assign("/");
      }).catch(() => { if (attempt.current === current) setError("Could not check your session. Try again."); }).finally(() => { if (attempt.current === current) setBusy(false); });
    }}>Sign in</Button></>}
  </main>;
}
