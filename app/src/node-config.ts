import type { NodeAppConfig } from "@cogni/node-app/extensions";
import {
  Briefcase,
  CreditCard,
  Github,
  LayoutDashboard,
  Vote,
} from "lucide-react";
import { DiscordIcon } from "@/components";

export const nodeConfig: NodeAppConfig = {
  name: "cogni/red",
  logo: { src: "/red-node-mark.svg", alt: "cogni/red", href: "/chat" },
  navItems: [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/work", label: "Work", icon: Briefcase },
    { href: "/gov", label: "Gov", icon: Vote },
    { href: "/credits", label: "Credits", icon: CreditCard },
  ],
  externalLinks: [
    {
      href: "https://github.com/cogni-dao/red",
      label: "GitHub",
      icon: Github,
    },
    {
      href: "https://discord.gg/3b9sSyhZ4z",
      label: "Discord",
      icon: DiscordIcon,
    },
  ],
};
