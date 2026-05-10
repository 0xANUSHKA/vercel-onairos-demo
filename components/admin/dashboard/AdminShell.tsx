import AdminHeader from "@/components/admin/dashboard/AdminHeader";
import AdminSidebar from "@/components/admin/dashboard/AdminSidebar";

export default function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen xl:flex">
      <AdminSidebar />
      <div className="min-h-screen flex-1 transition-all duration-300 ease-in-out lg:ml-[290px]">
        <AdminHeader />
        <main className="p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
