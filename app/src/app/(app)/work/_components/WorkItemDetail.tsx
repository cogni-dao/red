// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/work/_components/WorkItemDetail`
 * Purpose: red's work-item Sheet around the one shared view. Binding only (story.0085, ONE_VIEW).
 * Links: hub work-item-view-capability
 * @internal
 */

"use client";

import type { CitationLinkComponent } from "@cogni/knowledge-base-ui";
import { WorkItemView } from "@cogni/knowledge-base-ui/work-item";
import type { WorkItemDto, WorkItemsGetOutput } from "@cogni/node-contracts";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ReactElement } from "react";
import {
  Markdown,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components";

import { PeekLink } from "../../_components/EntityPeek";
import { workItemClient as client } from "../_api/fetchWorkItems";
import { workItemHref } from "../_lib/workItemNavigation";

/** In-page link: stays on the page, keeps scroll, never peeks (an artifact is not a knowledge entry). */
const ScrollKeepingLink: CitationLinkComponent = ({ entityId: _id, href, ...props }) => (
  <Link href={href} scroll={false} {...props} />
);

interface WorkItemDetailProps {
  readonly item: WorkItemsGetOutput | WorkItemDto | null;
  readonly itemId?: string;
  readonly isLoading?: boolean;
  readonly error?: Error | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function WorkItemDetail({ open, onOpenChange, ...body }: WorkItemDetailProps): ReactElement {
  const searchParams = useSearchParams() ?? undefined;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <WorkItemView {...body} client={client} {...(searchParams && { searchParams })} itemHref={workItemHref}
          Link={ScrollKeepingLink} PeekLink={PeekLink} Markdown={Markdown}
          Header={SheetHeader} Title={SheetTitle} Description={SheetDescription} />
      </SheetContent>
    </Sheet>
  );
}
