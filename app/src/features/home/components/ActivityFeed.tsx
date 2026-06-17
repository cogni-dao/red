// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/home/components/ActivityFeed`
 * Purpose: Live Red findings feed with status counters and expandable signals.
 * Scope: Presentational. All copy and data comes from `../content`.
 * Invariants: none
 * Side-effects: heartbeat timer
 * Links: src/features/home/content.ts
 */

"use client";

import { cn } from "@cogni/node-ui-kit/util/cn";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  BrainCircuit,
  ChevronRight,
  Minus,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";

import {
  FEED_SECTION,
  FEED_SIGNALS,
  FEED_STATUS,
  type FeedSignal,
  type SignalDirection,
} from "../content";

type FeedState = "scanning" | "attacking" | "idle";

function HeartbeatDot({ state }: { state: FeedState }): ReactElement {
  const color =
    state === "scanning"
      ? "bg-success"
      : state === "attacking"
        ? "bg-primary"
        : "bg-muted-foreground";
  return (
    <span className="relative flex size-2.5">
      <span
        className={cn(
          "absolute inline-flex size-full animate-ping rounded-full opacity-75",
          color
        )}
      />
      <span className={cn("relative inline-flex size-2.5 rounded-full", color)} />
    </span>
  );
}

function DirectionBadge({
  direction,
}: {
  direction: SignalDirection;
}): ReactElement {
  const map = {
    positive: {
      cls: "bg-success/10 text-success",
      Icon: TrendingUp,
      label: "validated",
    },
    negative: {
      cls: "bg-destructive/10 text-destructive",
      Icon: TrendingDown,
      label: "risk",
    },
    neutral: {
      cls: "bg-secondary text-muted-foreground",
      Icon: Minus,
      label: "watch",
    },
  } as const;
  const { cls, Icon, label } = map[direction];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-xs uppercase tracking-wider",
        cls
      )}
    >
      <Icon className="size-2.5" />
      {label}
    </span>
  );
}

function SignalCard({
  signal,
  index,
}: {
  signal: FeedSignal;
  index: number;
}): ReactElement {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.08 }}
      className="group rounded-lg border border-border/40 bg-card p-4 transition-colors hover:border-border/80"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className="rounded-sm bg-secondary px-1.5 py-0.5 font-mono text-muted-foreground text-xs uppercase tracking-wider">
              {signal.category}
            </span>
            <span className="text-muted-foreground/40 text-xs">
              {signal.source}
            </span>
            <span className="text-muted-foreground/30 text-xs">
              {signal.timestamp}
            </span>
          </div>
          <h4 className="font-medium text-foreground text-sm leading-snug">
            {signal.title}
          </h4>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <DirectionBadge direction={signal.direction} />
          <span className="font-mono text-muted-foreground text-xs">
            {signal.confidence}% conf
          </span>
        </div>
      </div>

      <p className="mb-2 text-muted-foreground text-xs leading-relaxed">
        {signal.thesis}
      </p>

      <div className="flex flex-wrap gap-1">
        {signal.sources.map((src) => (
          <span
            key={src}
            className="rounded-sm bg-muted px-1.5 py-0.5 text-muted-foreground/70 text-xs"
          >
            {src}
          </span>
        ))}
      </div>
    </motion.div>
  );
}

export function ActivityFeed(): ReactElement {
  const [state, setState] = useState<FeedState>("scanning");
  const [scanned, setScanned] = useState<number>(FEED_STATUS.startScanned);
  const [visible, setVisible] = useState(2);

  useEffect(() => {
    const interval = setInterval(() => {
      setScanned((prev) => prev + Math.floor(Math.random() * 6));
      setState(
        Math.random() > 0.68
          ? "attacking"
          : Math.random() > 0.25
            ? "scanning"
            : "idle"
      );
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="w-full border-border/40 border-t bg-background py-20 md:py-28">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <motion.div
          initial={false}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="mb-8"
        >
          <span className="font-mono text-primary text-xs uppercase tracking-widest">
            {FEED_SECTION.eyebrow}
          </span>
          <h2 className="mt-3 font-bold text-3xl tracking-tight sm:text-4xl">
            {FEED_SECTION.heading}
          </h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            {FEED_SECTION.subhead}
          </p>
        </motion.div>

        <motion.div
          initial={false}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-6 flex flex-wrap items-center gap-4 rounded-lg border border-border/40 bg-card p-3 sm:gap-6 sm:p-4"
        >
          <div className="flex items-center gap-2">
            <HeartbeatDot state={state} />
            <span className="font-mono text-xs uppercase tracking-wider">
              {state === "scanning" && <span className="text-success">Scanning</span>}
              {state === "attacking" && (
                <span className="text-primary">Attacking</span>
              )}
              {state === "idle" && (
                <span className="text-muted-foreground">Watching</span>
              )}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Activity className="size-3" />
            <span className="font-mono text-xs tabular-nums">
              {scanned.toLocaleString()} {FEED_STATUS.scannedLabel}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <BrainCircuit className="size-3" />
            <span className="font-mono text-xs tabular-nums">
              {FEED_STATUS.signalsToday} {FEED_STATUS.signalsLabel}
            </span>
          </div>
        </motion.div>

        <div className="space-y-3">
          <AnimatePresence>
            {FEED_SIGNALS.slice(0, visible).map((signal, i) => (
              <SignalCard key={signal.id} signal={signal} index={i} />
            ))}
          </AnimatePresence>
        </div>

        {visible < FEED_SIGNALS.length && (
          <motion.button
            type="button"
            initial={false}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            onClick={() => setVisible(FEED_SIGNALS.length)}
            className="mt-4 flex w-full items-center justify-center gap-1 rounded-lg border border-border/40 bg-card py-3 font-mono text-muted-foreground text-xs uppercase tracking-wider transition-colors hover:border-border/80 hover:text-foreground"
          >
            Show {FEED_SIGNALS.length - visible} more findings
            <ChevronRight className="size-3" />
          </motion.button>
        )}
      </div>
    </section>
  );
}
