import type { Metadata } from "next";
import { Suspense } from "react";
import ParticipantDetailForm from "@/components/admin/participants/ParticipantDetailForm";

export const metadata: Metadata = {
  title: "inyo — Participant",
  description: "Edit participant onboarding",
};

function DetailFallback() {
  return <p className="text-sm text-gray-500">Loading…</p>;
}

export default function AdminParticipantDetailPage() {
  return (
    <Suspense fallback={<DetailFallback />}>
      <ParticipantDetailForm />
    </Suspense>
  );
}
