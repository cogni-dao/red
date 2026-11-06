// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/** Safe persistence failures exposed to identity application code. */
export type IdentityLinkPersistenceKind = "local_account_missing" | "unavailable" | "unexpected";
export class IdentityLinkPersistenceError extends Error {
  constructor(readonly kind: IdentityLinkPersistenceKind) {
    super("Identity link persistence failed");
    this.name = "IdentityLinkPersistenceError";
  }
}
