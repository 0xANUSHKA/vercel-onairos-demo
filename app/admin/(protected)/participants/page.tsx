import type { Metadata } from "next";
import ParticipantsList from "@/components/admin/participants/ParticipantsList";

export const metadata: Metadata = {
  title: "inyo — Participants",
  description: "Onboarding participants and answers",
};

export default function AdminParticipantsPage() {
  return <ParticipantsList />;
}
