import type { Metadata } from "next";
import CompletedParticipantsList from "@/components/admin/participants/CompletedParticipantsList";

export const metadata: Metadata = {
  title: "inyo — Female participants (complete)",
  description: "Onboarding complete — female track",
};

export default function AdminFemaleCompletePage() {
  return <CompletedParticipantsList track="FEMALE" />;
}
