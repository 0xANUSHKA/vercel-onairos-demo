import type { Metadata } from "next";
import CompletedParticipantsList from "@/components/admin/participants/CompletedParticipantsList";

export const metadata: Metadata = {
  title: "inyo — Male participants (complete)",
  description: "Onboarding complete — male track",
};

export default function AdminMaleCompletePage() {
  return <CompletedParticipantsList track="MALE" />;
}
