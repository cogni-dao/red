// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

import { NextResponse } from "next/server";
import { IdentityLinkPersistenceError } from "@/ports/identity-binding.errors";

export function identityLinkFailure(error: unknown): NextResponse {
  const kind = error instanceof IdentityLinkPersistenceError ? error.kind : "unexpected";
  const status = kind === "local_account_missing" ? 401 : kind === "unavailable" ? 503 : 500;
  return NextResponse.json({ errorCode: status === 401 ? "local_session_invalid" : status === 503 ? "local_session_unavailable" : "identity_link_failed" }, { status });
}
export function invalidLocalSession(): NextResponse {
  return NextResponse.json({ errorCode: "local_session_invalid" }, { status: 401 });
}
