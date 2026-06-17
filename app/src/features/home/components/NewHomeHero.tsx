// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/home/components/NewHomeHero`
 * Purpose: Mission-specific hero section for the red node homepage.
 * Scope: Homepage only. Does not handle global layout.
 * Invariants: None.
 * Side-effects: none
 * Links: src/features/home/hooks/useTryDemo.ts
 */

"use client";

import {
  ArrowRight,
  Crosshair,
  Github,
  Radar,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import Link from "next/link";
import type { ReactElement } from "react";

import { Button } from "@/components";

import { useTryDemo } from "../hooks/useTryDemo";

const ATTACK_PATH_STEPS = [
  "Recon exposed assets",
  "Model likely paths",
  "Prioritize defenses",
] as const;

export function NewHomeHero(): ReactElement {
  const { handleTryDemo } = useTryDemo();

  return (
    <section className="relative w-full overflow-hidden border-border border-b bg-background">
      <div className="mx-auto grid w-full max-w-7xl items-center gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:py-24">
        <div className="max-w-3xl">
          <div className="mb-5 inline-flex items-center gap-2 rounded-md border border-primary/25 bg-primary/10 px-3 py-1 font-medium text-primary text-sm">
            <Crosshair className="size-4" aria-hidden="true" />
            cogni/red
          </div>
          <h1 className="font-bold text-4xl text-foreground tracking-tight sm:text-5xl lg:text-6xl">
            Adversarial security intelligence for defenders.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-muted-foreground sm:text-xl">
            Red maps attack paths, stress-tests assumptions, and turns offensive
            research into prioritized defense moves for the blue side of the
            network.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button size="lg" onClick={handleTryDemo}>
              Open red chat
              <ArrowRight className="ml-2 size-4" />
            </Button>
            <Button variant="outline" size="lg" asChild>
              <Link href="https://github.com/cogni-dao/red">
                <Github className="mr-2 size-4" />
                View source
              </Link>
            </Button>
          </div>
        </div>

        <div className="relative">
          <div className="rounded-lg border border-border bg-card p-4 shadow-lg">
            <div className="mb-4 flex items-center justify-between border-border border-b pb-3">
              <div className="flex items-center gap-2 font-medium text-foreground text-sm">
                <Terminal className="size-4 text-primary" aria-hidden="true" />
                attack-path console
              </div>
              <span className="rounded-md bg-primary/10 px-2 py-1 font-medium text-primary text-xs">
                live
              </span>
            </div>
            <div className="space-y-3">
              {ATTACK_PATH_STEPS.map((step, index) => (
                <div
                  key={step}
                  className="flex items-center gap-3 rounded-md border border-border bg-background p-3"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 font-semibold text-primary text-sm">
                    {index + 1}
                  </span>
                  <span className="font-medium text-foreground text-sm">
                    {step}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-border bg-muted/40 p-4">
                <Radar className="mb-3 size-5 text-primary" aria-hidden="true" />
                <div className="font-semibold text-foreground text-sm">
                  Recon ready
                </div>
                <p className="mt-1 text-muted-foreground text-sm">
                  Surface unknowns before they become incidents.
                </p>
              </div>
              <div className="rounded-md border border-border bg-muted/40 p-4">
                <ShieldCheck
                  className="mb-3 size-5 text-primary"
                  aria-hidden="true"
                />
                <div className="font-semibold text-foreground text-sm">
                  Defense linked
                </div>
                <p className="mt-1 text-muted-foreground text-sm">
                  Hand blue the controls that matter first.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
