// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/identity/bindings/import/start`
 * Purpose: Starts the operator-attested GitHub binding round trip.
 * Scope: Mints a session-owned consume-once nonce and returns a broker URL
 *   bound to this repo-spec node UUID and this node's canonical profile URL.
 * Invariants: No client-supplied node id or return URL; configured origins only.
 * Side-effects: IO (link transaction insert)
 * @public
 */

import {
	IDENTITY_ATTESTATION_V1_PROTOCOL_SHA256,
	IdentityAttestationOriginSchema,
	identityAttestationStartOperation,
} from "@cogni/node-contracts";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
	createIdentityAttestationNonce,
	createSigninChallenge,
} from "@/app/_facades/identity/operator-attested-binding.server";
import { identityLinkFailure, invalidLocalSession } from "@/app/_facades/identity/identity-link-response.server";
import { effectiveSessionCredential } from "@/app/_lib/auth/link-session.server";
import { getOperatorIssuerUrl } from "@/app/_lib/auth/operator-attestation";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { getServerSessionUser } from "@/lib/auth/server";
import { getNodeId } from "@/shared/config";
import { serverEnv } from "@/shared/env/server";
import {
	SIGNIN_CHALLENGE_COOKIE,
	SIGNIN_CHALLENGE_TTL_SECONDS,
} from "@/shared/identity/signin-challenge";
import { SIGNIN_COMPLETE_PATH } from "@/shared/identity/signin-paths";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function configuredNodeOrigin(): string | null {
	const configured = serverEnv().APP_BASE_URL;
	if (!configured) return null;
	const parsed = IdentityAttestationOriginSchema.safeParse(configured);
	return parsed.success ? parsed.data : null;
}

export const POST = wrapRouteHandlerWithLogging(
	{
		routeId: identityAttestationStartOperation.id,
		// Optional, not required. A signed-in caller is LINKING GitHub to their existing
		// user; a signed-out caller is SIGNING IN with it. Gating this leg on a session is
		// what made a wallet the only door onto a node (task.5042) — the attestation could
		// only ever attach to a user who had already arrived some other way.
		auth: { mode: "none" },
	},
	async (ctx, request) => {
        try {
        const intent = request.headers.get("X-Cogni-Identity-Intent");
        if (intent !== null && intent !== "link") return NextResponse.json({ errorCode: "invalid_identity_intent" }, { status: 400 });
        let credential;
        try { credential = await effectiveSessionCredential(); } catch { return NextResponse.json({ errorCode: "local_session_unavailable" }, { status: 503 }); }
        const sessionUser = await getServerSessionUser();
        if (credential.invalidName || (!sessionUser && (intent === "link" || credential.present))) {
          ctx.log.info({ event: "identity.link_start_result", operation: "broker_link", outcome: "invalid_session", status: 401 }, "identity.link_start_result");
          return invalidLocalSession();
        }
		const nodeOrigin = configuredNodeOrigin();
		if (!nodeOrigin) {
			return NextResponse.json(
				{ errorCode: "node_origin_unavailable" },
				{ status: 503 },
			);
		}

		const nodeId = getNodeId();
		let issuer: string;
		try {
			issuer = getOperatorIssuerUrl();
		} catch {
			return NextResponse.json(
				{ errorCode: "operator_issuer_unavailable" },
				{ status: 503 },
			);
		}
		// Two modes, one route, chosen by session presence — a second start leg would
		// drift from this one's origin + protocol checks.
		let nonce: string;
		let returnPath: string;
		if (sessionUser) {
			nonce = await createIdentityAttestationNonce(sessionUser.id);
			returnPath = "/profile";
		} else {
			const challenge = await createSigninChallenge();
			nonce = challenge.nonce;
			returnPath = SIGNIN_COMPLETE_PATH;
			(await cookies()).set(SIGNIN_CHALLENGE_COOKIE, challenge.nonce, {
				httpOnly: true,
				secure: nodeOrigin.startsWith("https://"),
				// Lax survives the operator's top-level redirect back to us.
				sameSite: "lax",
				// Origin-wide on purpose. The completion PAGE reads the fragment, but the
				// cookie has to reach NextAuth's `/api/auth/callback/<provider>` endpoint,
				// which is where authorize() compares it to the attestation's nonce claim.
				// Scoping it to the completion path would mean it is never sent at all.
				path: "/",
				maxAge: SIGNIN_CHALLENGE_TTL_SECONDS,
			});
		}
		const authorizeUrl = new URL("/identity/attest", issuer);
		authorizeUrl.searchParams.set(
			"protocol",
			IDENTITY_ATTESTATION_V1_PROTOCOL_SHA256,
		);
		authorizeUrl.searchParams.set("node_id", nodeId);
		authorizeUrl.searchParams.set("nonce", nonce);
		authorizeUrl.searchParams.set("target_origin", nodeOrigin);
		authorizeUrl.searchParams.set("return_to", `${nodeOrigin}${returnPath}`);

        ctx.log.info({ event: "identity.link_start_result", operation: sessionUser ? "broker_link" : "anonymous_signin", outcome: "started", status: 200 }, "identity.link_start_result");
		return NextResponse.json(identityAttestationStartOperation.output.parse({ authorizeUrl: authorizeUrl.toString() }));
        } catch (error) {
            const response = identityLinkFailure(error);
            ctx.log.info({ event: "identity.link_start_result", operation: "broker_link", outcome: response.status === 401 ? "invalid_session" : response.status === 503 ? "unavailable" : "failed", status: response.status }, "identity.link_start_result");
            return response;
        }
	},
);
