import DashboardOverview from "@/components/admin/dashboard/DashboardOverview";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard | inyoAdmin",
  description: "inyoAdmin overview dashboard",
};

export default function AdminDashboardPage() {
  return <DashboardOverview />;
}
