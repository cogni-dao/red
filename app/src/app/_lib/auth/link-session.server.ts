// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

import { cookies } from "next/headers";
import { authOptions } from "@/auth";
import { inspectSessionCookies } from "./link-session-cookies";

/** Read the cookie family NextAuth uses; never decode identity from cookie bytes. */
export async function effectiveSessionCredential(): Promise<{ present: boolean; invalidName: boolean }> {
  // Host-trust makes NextAuth depend on request headers; refuse rather than guess.
  // biome-ignore lint/style/noProcessEnv: mirrors NextAuth's server-side origin configuration
  if (process.env.VERCEL ?? process.env.AUTH_TRUST_HOST) throw new Error("Session cookie configuration unavailable");
  // biome-ignore lint/style/noProcessEnv: mirrors NextAuth's configured origin
  const origin = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const custom = authOptions.cookies?.sessionToken?.name;
  let name = custom;
  if (!name) {
    const parsed = origin.startsWith("http") ? origin : `https://${origin}`;
    const secure = authOptions.useSecureCookies ?? new URL(parsed).protocol === "https:";
    name = `${secure ? "__Secure-" : ""}next-auth.session-token`;
  }
  return inspectSessionCookies(name, (await cookies()).getAll());
}
