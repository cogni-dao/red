// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

import { effectiveSessionCredential } from "@/app/_lib/auth/link-session.server";
import { Recovery } from "./recovery.client";

export const dynamic = "force-dynamic";
export default async function SessionRecoveryPage() {
  let initialCredential: "present" | "absent" | "unavailable";
  try {
    initialCredential = (await effectiveSessionCredential()).present ? "present" : "absent";
  } catch {
    initialCredential = "unavailable";
  }
  return <Recovery initialCredential={initialCredential} />;
}
