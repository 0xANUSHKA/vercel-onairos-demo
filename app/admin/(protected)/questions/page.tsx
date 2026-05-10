import QuestionsManager from "@/components/admin/questions/QuestionsManager";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Questions | inyoAdmin",
  description: "Manage inyo onboarding questions",
};

export default function AdminQuestionsPage() {
  return <QuestionsManager />;
}
