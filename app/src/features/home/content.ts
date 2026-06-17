// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/home/content`
 * Purpose: Single customization surface for the public Red landing page.
 * Scope: Public homepage content. No logic, no IO; pure data for the landing
 *   page components.
 * Invariants: Shapes stay stable so layout components remain generic.
 * Side-effects: none
 * Links: src/features/home/components/LandingHero.tsx,
 *   src/features/home/components/ShowcaseCards.tsx,
 *   src/features/home/components/ActivityFeed.tsx,
 *   src/features/home/components/AgentStream.tsx,
 *   src/features/home/components/HomeStats.tsx
 * @public
 */

import {
  Activity,
  BrainCircuit,
  CheckCircle,
  Crosshair,
  Network,
  Radar,
  Search,
  ShieldCheck,
  Sparkles,
  Swords,
  type LucideIcon,
} from "lucide-react";

export interface HeroContent {
  statusLabel: string;
  headlineTop: string;
  headlineAccent: string;
  subhead: string;
  primaryCta: string;
  ctaTagline: string;
}

export const HERO: HeroContent = {
  statusLabel: "Red cell online",
  headlineTop: "Continuously attack",
  headlineAccent: "the Cogni network.",
  subhead:
    "Red is the adversarial AI node for Cogni: it maps live attack surface, probes for exploitable paths, and turns findings into blue-team fixes before they become incidents.",
  primaryCta: "Open red chat",
  ctaTagline: "Recon. Exploit hypothesis. Blue handoff. Regression watch.",
};

export const HERO_LINKS = {
  chatUrl: "https://discord.gg/3b9sSyhZ4z",
  sourceUrl: "https://github.com/cogni-dao/red",
} as const;

export type StreamEventType =
  | "thinking"
  | "searching"
  | "analyzing"
  | "signal"
  | "done";

export interface StreamEvent {
  id: string;
  type: StreamEventType;
  text: string;
  at: number;
}

export const AGENT_STREAM_SUBJECT = "cogni/red";

export const AGENT_STREAM_SEQUENCES: StreamEvent[][] = [
  [
    {
      id: "dao-1",
      type: "thinking",
      text: "Loading current Cogni graph: repos, workflows, node APIs, deploy slots",
      at: 0,
    },
    {
      id: "dao-2",
      type: "searching",
      text: "Scanning PR diffs, candidate endpoints, route manifests, and auth seams",
      at: 1600,
    },
    {
      id: "dao-3",
      type: "analyzing",
      text: "Building attack paths across token scope, agent registration, and CI handoff",
      at: 3400,
    },
    {
      id: "dao-4",
      type: "signal",
      text: "Signal: candidate auth proves API access, not browser session. File blue-team clarification.",
      at: 5400,
    },
    {
      id: "dao-5",
      type: "done",
      text: "Pass complete. Finding queued with reproducer, impact, and fix owner.",
      at: 7200,
    },
  ],
  [
    {
      id: "playbook-1",
      type: "thinking",
      text: "Selecting next playbook: public node launch surface",
      at: 0,
    },
    {
      id: "playbook-2",
      type: "searching",
      text: "Testing DNS, version pin, screenshot provenance, and signed-in route claims",
      at: 1800,
    },
    {
      id: "playbook-3",
      type: "analyzing",
      text: "Separating deploy health from user-visible browser reachability",
      at: 3600,
    },
    {
      id: "playbook-4",
      type: "signal",
      text: "Signal: forced resolver validation is insufficient for launch acceptance.",
      at: 5400,
    },
    {
      id: "playbook-5",
      type: "done",
      text: "Blue handoff ready: add a normal-DNS gate before marking deploy_verified.",
      at: 7000,
    },
  ],
  [
    {
      id: "external-1",
      type: "thinking",
      text: "vNext target model: permissioned external company program",
      at: 0,
    },
    {
      id: "external-2",
      type: "searching",
      text: "Mapping exposed SaaS, repos, cloud posture, vendor trust, and incident history",
      at: 1800,
    },
    {
      id: "external-3",
      type: "analyzing",
      text: "Generating safe exploit hypotheses with severity, proof limits, and disclosure path",
      at: 3600,
    },
    {
      id: "external-4",
      type: "done",
      text: "Pass complete. Customer-facing red team package drafted for approval.",
      at: 5600,
    },
  ],
];

export interface ShowcaseOutcome {
  label: string;
  value: number;
}

export interface ShowcaseItem {
  id: string;
  title: string;
  category: string;
  source: string;
  metric: string;
  change: number;
  outcomes: [ShowcaseOutcome, ShowcaseOutcome];
  footerLeft: string;
  footerRight: string;
}

export const SHOWCASE_SECTION = {
  eyebrow: "Red vs blue loop",
  heading: "A constant adversarial game inside Cogni.",
  subhead:
    "Red does not wait for a security review. It keeps looking, attacking within scope, and handing blue teams the evidence they need to patch, verify, and harden the network.",
} as const;

export const SHOWCASE_CATEGORIES = [
  "All",
  "Recon",
  "Attack",
  "Handoff",
  "vNext",
] as const;

