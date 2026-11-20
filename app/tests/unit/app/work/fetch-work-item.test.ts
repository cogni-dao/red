// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/** Covers the bounded summary/board fetchers (task.0056). The item read is the package client (story.0085), proven in knowledge-base-ui. */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchWorkBoard,
  fetchWorkItems,
  WorkItemFetchError,
} from "@/app/(app)/work/_api/fetchWorkItems";

describe("bounded work list fetchers (task.0056)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetchWorkItems requests exactly one summaries page and never follows its cursor", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          items: [{ id: "task.1" }],
          pageInfo: { endCursor: "next", hasMore: true },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;

    const page = await fetchWorkItems(
      new URLSearchParams("statuses=needs_implement&limit=25"),
      signal
    );

    expect(page.pageInfo).toEqual({ endCursor: "next", hasMore: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/work/summaries?statuses=needs_implement&limit=25",
      expect.objectContaining({ signal, credentials: "same-origin" })
    );
  });

  it("fetchWorkBoard requests one board and carries the HTTP status on failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: "invalid input" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchWorkBoard(new URLSearchParams("statuses=nope"))
    ).rejects.toMatchObject({ name: "WorkItemFetchError", status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/work/board?statuses=nope"
    );
  });
});
