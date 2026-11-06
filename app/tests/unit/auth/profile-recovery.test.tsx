// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO
// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => { const replace = vi.fn(); return { signIn: vi.fn(), update: vi.fn(), replace, router: { replace } }; });
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: {} }, update: mock.update }), signIn: mock.signIn }));
vi.mock("next/navigation", () => ({ useRouter: () => mock.router, useSearchParams: () => new URLSearchParams(window.location.search) }));
vi.mock("next/link", () => ({ default: ({ children }: { children: ReactNode }) => <span>{children}</span> }));
vi.mock("@rainbow-me/rainbowkit", () => ({ useConnectModal: () => ({}) }));
vi.mock("@/components", () => ({
  Button: ({ children, variant: _v, size: _s, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => <button {...props}>{children}</button>,
  Avatar: ({ children }: HTMLAttributes<HTMLDivElement>) => <div>{children}</div>, AvatarFallback: ({ children }: HTMLAttributes<HTMLDivElement>) => <span>{children}</span>,
  PageContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>, DiscordIcon: () => null, EthereumIcon: () => null, GitHubIcon: () => null, GoogleIcon: () => null,
}));
vi.mock("@cogni/node-ui-kit/shadcn/spinner", () => ({ Spinner: () => <span>Loading</span> }));
import { ProfileView } from "@/app/(app)/profile/view";
const profile = (bindings: { provider: string; providerLogin: string | null }[]) => ({ displayName: null, avatarColor: null, resolvedDisplayName: "Test", linkedProviders: bindings });
const reply = (body: unknown, ok = true, status = ok ? 200 : 500) => ({ ok, status, json: async () => body });

describe("profile import readback", () => {
  beforeEach(() => { vi.clearAllMocks(); mock.replace.mockImplementation((path: string) => window.history.replaceState(null, "", path)); window.history.replaceState(null, "", "/profile#attestation=fixture"); });
  afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });
  it("reads profile after a lost import receipt before offering a link", async () => {
    let reads = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/v1/identity/bindings/import") throw new Error("receipt lost");
      if (url === "/api/v1/users/me") return reply(profile(++reads === 1 ? [] : [{ provider: "github", providerLogin: "octocat" }]));
      if (url === "/api/auth/providers") return reply({});
      return reply({ connected: false });
    }));
    render(<ProfileView />);
    expect(await screen.findByText("The result could not be confirmed. Check your linked accounts before trying again.")).toBeInTheDocument();
    expect(screen.getByText("octocat")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Link" })).not.toBeInTheDocument();
    expect(reads).toBeGreaterThanOrEqual(2);
  });
  it("keeps a newer confirmed binding when an initial profile request finishes late", async () => {
    let release!: (value: ReturnType<typeof reply>) => void;
    let reads = 0;
    const delayed = new Promise<ReturnType<typeof reply>>((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/v1/identity/bindings/import") return reply({ bound: true, githubLogin: "octocat" });
      if (url === "/api/v1/users/me") return ++reads === 1 ? delayed : reply(profile([{ provider: "github", providerLogin: "octocat" }]));
      if (url === "/api/auth/providers") return reply({});
      return reply({ connected: false });
    }));
    render(<ProfileView />);
    expect(await screen.findByText("octocat")).toBeInTheDocument();
    release(reply(profile([])));
    await waitFor(() => expect(screen.getByText("octocat")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Link" })).not.toBeInTheDocument();
  });
  it("blocks retry when the import receipt and readback both fail", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/v1/identity/bindings/import") throw new Error("receipt lost");
      if (url === "/api/v1/users/me") return reply(null, false);
      if (url === "/api/auth/providers") return reply({});
      return reply({ connected: false });
    }));
    render(<ProfileView />);
    expect(await screen.findByText("Could not confirm the linked account. Refresh and try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry account readback" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Link" })).not.toBeInTheDocument();
  });
  it("keeps a provider pending until signIn refusal is visible", async () => {
    window.history.replaceState(null, "", "/profile");
    let finish!: (value: { ok: boolean; error: string; status: number; url: null }) => void;
    mock.signIn.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/v1/users/me") return reply(profile([]));
      if (url === "/api/auth/providers") return reply({ discord: { id: "discord" } });
      if (url === "/api/auth/link/discord") return reply({ ok: true });
      return reply({ connected: false });
    }));
    render(<ProfileView />);
    const label = await screen.findByText("Discord");
    const row = label.parentElement?.parentElement?.parentElement;
    if (!row) throw new Error("Discord row missing");
    const button = within(row).getByRole("button", { name: "Link" });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    finish({ ok: false, error: "refused", status: 400, url: null });
    expect(await screen.findByText("Unable to start linking. Try again.")).toBeInTheDocument();
    await waitFor(() => expect(button).toBeEnabled());
  });

  it("does not trust a direct callback query until profile readback confirms the provider", async () => {
    window.history.replaceState(null, "", "/profile?linked=discord&login=alice");
    let finish!: (value: ReturnType<typeof reply>) => void;
    const delayed = new Promise<ReturnType<typeof reply>>((resolve) => { finish = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/v1/users/me") return delayed;
      if (url === "/api/auth/providers") return reply({ discord: { id: "discord" } });
      return reply({ connected: false });
    }));
    render(<ProfileView />);
    expect(screen.queryByText(/Verified/)).not.toBeInTheDocument();
    finish(reply(profile([{ provider: "discord", providerLogin: "alice" }])));
    expect(await screen.findByText("alice")).toBeInTheDocument();
    expect(await screen.findByText(/Verified/)).toBeInTheDocument();
  });

  it("reads the committed profile after a parsed persistence 503", async () => {
    let reads = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/v1/identity/bindings/import") return reply({ errorCode: "local_session_unavailable" }, false, 503);
      if (url === "/api/v1/users/me") return reply(profile(++reads === 1 ? [] : [{ provider: "github", providerLogin: "committed" }]));
      if (url === "/api/auth/providers") return reply({});
      return reply({ connected: false });
    }));
    render(<ProfileView />);
    expect(await screen.findByText("Account service is temporarily unavailable. Try again.")).toBeInTheDocument();
    expect(await screen.findByText("committed")).toBeInTheDocument();
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole("button", { name: "Link" })).not.toBeInTheDocument();
  });
  it.each([{ bound: true }, { bound: true, githubLogin: 42 }])("does not claim completion for a malformed login receipt %o", async (receipt) => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/v1/identity/bindings/import") return reply(receipt);
      if (url === "/api/v1/users/me") return reply(profile([{ provider: "github", providerLogin: "unrelated" }]));
      if (url === "/api/auth/providers") return reply({});
      return reply({ connected: false });
    }));
    render(<ProfileView />);
    expect(await screen.findByText("The result could not be confirmed. Check your linked accounts before trying again.")).toBeInTheDocument();
    expect(screen.getByText("unrelated")).toBeInTheDocument();
    expect(screen.queryByText(/Verified/)).not.toBeInTheDocument();
  });
  it.each(["direct", "broker"])("serializes %s first and releases both starts after failure", async (first) => {
    window.history.replaceState(null, "", "/profile");
    let finish!: (value: ReturnType<typeof reply>) => void;
    const pending = new Promise<ReturnType<typeof reply>>((resolve) => { finish = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/v1/users/me") return reply(profile([]));
      if (url === "/api/auth/providers") return reply({ discord: { id: "discord" } });
      if (url === "/api/auth/link/discord") return first === "direct" ? pending : reply({ errorCode: "identity_link_failed" }, false);
      if (url === "/api/v1/identity/bindings/import/start") return first === "broker" ? pending : reply({ errorCode: "identity_link_failed" }, false);
      return reply({ connected: false });
    }));
    render(<ProfileView />);
    const discordLabel = await screen.findByText("Discord");
    const githubLabel = await screen.findByText("GitHub");
    const discordRow = discordLabel.parentElement?.parentElement?.parentElement;
    const githubRow = githubLabel.parentElement?.parentElement?.parentElement;
    if (!discordRow || !githubRow) throw new Error("provider row missing");
    const discord = within(discordRow).getByRole("button", { name: "Link" });
    const github = within(githubRow).getByRole("button", { name: "Link" });
    fireEvent.click(first === "direct" ? discord : github);
    await waitFor(() => expect(first === "direct" ? github : discord).toBeDisabled());
    finish(reply({ errorCode: "identity_link_failed" }, false));
    await waitFor(() => { expect(discord).toBeEnabled(); expect(github).toBeEnabled(); });
  });

  it("retains 503 feedback and blocks LINK until failed readback is retried", async () => {
    let reads = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/v1/identity/bindings/import") return reply({ errorCode: "local_session_unavailable" }, false, 503);
      if (url === "/api/v1/users/me") return ++reads === 1 ? reply(profile([])) : reads === 2 ? reply(null, false) : reply(profile([{ provider: "github", providerLogin: "committed" }]));
      if (url === "/api/auth/providers") return reply({});
      return reply({ connected: false });
    }));
    render(<ProfileView />);
    expect(await screen.findByText("Could not confirm the linked account. Refresh and try again.")).toBeInTheDocument();
    expect(screen.getByText("Account service is temporarily unavailable. Try again.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Link" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry account readback" }));
    expect(await screen.findByText("committed")).toBeInTheDocument();
    expect(screen.getByText("Account service is temporarily unavailable. Try again.")).toBeInTheDocument();
  });
  it("accepts an explicit null login without inventing a name", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/v1/identity/bindings/import") return reply({ bound: true, githubLogin: null });
      if (url === "/api/v1/users/me") return reply(profile([{ provider: "github", providerLogin: null }]));
      if (url === "/api/auth/providers") return reply({});
      return reply({ connected: false });
    }));
    render(<ProfileView />);
    expect(await screen.findByText("Successfully linked your GitHub account.")).toBeInTheDocument();
  });
  it("blocks broker start while direct provider signIn remains pending", async () => {
    window.history.replaceState(null, "", "/profile");
    let finish!: (value: { ok: boolean; error: string; status: number; url: null }) => void;
    mock.signIn.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const fetcher = vi.fn(async (url: string) => {
      if (url === "/api/v1/users/me") return reply(profile([]));
      if (url === "/api/auth/providers") return reply({ discord: { id: "discord" } });
      if (url === "/api/auth/link/discord") return reply({ ok: true });
      if (url === "/api/v1/identity/bindings/import/start") return reply({ errorCode: "identity_link_failed" }, false);
      return reply({ connected: false });
    });
    vi.stubGlobal("fetch", fetcher);
    render(<ProfileView />);
    const discordRow = (await screen.findByText("Discord")).parentElement?.parentElement?.parentElement;
    const githubRow = (await screen.findByText("GitHub")).parentElement?.parentElement?.parentElement;
    if (!discordRow || !githubRow) throw new Error("provider row missing");
    const discord = within(discordRow).getByRole("button", { name: "Link" });
    const github = within(githubRow).getByRole("button", { name: "Link" });
    fireEvent.click(discord);
    await waitFor(() => expect(mock.signIn).toHaveBeenCalled());
    expect(github).toBeDisabled();
    fireEvent.click(github);
    expect(fetcher.mock.calls.filter(([url]) => url === "/api/v1/identity/bindings/import/start")).toHaveLength(0);
    finish({ ok: false, error: "refused", status: 400, url: null });
    await waitFor(() => { expect(discord).toBeEnabled(); expect(github).toBeEnabled(); });
  });

  it("retry displays the matching intended account, not the first provider binding", async () => {
    let reads = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/v1/identity/bindings/import") return reply({ bound: true, githubLogin: "target-b" });
      if (url === "/api/v1/users/me") return ++reads <= 2 ? reply(null, false) : reply(profile([{ provider: "github", providerLogin: "other-a" }, { provider: "github", providerLogin: "target-b" }]));
      if (url === "/api/auth/providers") return reply({});
      return reply({ connected: false });
    }));
    render(<ProfileView />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry account readback" }));
    expect(await screen.findByText(/@target-b/, { selector: "strong" })).toBeInTheDocument();
    expect(screen.queryByText(/@other-a/, { selector: "strong" })).not.toBeInTheDocument();
  });
  it("treats malformed fragment as pre-submit failure without a readback retry", async () => {
    window.history.replaceState(null, "", "/profile#attestation=%");
    const fetcher = vi.fn(async (url: string) => {
      if (url === "/api/v1/users/me") return reply(profile([{ provider: "github", providerLogin: "existing" }]));
      if (url === "/api/auth/providers") return reply({});
      return reply({ connected: false });
    });
    vi.stubGlobal("fetch", fetcher);
    render(<ProfileView />);
    expect(await screen.findByText("Unable to start linking. Try again.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry account readback" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Verified/)).not.toBeInTheDocument();
    expect(fetcher.mock.calls.some(([url]) => url === "/api/v1/identity/bindings/import")).toBe(false);
  });
  it.each(["import", "readback"])("retires pending %s when a query supersedes it", async (stage) => {
    let finish!: (value: ReturnType<typeof reply>) => void;
    const delayed = new Promise<ReturnType<typeof reply>>((resolve) => { finish = resolve; });
    let reads = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/v1/identity/bindings/import") return stage === "import" ? delayed : reply({ bound: true, githubLogin: "target" });
      if (url === "/api/v1/users/me") return ++reads === 1 ? reply(profile([])) : delayed;
      if (url === "/api/auth/providers") return reply({});
      return reply({ connected: false });
    }));
    const view = render(<ProfileView />);
    if (stage === "readback") await waitFor(() => expect(reads).toBe(2));
    else await screen.findByText("Recording your verified GitHub account on this node…");
    window.history.replaceState(null, "", "/profile?error=link_failed");
    view.rerender(<ProfileView />);
    expect(await screen.findByText("Unable to start linking. Try again.")).toBeInTheDocument();
    finish(stage === "import" ? reply({ bound: true, githubLogin: "target" }) : reply(profile([{ provider: "github", providerLogin: "target" }])));
    await waitFor(() => expect(screen.getByText("Unable to start linking. Try again.")).toBeInTheDocument());
    expect(screen.queryByText(/Verified/)).not.toBeInTheDocument();
  });

  it("a stale import completion cannot clear a newer query readback", async () => {
    let finishImport!: (value: ReturnType<typeof reply>) => void;
    let finishReadback!: (value: ReturnType<typeof reply>) => void;
    const oldImport = new Promise<ReturnType<typeof reply>>((resolve) => { finishImport = resolve; });
    const newReadback = new Promise<ReturnType<typeof reply>>((resolve) => { finishReadback = resolve; });
    let reads = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/v1/identity/bindings/import") return oldImport;
      if (url === "/api/v1/users/me") return ++reads === 1 ? reply(profile([])) : newReadback;
      if (url === "/api/auth/providers") return reply({ discord: { id: "discord" } });
      return reply({ connected: false });
    }));
    const view = render(<ProfileView />);
    await screen.findByText("Recording your verified GitHub account on this node…");
    window.history.replaceState(null, "", "/profile?linked=discord&login=alice");
    view.rerender(<ProfileView />);
    const label = await screen.findByText("Discord");
    const row = label.parentElement?.parentElement?.parentElement;
    if (!row) throw new Error("provider row missing");
    const link = within(row).getByRole("button", { name: "Link" });
    expect(link).toBeDisabled();
    await act(async () => finishImport(reply({ bound: true, githubLogin: "old" })));
    expect(link).toBeDisabled();
    expect(screen.queryByText(/Verified/)).not.toBeInTheDocument();
    await act(async () => finishReadback(reply(profile([{ provider: "discord", providerLogin: "alice" }]))));
    expect(await screen.findByText(/Verified/)).toBeInTheDocument();
  });

  it("blocks all provider starts while an uncertain import readback has failed", async () => {
    let reads = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/v1/identity/bindings/import") return reply({ errorCode: "local_session_unavailable" }, false, 503);
      if (url === "/api/v1/users/me") return ++reads === 1 ? reply(profile([])) : reply(null, false);
      if (url === "/api/auth/providers") return reply({ github: { id: "github" }, discord: { id: "discord" } });
      return reply({ connected: false });
    }));
    render(<ProfileView />);
    await screen.findByRole("button", { name: "Retry account readback" });
    const buttons = screen.getAllByRole("button", { name: "Link" });
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button).toBeDisabled();
  });

});
