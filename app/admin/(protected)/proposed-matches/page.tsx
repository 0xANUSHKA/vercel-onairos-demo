import type { Metadata } from "next";
import ProposedMatchesPanel from "@/components/admin/matches/ProposedMatchesPanel";

export const metadata: Metadata = {
  title: "inyo — Proposed Matches",
  description: "Pending match proposals awaiting founder review",
};

export default function AdminProposedMatchesPage() {
  return <ProposedMatchesPanel />;
}
