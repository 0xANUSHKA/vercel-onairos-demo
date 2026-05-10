"use client";

import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SignOutButton({
  className,
}: {
  className?: string;
}) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    await supabase.auth.signOut();
    router.replace("/admin/signin");
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={signingOut}
      className={
        className ??
        "inline-flex items-center justify-center rounded-lg bg-gray-100 px-5 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-200 disabled:opacity-50 dark:bg-white/5 dark:text-white/90 dark:hover:bg-white/10"
      }
    >
      {signingOut ? "Signing out…" : "Sign out"}
    </button>
  );
}