export const SHOWCASE_ITEMS: ShowcaseItem[] = [
  {
    id: "surface",
    title: "Maintain a live attack map of the DAO network",
    category: "Recon",
    source: "Repos + deploys + APIs",
    metric: "24/7",
    change: 18,
    outcomes: [
      { label: "Known", value: 72 },
      { label: "Unknown", value: 28 },
    ],
    footerLeft: "Nodes, routes, workflows",
    footerRight: "Continuous",
  },
  {
    id: "exploit",
    title: "Turn weak signals into safe exploit hypotheses",
    category: "Attack",
    source: "Playbook engine",
    metric: "P0-P3",
    change: 11,
    outcomes: [
      { label: "Validated", value: 41 },
      { label: "Rejected", value: 59 },
    ],
    footerLeft: "Repro + blast radius",
    footerRight: "Scoped tests",
  },
  {
    id: "blue",
    title: "Move every real finding into a blue-team fix track",
    category: "Handoff",
    source: "Issue + PR loop",
    metric: "SLA",
    change: 9,
    outcomes: [
      { label: "Mitigated", value: 66 },
      { label: "Open", value: 34 },
    ],
    footerLeft: "Owner, patch, regression",
    footerRight: "Governed",
  },
  {
    id: "external",
    title: "Package Red for permissioned company attack surfaces",
    category: "vNext",
    source: "External program",
    metric: "B2B",
    change: 15,
    outcomes: [
      { label: "Inside", value: 52 },
      { label: "External", value: 48 },
    ],
    footerLeft: "SaaS, cloud, code, vendors",
    footerRight: "Next market",
  },
];

export type SignalDirection = "positive" | "negative" | "neutral";

export interface FeedSignal {
  id: string;
  title: string;
  category: string;
  source: string;
  direction: SignalDirection;
  confidence: number;
  thesis: string;
  sources: string[];
  timestamp: string;
}

export const FEED_SECTION = {
  eyebrow: "Live findings",
  heading: "Every attack becomes an accountable fix.",
  subhead:
    "The point is not theater. A Red signal is useful only when it gives Blue a clear proof, owner, mitigation path, and regression check the DAO can inspect.",
} as const;

export const FEED_STATUS = {
  scannedLabel: "surfaces scanned",
  signalsLabel: "findings today",
  startScanned: 8407,
  signalsToday: 17,
} as const;

export const FEED_SIGNALS: FeedSignal[] = [
  {
    id: "dns",
    title: "Launch validation split: deploy healthy, browser DNS not proven",
    category: "Handoff",
    source: "candidate-a",
    direction: "negative",
    confidence: 94,
    thesis:
      "A forced host resolver can prove the app serves behind Cloudflare, but it cannot prove a normal visitor can reach the node. Blue should require normal DNS resolution before deploy_verified.",
    sources: ["Flight logs", "Browser error", "Version endpoint"],
    timestamp: "2m ago",
  },
  {
    id: "auth",
    title: "Agent bearer token is not a signed-in web session",
    category: "Attack",
    source: "auth seam",
    direction: "neutral",
    confidence: 91,
    thesis:
      "API registration and browser auth are different trust paths. Red treats any claim of signed-in UX as unproven until a real session cookie reaches a gated page.",
    sources: ["Agent register", "Chat redirect", "NextAuth session"],
    timestamp: "6m ago",
  },
  {
    id: "blue-pr",
    title: "Blue queue requires fix owner and regression check",
    category: "Handoff",
    source: "security workflow",
    direction: "positive",
    confidence: 83,
    thesis:
      "Findings become useful when they are reproducible and owned. The handoff should include severity, proof limits, patch candidate, and a test that keeps the path closed.",
    sources: ["Issue template", "PR checks", "Runbook"],
    timestamp: "11m ago",
  },
  {
    id: "external-company",
    title: "External-company Red needs permission boundaries first",
    category: "vNext",
    source: "market expansion",
    direction: "positive",
    confidence: 78,
    thesis:
      "The same loop can serve companies, but only with explicit scope, evidence handling, disclosure terms, and proof-of-exploit limits before autonomous probing starts.",
    sources: ["Scope letter", "Asset inventory", "Disclosure policy"],
    timestamp: "19m ago",
  },
];

export interface StatItem {
  value: string;
  label: string;
}

export const STATS: StatItem[] = [
  { value: "Recon", label: "Map exposed surface" },
  { value: "Attack", label: "Probe scoped paths" },
  { value: "Blue", label: "Patch with owners" },
  { value: "vNext", label: "Serve external teams" },
];

export const STREAM_ICONS: Record<StreamEventType, LucideIcon> = {
  thinking: BrainCircuit,
  searching: Search,
  analyzing: Activity,
  signal: Sparkles,
  done: CheckCircle,
};

export const SECTION_ICON: LucideIcon = Network;
export const HERO_ICON: LucideIcon = Crosshair;
export const ATTACK_ICON: LucideIcon = Swords;
export const RECON_ICON: LucideIcon = Radar;
export const BLUE_ICON: LucideIcon = ShieldCheck;
