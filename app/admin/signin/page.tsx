import GridShape from "@/components/admin/common/GridShape";
import SignInForm from "@/components/admin/auth/SignInForm";
import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In | inyoAdmin",
  description: "Sign in to inyoAdmin",
};

export default function SignInPage() {
  return (
    <div className="relative p-6 bg-white z-1 dark:bg-gray-900 sm:p-0">
      <div className="relative flex lg:flex-row w-full h-screen justify-center flex-col dark:bg-gray-900 sm:p-0">
        <SignInForm />
        <div className="lg:w-1/2 w-full h-full bg-brand-950 dark:bg-white/5 lg:grid items-center hidden">
          <div className="relative items-center justify-center flex z-1">
            <GridShape />
            <div className="flex flex-col items-center max-w-xs">
              <Link href="/admin" className="block mb-4">
                <Image
                  width={112}
                  height={112}
                  src="/logo.png"
                  alt="inyoAdmin"
                  className="h-28 w-28 object-contain drop-shadow-4xl"
                />
              </Link>
              <p className="text-center text-base font-semibold tracking-tight text-gray-200 dark:text-white/90">
                inyoAdmin
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
