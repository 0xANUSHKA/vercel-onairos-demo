"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Status = "checking" | "authenticated" | "unauthenticated";

export default function AdminAuthGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) {
        setStatus("authenticated");
      } else {
        setStatus("unauthenticated");
        router.replace("/admin/signin");
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (session) {
        setStatus("authenticated");
      } else {
        setStatus("unauthenticated");
        router.replace("/admin/signin");
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  if (status !== "authenticated") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-brand-500" />
          {status === "checking" ? "Checking session…" : "Redirecting…"}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
