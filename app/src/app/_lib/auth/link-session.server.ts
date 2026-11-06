// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

import { cookies, headers } from "next/headers";
import { authOptions } from "@/auth";
import { inspectSessionCookies } from "./link-session-cookies";

/** Read the cookie family NextAuth uses; never decode identity from cookie bytes. */
export async function effectiveSessionCredential(): Promise<{ present: boolean; invalidName: boolean }> {
  const custom = authOptions.cookies?.sessionToken?.name;
  let name = custom;
  if (name === undefined) {
    // Match NextAuth 4's detectOrigin and parseUrl exactly for the cookie scheme.
    // biome-ignore lint/style/noProcessEnv: NextAuth's own trusted configuration
    const trustHost = process.env.VERCEL ?? process.env.AUTH_TRUST_HOST;
    let origin: string;
    if (trustHost) {
      const requestHeaders = await headers();
      const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
      if (!host) throw new Error("Session cookie configuration unavailable");
      origin = `${requestHeaders.get("x-forwarded-proto") === "http" ? "http" : "https"}://${host}`;
    } else {
      // biome-ignore lint/style/noProcessEnv: NextAuth's configured origin
      origin = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
    }
    const parsed = origin.startsWith("http") ? origin : `https://${origin}`;
    const secure = authOptions.useSecureCookies ?? new URL(parsed).protocol === "https:";
    name = `${secure ? "__Secure-" : ""}next-auth.session-token`;
  }
  return inspectSessionCookies(name, (await cookies()).getAll());
}
