// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

import { encode, getToken } from "next-auth/jwt";
import { describe, expect, it } from "vitest";
import { inspectSessionCookies } from "@/app/_lib/auth/link-session-cookies";

const secret = "test-only-session-secret-at-least-32-characters";
const name = "next-auth.session-token";
async function read(cookies: Record<string, string>, selectedSecret = secret) {
  // Native SessionStore and JWT decoder; no Bearer header supplied.
  return getToken({ req: { cookies, headers: {} } as never, secret: selectedSecret, secureCookie: false });
}

describe("native NextAuth credential assembly", () => {
  it("verifies default-salt tokens and rejects foreign, expired, corrupt and incomplete tokens", async () => {
    const token = await encode({ secret, token: { id: "node-local-test-id" } });
    expect(await read({ [name]: token })).toMatchObject({ id: "node-local-test-id" });
    expect(await read({ [name]: token }, "different-test-only-session-secret-long")).toBeNull();
    expect(await read({ [name]: `${token}broken` })).toBeNull();
    expect(await read({ [`${name}.0`]: token.slice(0, 40) })).toBeNull();
    const expired = await encode({ secret, token: { id: "expired" }, maxAge: -60 });
    expect(await read({ [name]: expired })).toBeNull();
  });
  it("assembles numbered chunks and treats empty values as no bytes", async () => {
    const token = await encode({ secret, token: { id: "chunked" } });
    const midpoint = Math.floor(token.length / 2);
    expect(await read({ [`${name}.0`]: token.slice(0, midpoint), [`${name}.1`]: token.slice(midpoint), [`${name}.2`]: "" })).toMatchObject({ id: "chunked" });
    expect(await read({ [name]: "" })).toBeNull();
  });
  it("rejects unexpected nonempty names and ignores inactive cookie families", () => {
    expect(inspectSessionCookies(name, [{ name, value: "" }])).toEqual({ present: false, invalidName: false });
    expect(inspectSessionCookies(name, [{ name: `${name}.0`, value: "part" }, { name, value: "" }])).toEqual({ present: true, invalidName: false });
    expect(inspectSessionCookies(name, [{ name: `${name}.unexpected`, value: "part" }])).toEqual({ present: true, invalidName: true });
    expect(inspectSessionCookies(name, [{ name: `__Secure-${name}`, value: "part" }])).toEqual({ present: false, invalidName: false });
  });
  it("uses the configured cookie family for secure and custom names", async () => {
    const token = await encode({ secret, token: { id: "native" } });
    const secureName = `__Secure-${name}`;
    const request = { cookies: { [secureName]: token }, headers: {} } as never;
    expect(await getToken({ req: request, secret, secureCookie: true })).toMatchObject({ id: "native" });
    expect(await getToken({ req: request, secret, secureCookie: false })).toBeNull();
    const customName = "custom.session";
    expect(await getToken({ req: { cookies: { [customName]: token }, headers: {} } as never, secret, cookieName: customName })).toMatchObject({ id: "native" });
    expect(inspectSessionCookies(customName, [{ name: `${customName}.0`, value: token }, { name, value: "ignored" }])).toEqual({ present: true, invalidName: false });
  });
});
