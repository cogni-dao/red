// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/** Inspect exactly the family NextAuth SessionStore will assemble. */
export function inspectSessionCookies(name: string, cookies: readonly { name: string; value: string }[]) {
  const entries = cookies.filter((entry) => entry.name.startsWith(name) && entry.value.length > 0);
  const validName = (candidate: string) => candidate === name || (candidate.startsWith(`${name}.`) && /^\d+$/.test(candidate.slice(name.length + 1)));
  return { present: entries.length > 0, invalidName: entries.some((entry) => !validName(entry.name)) };
}
