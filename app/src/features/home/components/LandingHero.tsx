// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/home/components/LandingHero`
 * Purpose: Above-the-fold Red homepage hero with status, CTAs, visual backdrop,
 *   and embedded AgentStream console.
 * Scope: Homepage hero. Copy comes from `../content`.
 * Invariants: Responsive; signed-in users are redirected by the page.
 * Side-effects: timers for live counter, opens auth flow via useTryDemo
 * Links: src/features/home/content.ts, src/features/home/components/AgentStream.tsx
 */

"use client";

import { ArrowRight, Github, ShieldCheck, TrendingUp } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";

import { Button } from "@/components";
// eslint-disable-next-line no-restricted-imports
import { SparklesCore } from "@/components/vendor/shadcn-io/sparkles";

import { HERO, HERO_LINKS } from "../content";
import { useTryDemo } from "../hooks/useTryDemo";

import { AgentStream } from "./AgentStream";

function LiveCounter(): ReactElement {
  const [value, setValue] = useState(37);

  useEffect(() => {
    const interval = setInterval(() => {
      setValue((prev) => (prev >= 9999 ? 37 : prev + Math.floor(Math.random() * 5) + 1));
    }, 120);
    return () => clearInterval(interval);
  }, []);

  return (
    <span className="inline-flex items-center gap-2 font-mono text-sm tracking-widest">
      <span className="inline-block size-2 animate-pulse rounded-full bg-success" />
      <span className="text-success tabular-nums">
        {String(value).padStart(4, "0")}
      </span>
    </span>
  );
}

export function LandingHero(): ReactElement {
  const { handleTryDemo } = useTryDemo();

  return (
    <section className="relative flex w-full flex-col items-center justify-center overflow-hidden bg-background px-4 pt-28 pb-16 sm:px-6 sm:pt-32 sm:pb-20">
      <div className="pointer-events-none absolute inset-0 z-0">
        <SparklesCore
          id="red-hero-sparkles"
          background="transparent"
          minSize={0.35}
          maxSize={1}
          particleDensity={65}
          className="h-full w-full"
          // eslint-disable-next-line ui-governance/no-raw-colors -- tsparticles canvas needs a literal color
          particleColor="#FFFFFF"
        />
        {/* eslint-disable-next-line ui-governance/no-arbitrary-non-token-values -- radial mask fades particles toward the edges */}
        <div className="absolute inset-0 h-full w-full bg-background [mask-image:radial-gradient(70%_58%_at_center,transparent_8%,white)]" />
      </div>

      <div className="pointer-events-none absolute top-24 right-1/2 z-0 translate-x-1/2 opacity-[0.07] sm:top-20">
        <Image
          src="/red-node-mark.svg"
          alt=""
          width={360}
          height={360}
          priority
          className="size-64 sm:size-80"
        />
      </div>

      <div className="relative z-10 mx-auto max-w-4xl text-center">
        <div className="mb-8 inline-flex items-center gap-3 rounded-full border border-border/60 bg-background/70 px-4 py-2 backdrop-blur-sm">
          <TrendingUp className="size-3.5 text-primary" />
          <span className="text-muted-foreground text-xs uppercase tracking-widest">
            {HERO.statusLabel}
          </span>
          <LiveCounter />
        </div>

        <h1 className="font-bold text-4xl tracking-tight sm:text-6xl lg:text-7xl">
          <span className="text-foreground">{HERO.headlineTop}</span>
          <br />
          <span className="text-gradient-accent">{HERO.headlineAccent}</span>
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground sm:text-xl">
          {HERO.subhead}
        </p>

        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <Button size="lg" onClick={handleTryDemo}>
            {HERO.primaryCta}
            <ArrowRight className="ml-2 size-4" />
          </Button>
          <Button variant="outline" size="lg" asChild>
            <Link href={HERO_LINKS.sourceUrl}>
              <Github className="mr-2 size-4" />
              View source
            </Link>
          </Button>
          <Button variant="outline" size="lg" asChild>
            <Link
              href={HERO_LINKS.chatUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ShieldCheck className="mr-2 size-4" />
              Blue channel
            </Link>
          </Button>
        </div>

        <span className="mt-6 block text-muted-foreground text-xs uppercase tracking-widest">
          {HERO.ctaTagline}
        </span>

        <AgentStream />
      </div>
    </section>
  );
}
