// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/tools/http-request`
 * Purpose: Scope-bound HTTP request tool for authorized red-team recon/exploitation PoC.
 * Scope: Issues a single fetch against ONE authorized origin. Does NOT import LangChain, does NOT read env.
 * Invariants:
 *   - TOOL_ID_NAMESPACED: ID is `core__http_request` (double-underscore for provider compat)
 *   - EFFECT_TYPED: effect is `external_side_effect` (performs outbound network IO)
 *   - SCOPE_BOUND: requests ONLY `new URL(path, targetBaseUrl)`; rejects any host pivot
 *     (absolute-URL path or resolved origin != targetBaseUrl origin)
 *   - OUTPUT_SIZE_GUARD: response body capped to ~64KB
 *   - SECRET_TRIPWIRE: obvious PII/secret spans are withheld and flagged, never returned raw
 *   - NO_THROW_TO_MODEL: scope/transport failures return structured results, never throw
 *   - ENV_FREE_EXPORTS: no env reads in this module
 *   - NO LangChain imports (LangChain wrapping lives in langgraph-graphs)
 * Side-effects: IO (one outbound HTTP request via Node global fetch)
 * Notes: task.0005 — red-solver attack tool. Pure fetch, no runtime capability plumbing.
 * Links: docs/spec/tool-use.md, docs/spec/langgraph-patterns.md
 * @public
 */

import { z } from "zod";

import type { BoundTool, ToolContract, ToolImplementation } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Response body cap (~64KB) per OUTPUT_SIZE_GUARD. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Allowlisted response header names returned to the model.
 * Keep the surface small and useful for recon; omit noisy/opaque headers.
 */
const RESPONSE_HEADER_ALLOWLIST: readonly string[] = [
  "content-type",
  "content-length",
  "location",
  "server",
  "date",
  "www-authenticate",
  "x-powered-by",
  "set-cookie",
];

/**
 * Obvious secret/PII tripwire patterns. If the response body matches any of
 * these, the raw body is withheld (SECRET_TRIPWIRE) and the result is flagged.
 */
const TRIPWIRE_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
  /password\s*=\s*\S+/i,
  // Long credit-card-like digit runs (13-19 digits, optional space/dash groups)
  /(?:\d[ -]?){13,19}/,
];

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input schema for the scope-bound HTTP request tool.
 */
export const HttpRequestInputSchema = z.object({
  targetBaseUrl: z
    .string()
    .url()
    .describe(
      "The authorized target base URL (origin). ALL requests are scoped to this origin."
    ),
  path: z
    .string()
    .startsWith("/", "path must be origin-relative and start with '/'")
    .describe(
      "Origin-relative request path, must start with '/'. Absolute URLs are rejected (no host pivot)."
    ),
  method: z
    .enum(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"])
    .describe("HTTP method"),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe("Optional request headers"),
  body: z
    .string()
    .optional()
    .describe("Optional request body (ignored for GET/HEAD)"),
});
export type HttpRequestInput = z.infer<typeof HttpRequestInputSchema>;

/**
 * Output schema. On scope rejection or transport error, `status` is 0 and
 * `bodyText` carries a safe diagnostic message (NO_THROW_TO_MODEL).
 */
export const HttpRequestOutputSchema = z.object({
  status: z.number().describe("HTTP status code, or 0 on scope/transport error"),
  headers: z
    .record(z.string(), z.string())
    .describe("Allowlisted subset of response headers"),
  bodyText: z
    .string()
    .describe("Response body text (capped, possibly withheld if tripwire fired)"),
  truncated: z
    .boolean()
    .describe("True if the response body exceeded the size cap and was truncated"),
  tripwire: z
    .boolean()
    .describe("True if a secret/PII pattern matched and the raw body was withheld"),
});
export type HttpRequestOutput = z.infer<typeof HttpRequestOutputSchema>;

/**
 * Redacted output. The tripwire already scrubs sensitive spans, so the full
 * (allowlisted) output is UI-safe.
 */
export type HttpRequestRedacted = HttpRequestOutput;

// ─────────────────────────────────────────────────────────────────────────────
// Contract
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Namespaced tool ID per TOOL_ID_NAMESPACED invariant.
 * Uses double-underscore separator (provider-compatible: OpenAI allows [a-zA-Z0-9_-]+)
 */
export const HTTP_REQUEST_NAME = "core__http_request" as const;

export const httpRequestContract: ToolContract<
  typeof HTTP_REQUEST_NAME,
  HttpRequestInput,
  HttpRequestOutput,
  HttpRequestRedacted
> = {
  name: HTTP_REQUEST_NAME,
  description:
    "Send a single HTTP request to an authorized target, scoped to one origin. " +
    "Requests only `new URL(path, targetBaseUrl)`; any host pivot (absolute-URL path " +
    "or cross-origin resolution) is rejected. Returns status, an allowlisted header " +
    "subset, and a size-capped body. Secret/PII spans are withheld and flagged. " +
    "Use for in-scope recon and proof-of-concept vulnerability checks only.",
  effect: "external_side_effect",
  inputSchema: HttpRequestInputSchema,
  outputSchema: HttpRequestOutputSchema,

  redact: (output: HttpRequestOutput): HttpRequestRedacted => output,

  allowlist: ["status", "headers", "bodyText", "truncated", "tripwire"] as const,
};

// ─────────────────────────────────────────────────────────────────────────────
// Implementation helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the in-scope request URL, enforcing SCOPE_BOUND.
 * Returns the resolved URL, or null if the resolution escapes the target origin.
 */
function resolveInScopeUrl(
  targetBaseUrl: string,
  path: string
): URL | null {
  let base: URL;
  let resolved: URL;
  try {
    base = new URL(targetBaseUrl);
    resolved = new URL(path, base);
  } catch {
    return null;
  }

  // Reject host pivot: protocol-relative or otherwise cross-origin resolution.
  if (resolved.origin !== base.origin) {
    return null;
  }

  return resolved;
}

/**
 * Collect the allowlisted subset of response headers.
 */
function pickResponseHeaders(headers: Headers): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const name of RESPONSE_HEADER_ALLOWLIST) {
    const value = headers.get(name);
    if (value !== null) {
      picked[name] = value;
    }
  }
  return picked;
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

