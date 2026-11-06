// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

import { NextResponse } from "next/server";
import { effectiveSessionCredential } from "@/app/_lib/auth/link-session.server";

export const dynamic = "force-dynamic";
export async function GET() {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  try {
    const { present } = await effectiveSessionCredential();
    return NextResponse.json({ effectiveSessionCredentialPresent: present }, { headers });
  } catch {
    return NextResponse.json({ errorCode: "local_session_unavailable" }, { status: 503, headers });
  }
}
