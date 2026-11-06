// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO
// @vitest-environment happy-dom

import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ButtonHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const effects = vi.hoisted(() => ({ hydrated: true, onHydrated: undefined as undefined | (() => void), readCredential: vi.fn(), signOut: vi.fn(), getSession: vi.fn(), disconnect: vi.fn(), status: "disconnected", connections: [] as { connector: object }[] }));
vi.mock("@/app/_lib/auth/link-session.server", () => ({ effectiveSessionCredential: effects.readCredential }));
vi.mock("next-auth/react", () => ({ signOut: effects.signOut, getSession: effects.getSession }));
vi.mock("wagmi", () => ({ useConfig: () => ({ _internal: { store: { persist: { hasHydrated: () => effects.hydrated, onFinishHydration: (fn: () => void) => { effects.onHydrated = fn; return () => {}; } } } } }), useAccount: () => ({ status: effects.status }), useConnections: () => effects.connections, useDisconnect: () => ({ disconnectAsync: effects.disconnect }) }));
vi.mock("@/components", () => ({ Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} /> }));
import { Recovery } from "@/app/session-recovery/recovery.client";
import SessionRecoveryPage from "@/app/session-recovery/page";

describe("explicit recovery gates", () => {
  beforeEach(() => { vi.clearAllMocks(); effects.status = "disconnected"; effects.connections = []; effects.hydrated = true; effects.onHydrated = undefined; });
  afterEach(() => { vi.unstubAllGlobals(); });
  it("does not accept a resolved CSRF refusal as sign-out", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ effectiveSessionCredentialPresent: true }) }));
    effects.signOut.mockResolvedValue({ url: "/api/auth/signout?csrf=true" });
    render(<Recovery initialCredential="absent" />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out and continue" }));
    await screen.findByRole("alert");
    expect(screen.getByText("Could not sign out. Try again.")).toBeInTheDocument();
    expect(effects.disconnect).not.toHaveBeenCalled();
    expect(effects.getSession).not.toHaveBeenCalled();
  });
  it("does not accept a successful-looking URL while credential bytes remain", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ effectiveSessionCredentialPresent: true }) }));
    effects.signOut.mockResolvedValue({ url: new URL("/session-recovery", window.location.origin).href });
    render(<Recovery initialCredential="absent" />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out and continue" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not sign out"));
    expect(effects.getSession).not.toHaveBeenCalled();
  });
  it("keeps wallet retry available when disconnect rejects", async () => {
    effects.status = "connected";
    effects.connections = [{ connector: {} }];
    effects.disconnect.mockRejectedValue(new Error("rejected"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ effectiveSessionCredentialPresent: false }) }));
    render(<Recovery initialCredential="absent" />);
    fireEvent.click(await screen.findByRole("button", { name: "Continue recovery" }));
    await screen.findByRole("alert");
    expect(effects.disconnect).toHaveBeenCalledOnce();
    expect(effects.signOut).not.toHaveBeenCalled();
    expect(effects.getSession).not.toHaveBeenCalled();
  });
  it("requires a fresh choice when credentials return during wallet retry", async () => {
    effects.status = "connected";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ effectiveSessionCredentialPresent: false }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ effectiveSessionCredentialPresent: true }) }));
    render(<Recovery initialCredential="absent" />);
    fireEvent.click(await screen.findByRole("button", { name: "Continue recovery" }));
    await screen.findByRole("button", { name: "Sign out and continue" });
    expect(effects.signOut).not.toHaveBeenCalled();
    expect(effects.disconnect).not.toHaveBeenCalled();
  });
  it("does not offer fresh sign-in while the wallet is reconnecting", async () => {
    effects.status = "reconnecting";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ effectiveSessionCredentialPresent: false }) }));
    render(<Recovery initialCredential="absent" />);
    expect(await screen.findByRole("button", { name: "Continue recovery" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue recovery" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not finish recovery");
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("passes the server reader result and never reports failure as absence", async () => {
    effects.readCredential.mockResolvedValueOnce({ present: true, invalidName: false });
    expect((await SessionRecoveryPage()).props.initialCredential).toBe("present");
    effects.readCredential.mockResolvedValueOnce({ present: false, invalidName: false });
    expect((await SessionRecoveryPage()).props.initialCredential).toBe("absent");
    effects.readCredential.mockRejectedValueOnce(new Error("unavailable"));
    expect((await SessionRecoveryPage()).props.initialCredential).toBe("unavailable");
    render(<Recovery initialCredential="unavailable" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not check your session");
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("does not offer sign in before the wallet store has hydrated", async () => {
    effects.hydrated = false;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ effectiveSessionCredentialPresent: false }) }));
    render(<Recovery initialCredential="absent" />);
    await act(async () => {});
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
    expect(effects.onHydrated).toBeDefined();
    await act(async () => { effects.hydrated = true; effects.onHydrated?.(); });
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("does not disconnect after unmount during verification", async () => {
    effects.status = "connected";
    effects.connections = [{ connector: {} }];
    let release!: (value: unknown) => void;
    const held = new Promise((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ effectiveSessionCredentialPresent: false }) }).mockReturnValueOnce(held));
    const view = render(<Recovery initialCredential="absent" />);
    fireEvent.click(await screen.findByRole("button", { name: "Continue recovery" }));
    view.unmount();
    await act(async () => release({ ok: true, json: async () => ({ effectiveSessionCredentialPresent: false }) }));
    expect(effects.disconnect).not.toHaveBeenCalled();
  });
  it("does not navigate after unmount during session broadcast", async () => {
    effects.status = "connected";
    let release!: (value: unknown) => void;
    effects.getSession.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    effects.disconnect.mockImplementation(async () => { effects.status = "disconnected"; });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ effectiveSessionCredentialPresent: false }) }));
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
    const view = render(<Recovery initialCredential="absent" />);
    fireEvent.click(await screen.findByRole("button", { name: "Continue recovery" }));
    await waitFor(() => expect(effects.disconnect).toHaveBeenCalled());
    effects.status = "disconnected";
    view.rerender(<Recovery initialCredential="absent" />);
    // A second explicit attempt sees the disconnected wallet.
    fireEvent.click(await screen.findByRole("button", { name: "Continue recovery" }));
    await waitFor(() => expect(effects.getSession).toHaveBeenCalled());
    view.unmount();
    await act(async () => release(null));
    expect(assign).not.toHaveBeenCalled();
    assign.mockRestore();
  });

  it("does not navigate after unmount during final sign-in verification", async () => {
    let release!: (value: unknown) => void;
    const held = new Promise((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ effectiveSessionCredentialPresent: false }) }).mockReturnValueOnce(held));
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
    const view = render(<Recovery initialCredential="absent" />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    view.unmount();
    await act(async () => release({ ok: true, json: async () => ({ effectiveSessionCredentialPresent: false }) }));
    expect(assign).not.toHaveBeenCalled();
    assign.mockRestore();
  });

});
