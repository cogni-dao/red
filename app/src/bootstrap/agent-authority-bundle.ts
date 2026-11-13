// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@bootstrap/agent-authority-bundle`
 * Purpose: The contracts this node's tool authority reads `requires` from: the catalog bundle plus the one route-only declaration.
 * Scope: Composition only. Declares nothing the package does not already own.
 * Invariants: `core__work_item_update` is the tool whose route twin is the work-items PATCH door, so the authority reads its `requires`
 *   (scope `work_item:transition`). Red keeps that tool out of its catalog (no program may write through it), so it is declared here
 *   for the door and is never bound or offered to a graph.
 * Side-effects: none
 * @internal
 */

import { type CatalogBoundTool, CORE_TOOL_BUNDLE } from "@cogni/ai-tools";
import { workItemUpdateBoundTool } from "@cogni/shared-ai-tools";

export const AGENT_AUTHORITY_TOOL_BUNDLE: readonly CatalogBoundTool[] = [
	...CORE_TOOL_BUNDLE,
	workItemUpdateBoundTool as CatalogBoundTool,
];
