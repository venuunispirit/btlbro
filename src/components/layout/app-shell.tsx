"use client";

import { SessionProvider } from "next-auth/react";
import { useTheme } from "@/components/theme-provider";
import { Sidebar } from "./sidebar";
import { Header } from "./header";

function AppContent({ children, title }: { children: React.ReactNode; title?: string }) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    <div className={`flex h-screen overflow-hidden ${isDark ? "bg-[#1a1a1a]" : "bg-[#f5f5f5]"}`}>
      <Sidebar />
      <div className="theme-content flex-1 flex flex-col overflow-hidden relative">
        <Header title={title} />
        <main className={`flex-1 overflow-y-auto pt-20 pb-6 px-6 transition-colors ${isDark ? "bg-[#1a1a1a]" : "bg-[#f5f5f5]"}`}>
          {children}
        </main>
      </div>
    </div>
  );
}

export function AppShell({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <SessionProvider>
      <AppContent title={title}>{children}</AppContent>
    </SessionProvider>
  );
}
