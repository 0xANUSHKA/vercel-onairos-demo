import type { Metadata } from "next";
import IntroducedMatchesPanel from "@/components/admin/matches/IntroducedMatchesPanel";

export const metadata: Metadata = {
  title: "inyo — Matches",
  description: "Introduced matches",
};

export default function AdminMatchesPage() {
  return <IntroducedMatchesPanel />;
}
