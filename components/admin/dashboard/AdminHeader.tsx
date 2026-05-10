"use client";

import SignOutButton from "@/components/admin/auth/SignOutButton";
import { usePathname } from "next/navigation";

export default function AdminHeader() {
  const pathname = usePathname();
  const isWaitlistPage = pathname === "/admin/waitlist";
  const isQuestionsPage = pathname === "/admin/questions";
  const isParticipantsList = pathname === "/admin/participants";
  const isParticipantDetail = pathname?.startsWith("/admin/participants/") && !isParticipantsList;

  return (
    <header className="sticky top-0 z-30 border-b border-gray-200 bg-white px-4 py-4 md:px-6 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-gray-400">
            {isQuestionsPage
              ? "Questions"
              : isWaitlistPage
                ? "Waitlist"
                : isParticipantsList || isParticipantDetail
                  ? "Participants"
                  : "Dashboard"}
          </p>
          <h1 className="mt-1 text-xl font-semibold text-gray-800 dark:text-white/90">
            {isQuestionsPage
              ? "Questions Management"
              : isWaitlistPage
                ? "Waitlist Entries"
                : isParticipantsList
                  ? "Onboarding participants"
                  : isParticipantDetail
                    ? "Participant details"
                    : "Dashboard Overview"}
          </h1>
        </div>
        <SignOutButton />
      </div>
    </header>
  );
}
