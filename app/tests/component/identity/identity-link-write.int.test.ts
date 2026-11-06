// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

import { randomUUID } from "node:crypto";
import { getSeedDb } from "@tests/_fixtures/db/seed-client";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { identityEvents, linkTransactions, userBindings, users } from "@/shared/db/schema";
import { DrizzleIdentityBindingRepository } from "@/adapters/server/identity/identity-binding.adapter";

describe("identity link nonce persistence", () => {
  it("classifies a missing local user from the real FK", async () => {
    const repository = new DrizzleIdentityBindingRepository(getSeedDb());
    const nonce = randomUUID();
    await expect(repository.insertNonce({
      nonce, userId: randomUUID(), expiresAt: new Date(Date.now() + 60_000),
    })).rejects.toMatchObject({ kind: "local_account_missing" });
    expect(await getSeedDb().query.linkTransactions.findFirst({ where: eq(linkTransactions.id, nonce) })).toBeUndefined();
  });
  it("classifies the direct link writer's real missing-parent FK", async () => {
    const { createLinkTransaction } = await import("@/auth");
    const absent = randomUUID();
    await expect(createLinkTransaction(absent, "discord")).rejects.toMatchObject({ kind: "local_account_missing" });
    const rows = await getSeedDb().query.linkTransactions.findMany({ where: eq(linkTransactions.userId, absent) });
    expect(rows).toEqual([]);
  });
  it("does not call an unrelated native FK a missing nonce parent", async () => {
    const { classifyIdentityLinkWriteError } = await import("@/adapters/server/identity/identity-link-errors");
    let failure: unknown;
    try {
      await getSeedDb().insert(identityEvents).values({ id: randomUUID(), userId: randomUUID(), eventType: "bind", payload: {} });
    } catch (error) { failure = error; }
    expect(failure).toBeDefined();
    expect((failure as { cause?: { code?: string; constraint_name?: string } }).cause).toMatchObject({ code: "23503", constraint_name: "identity_events_user_id_users_id_fk" });
    expect(classifyIdentityLinkWriteError(failure, true).kind).toBe("unexpected");
  });
  it("serializes concurrent nonce redemption and preserves another binding owner", async () => {
    const db = getSeedDb();
    const caller = randomUUID(), owner = randomUUID(), nonce = randomUUID(), binding = randomUUID(), githubId = randomUUID();
    await db.insert(users).values([{ id: caller }, { id: owner }]);
    await db.insert(userBindings).values({ id: binding, userId: owner, provider: "github", externalId: githubId });
    const repository = new DrizzleIdentityBindingRepository(db);
    await repository.insertNonce({ nonce, userId: caller, expiresAt: new Date(Date.now() + 60_000) });
    let started!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = repository.transaction(async (tx) => {
      const consumed = await tx.consumeNonce({ nonce, userId: caller, now: new Date() });
      started();
      await gate;
      const existing = await tx.findGithubBinding(githubId);
      return { consumed, owner: existing?.userId };
    });
    let second: Promise<boolean> | undefined;
    try {
      await entered;
      let secondStarted!: () => void;
      const secondEntered = new Promise<void>((resolve) => { secondStarted = resolve; });
      second = repository.transaction((tx) => {
        secondStarted();
        return tx.consumeNonce({ nonce, userId: caller, now: new Date() });
      });
      await secondEntered;
      release();
      const [winner, replay] = await Promise.all([first, second]);
      expect(winner).toEqual({ consumed: true, owner });
      expect(replay).toBe(false);
      expect(await db.query.userBindings.findFirst({ where: eq(userBindings.id, binding) })).toMatchObject({ userId: owner });
    } finally {
      release();
      await Promise.allSettled(second ? [first, second] : [first]);
      await db.delete(linkTransactions).where(eq(linkTransactions.id, nonce));
      await db.delete(userBindings).where(eq(userBindings.id, binding));
      await db.delete(users).where(eq(users.id, caller));
      await db.delete(users).where(eq(users.id, owner));
    }
  });
  it("retains the parent while an inserted nonce exists", async () => {
    const db = getSeedDb();
    const userId = randomUUID();
    const nonce = randomUUID();
    await db.insert(users).values({ id: userId });
    const repository = new DrizzleIdentityBindingRepository(db);
    await repository.insertNonce({ nonce, userId, expiresAt: new Date(Date.now() + 60_000) });
    await expect(db.delete(users).where(eq(users.id, userId))).rejects.toBeDefined();
    expect(await db.query.linkTransactions.findFirst({ where: eq(linkTransactions.id, nonce) })).toMatchObject({ userId });
    await db.delete(linkTransactions).where(eq(linkTransactions.id, nonce));
    await db.delete(users).where(eq(users.id, userId));
  });
});

describe("identity error classification", () => {
  it("requires both native FK fields on the same cause", async () => {
    const { classifyIdentityLinkWriteError } = await import("@/adapters/server/identity/identity-link-errors");
    expect(classifyIdentityLinkWriteError({ cause: { code: "23503", constraint_name: "link_transactions_user_id_users_id_fk" } }, true).kind).toBe("local_account_missing");
    expect(classifyIdentityLinkWriteError({ code: "23503", cause: { constraint_name: "link_transactions_user_id_users_id_fk" } }, true).kind).toBe("unexpected");
    expect(classifyIdentityLinkWriteError({ code: "23503", constraint_name: "other_fk" }, true).kind).toBe("unexpected");
    expect(classifyIdentityLinkWriteError({ code: "23503", constraint_name: "link_transactions_user_id_users_id_fk" }, false).kind).toBe("unexpected");
    expect(classifyIdentityLinkWriteError({ cause: { code: "ECONNRESET" } }).kind).toBe("unavailable");
    const cycle: { cause?: unknown } = {}; cycle.cause = cycle;
    expect(classifyIdentityLinkWriteError(cycle, true).kind).toBe("unexpected");
  });
});
