// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO
// @vitest-environment happy-dom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ButtonHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const effects = vi.hoisted(() => ({ signOut: vi.fn(), getSession: vi.fn(), disconnect: vi.fn(), status: "disconnected", connections: [] as { connector: object }[] }));
vi.mock("next-auth/react", () => ({ signOut: effects.signOut, getSession: effects.getSession }));
vi.mock("wagmi", () => ({ useAccount: () => ({ status: effects.status }), useConnections: () => effects.connections, useDisconnect: () => ({ disconnectAsync: effects.disconnect }) }));
vi.mock("@/components", () => ({ Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} /> }));
import { Recovery } from "@/app/session-recovery/recovery.client";

describe("explicit recovery gates", () => {
  beforeEach(() => { vi.clearAllMocks(); effects.status = "disconnected"; effects.connections = []; });
  afterEach(() => { vi.unstubAllGlobals(); });
  it("does not accept a resolved CSRF refusal as sign-out", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ effectiveSessionCredentialPresent: true }) }));
    effects.signOut.mockResolvedValue({ url: "/api/auth/signout?csrf=true" });
    render(<Recovery />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out and continue" }));
    await screen.findByRole("alert");
    expect(screen.getByText("Could not sign out. Try again.")).toBeInTheDocument();
    expect(effects.disconnect).not.toHaveBeenCalled();
    expect(effects.getSession).not.toHaveBeenCalled();
  });
  it("does not accept a successful-looking URL while credential bytes remain", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ effectiveSessionCredentialPresent: true }) }));
    effects.signOut.mockResolvedValue({ url: new URL("/session-recovery", window.location.origin).href });
    render(<Recovery />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out and continue" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not sign out"));
    expect(effects.getSession).not.toHaveBeenCalled();
  });
  it("keeps wallet retry available when disconnect rejects", async () => {
    effects.status = "connected";
    effects.connections = [{ connector: {} }];
    effects.disconnect.mockRejectedValue(new Error("rejected"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ effectiveSessionCredentialPresent: false }) }));
    render(<Recovery />);
    fireEvent.click(await screen.findByRole("button", { name: "Continue recovery" }));
    await screen.findByRole("alert");
    expect(effects.disconnect).toHaveBeenCalledOnce();
    expect(effects.signOut).not.toHaveBeenCalled();
    expect(effects.getSession).not.toHaveBeenCalled();
  });
  it("requires a fresh choice when credentials return during wallet retry", async () => {
    effects.status = "connected";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ effectiveSessionCredentialPresent: false }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ effectiveSessionCredentialPresent: true }) }));
    render(<Recovery />);
    fireEvent.click(await screen.findByRole("button", { name: "Continue recovery" }));
    await screen.findByRole("button", { name: "Sign out and continue" });
    expect(effects.signOut).not.toHaveBeenCalled();
    expect(effects.disconnect).not.toHaveBeenCalled();
  });
});
