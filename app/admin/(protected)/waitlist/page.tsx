import WaitlistTable from "@/components/admin/dashboard/WaitlistTable";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Waitlist | inyoAdmin",
  description: "inyoAdmin waitlist entries",
};

export default function AdminWaitlistPage() {
  return <WaitlistTable />;
}