export const httpRequestImplementation: ToolImplementation<
  HttpRequestInput,
  HttpRequestOutput
> = {
  execute: async (input: HttpRequestInput): Promise<HttpRequestOutput> => {
    // SCOPE_BOUND: resolve and validate the request stays on the authorized origin.
    const url = resolveInScopeUrl(input.targetBaseUrl, input.path);
    if (url === null) {
      return {
        status: 0,
        headers: {},
        bodyText:
          "[scope-rejected] Request blocked: path resolves outside the authorized " +
          "target origin. Stay in-scope (only the given targetBaseUrl).",
        truncated: false,
        tripwire: false,
      };
    }

    // Body is not valid on GET/HEAD requests.
    const sendsBody =
      input.body !== undefined &&
      input.method !== "GET" &&
      input.method !== "HEAD";

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: input.method,
        ...(input.headers !== undefined ? { headers: input.headers } : {}),
        ...(sendsBody ? { body: input.body } : {}),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "unknown error";
      return {
        status: 0,
        headers: {},
        bodyText: `[transport-error] Request failed: ${reason}`,
        truncated: false,
        tripwire: false,
      };
    }

    // OUTPUT_SIZE_GUARD: read then cap the body.
    const rawBody = await response.text();
    const truncated = rawBody.length > MAX_BODY_BYTES;
    const cappedBody = truncated ? rawBody.slice(0, MAX_BODY_BYTES) : rawBody;

    // SECRET_TRIPWIRE: withhold obvious secrets/PII, never return the raw span.
    const tripwire = TRIPWIRE_PATTERNS.some((pattern) => pattern.test(cappedBody));
    const bodyText = tripwire
      ? "[tripwire] Response body withheld: matched an obvious secret/PII pattern " +
        "(private key, credential, or long card-like digit run). HALT and report " +
        "per scope rules — do not exfiltrate."
      : cappedBody;

    return {
      status: response.status,
      headers: pickResponseHeaders(response.headers),
      bodyText,
      truncated,
      tripwire,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Bound Tool (contract + implementation)
// ─────────────────────────────────────────────────────────────────────────────

export const httpRequestBoundTool: BoundTool<
  typeof HTTP_REQUEST_NAME,
  HttpRequestInput,
  HttpRequestOutput,
  HttpRequestRedacted
> = {
  contract: httpRequestContract,
  implementation: httpRequestImplementation,
};
