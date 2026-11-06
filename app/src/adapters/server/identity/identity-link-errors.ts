// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

import { IdentityLinkPersistenceError } from "@/ports/identity-binding.errors";

const unavailable = new Set([
  "53000", "53100", "53200", "53300", "53400", "57P01", "57P02", "57P03",
  "58000", "58030", "57014", "55P03", "40001", "40P01", "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED", "CONNECTION_DESTROYED", "CONNECTION_ENDED", "ECONNREFUSED",
  "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "ENOTFOUND", "EAI_AGAIN", "EPIPE",
]);

/** Inspect only native cause chain, never error messages or SQL. */
export function classifyIdentityLinkWriteError(error: unknown, nonceInsert = false): IdentityLinkPersistenceError {
  const seen = new Set<object>();
  let current: unknown = error;
  for (let i = 0; i < 4 && current !== null && typeof current === "object"; i++) {
    if (seen.has(current)) break;
    seen.add(current);
    const value = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (nonceInsert && value.code === "23503" && value.constraint_name === "link_transactions_user_id_users_id_fk") {
      return new IdentityLinkPersistenceError("local_account_missing");
    }
    if (typeof value.code === "string" && (value.code.startsWith("08") || unavailable.has(value.code))) {
      return new IdentityLinkPersistenceError("unavailable");
    }
    current = value.cause;
  }
  return new IdentityLinkPersistenceError("unexpected");
}
