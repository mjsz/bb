// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { conversationRow, turnRow } from "@/test/fixtures/thread-timeline-rows";
import { ThreadTimelineRows } from "./ThreadTimelineRows";

class ResizeObserverStub implements ResizeObserver {
  constructor(readonly callback: ResizeObserverCallback) {}

  observe: ResizeObserver["observe"] = vi.fn();
  unobserve: ResizeObserver["unobserve"] = vi.fn();
  disconnect: ResizeObserver["disconnect"] = vi.fn();
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFinePointerScrollAnchoring(): void {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
  vi.stubGlobal("CSS", {
    supports: (property: string, value: string) =>
      property === "overflow-anchor" && value === "none",
  });
}

function renderTimelineHeight(threadRuntimeDisplayStatus: "active" | "idle") {
  const queryClient = new QueryClient();
  const view = render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ThreadTimelineRows
          threadId="thr_main"
          timelineRows={[
            conversationRow({
              id: "user_message",
              role: "user",
              seq: 1,
              text: "Request",
            }),
          ]}
          threadRuntimeDisplayStatus={threadRuntimeDisplayStatus}
          workspaceRootPath={undefined}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const rowList = view.container.querySelector<HTMLElement>(
    '[data-timeline-row-list="top-level"]',
  );
  const heightWrapper = rowList?.parentElement?.parentElement;
  if (!heightWrapper) {
    throw new Error("Timeline height wrapper was not rendered");
  }
  return heightWrapper;
}

it("snaps active timeline growth while idle timelines retain desktop easing", () => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  stubFinePointerScrollAnchoring();

  expect(renderTimelineHeight("active").style.transition).toContain(
    "height 0ms",
  );

  cleanup();

  expect(renderTimelineHeight("idle").style.transition).toContain(
    "height 180ms",
  );
});

it("snap-syncs the timeline height when older rows are prepended", () => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return (
        this.querySelectorAll(
          '[data-timeline-row-list="top-level"] > [data-timeline-row-id]',
        ).length * 100
      );
    },
  );

  const latestRows = [
    conversationRow({
      id: "newer_user",
      role: "user",
      seq: 20,
      text: "Newest request",
    }),
    turnRow({ id: "newest_turn", seq: 21, status: "completed" }),
  ];
  const olderRows = [
    conversationRow({
      id: "older_user",
      role: "user",
      seq: 10,
      text: "Older request",
    }),
    turnRow({ id: "older_turn", seq: 11, status: "completed" }),
  ];
  const queryClient = new QueryClient();
  const timeline = (rows: typeof latestRows) => (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ThreadTimelineRows
          threadId="thr_main"
          timelineRows={rows}
          threadRuntimeDisplayStatus="idle"
          workspaceRootPath={undefined}
        />
      </QueryClientProvider>
    </MemoryRouter>
  );
  const view = render(timeline(latestRows));
  const rowList = view.container.querySelector<HTMLElement>(
    '[data-timeline-row-list="top-level"]',
  );
  const heightWrapper = rowList?.parentElement?.parentElement;

  expect(heightWrapper?.style.height).toBe("200px");

  view.rerender(timeline([...olderRows, ...latestRows]));

  expect(heightWrapper?.style.height).toBe("400px");
  expect(heightWrapper?.style.transitionDuration).toBe("0s");
});
