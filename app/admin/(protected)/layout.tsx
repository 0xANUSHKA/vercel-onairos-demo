import AdminAuthGuard from "@/components/admin/auth/AdminAuthGuard";
import AdminShell from "@/components/admin/dashboard/AdminShell";

export default function ProtectedAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AdminAuthGuard>
      <AdminShell>{children}</AdminShell>
    </AdminAuthGuard>
  );
}
