import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./admin.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

export const metadata: Metadata = {
  title: "inyoAdmin",
  description: "inyoAdmin panel",
  icons: {
    icon: "/logo.png",
    shortcut: "/logo.png",
    apple: "/logo.png",
  },
};

export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div
      className={`${outfit.variable} font-outfit admin-root bg-gray-50 text-gray-800 dark:bg-gray-900 dark:text-white/90 min-h-screen`}
    >
      {children}
    </div>
  );
}
