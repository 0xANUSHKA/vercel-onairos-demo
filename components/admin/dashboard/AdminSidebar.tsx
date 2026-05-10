"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

const navItems: {
  name: string;
  href: string;
  active: (pathname: string) => boolean;
}[] = [
  { name: "Dashboard", href: "/admin", active: (p) => p === "/admin" },
  { name: "Waitlist", href: "/admin/waitlist", active: (p) => p === "/admin/waitlist" },
  {
    name: "Participants",
    href: "/admin/participants",
    active: (p) =>
      p === "/admin/participants" ||
      (p.startsWith("/admin/participants/") && !p.startsWith("/admin/participants/complete/")),
  },
  {
    name: "Male participants (complete)",
    href: "/admin/participants/complete/male",
    active: (p) => p === "/admin/participants/complete/male",
  },
  {
    name: "Female participants (complete)",
    href: "/admin/participants/complete/female",
    active: (p) => p === "/admin/participants/complete/female",
  },
  {
    name: "Matches",
    href: "/admin/matches",
    active: (p) => p === "/admin/matches",
  },
  {
    name: "Proposed Matches",
    href: "/admin/proposed-matches",
    active: (p) => p === "/admin/proposed-matches",
  },
  { name: "Questions", href: "/admin/questions", active: (p) => p === "/admin/questions" },
  { name: "SMS Test", href: "/admin/sms-test", active: (p) => p === "/admin/sms-test" },
];

export default function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 z-40 hidden h-screen w-[290px] border-r border-gray-200 bg-white px-5 lg:block dark:border-gray-800 dark:bg-gray-900">
      <div className="flex h-[88px] items-center">
        <Link href="/admin" className="inline-flex items-center gap-3">
          <Image
            src="/logo.png"
            alt="inyoAdmin"
            width={100}
            height={100}
            className="rounded-md shadow-theme-xs"
          />
          <span className="text-base font-bold tracking-tight text-gray-900 dark:text-white">
            inyoAdmin
          </span>
        </Link>
      </div>

      <nav className="mt-3">
        <p className="mb-4 text-xs uppercase tracking-wide text-gray-400">Menu</p>
        <ul className="space-y-2">
          {navItems.map((item) => {
            const active = item.active(pathname);
            return (
              <li key={item.name}>
                <Link
                  href={item.href}
                  className={`flex items-center rounded-lg px-3 py-2 text-sm font-medium transition ${
                    active
                      ? "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400"
                      : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5"
                  }`}
                >
                  {item.name}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
