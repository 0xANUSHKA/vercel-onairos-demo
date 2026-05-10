import { GlassFilter } from "@/components/ui/liquid-glass-button";
import type { Metadata } from "next";
import "./landing.css";

export const metadata: Metadata = {
  title: "inyo — SMS Matchmaking for NYC Singles",
  description: "No app. No swiping. Just a text when we find your person.",
  icons: {
    icon: "/logo.png",
    shortcut: "/logo.png",
    apple: "/logo.png",
  },
};

export default function LandingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link
        rel="preconnect"
        href="https://fonts.gstatic.com"
        crossOrigin="anonymous"
      />
      <link
        href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap"
        rel="stylesheet"
      />
      <div className="landing-root flex flex-col min-h-screen">
        <GlassFilter />
        {children}
      </div>
    </>
  );
}
