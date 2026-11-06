// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

import { randomUUID } from "node:crypto";
import { getSeedDb } from "@tests/_fixtures/db/seed-client";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { linkTransactions, users } from "@/shared/db/schema";
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
