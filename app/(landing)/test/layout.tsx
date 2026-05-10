import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "inyo — landing test",
  robots: { index: false, follow: false },
};

export default function TestRouteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
