"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Building2,
  Users,
  FileText,
  Presentation,
  Settings,
  LogOut,
  ClipboardList,
  Bell,
  Database,
} from "lucide-react";
import { signOut } from "next-auth/react";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Brands", href: "/brands", icon: Building2 },
  { name: "Projects", href: "/projects", icon: ClipboardList },
  { name: "Vendors", href: "/vendors", icon: Users },
  { name: "Quotations", href: "/quotations", icon: FileText },
  { name: "Presentations", href: "/presentations", icon: Presentation },
  { name: "Data", href: "/data", icon: Database },
  { name: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const name = session?.user?.name || "User";

  return (
    <div className="flex h-full w-64 flex-col bg-[#1a1a1a] text-white shadow-[8px_0_24px_-4px_rgba(232,122,30,0.15)] relative z-10">
      <div className="flex items-center justify-center px-4 py-4">
        <img src="/logo.png" alt="BTLbro" className="w-full h-auto object-contain" />
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2">
        {navigation.map((item) => {
          const isActive = pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                isActive
                  ? "bg-[#E87A1E] text-white shadow-md shadow-[#E87A1E]/20"
                  : "text-gray-400 hover:bg-white/5 hover:text-white"
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 pb-4">
        <div className="flex items-center justify-center gap-3 rounded-lg bg-white/5 px-3 py-2.5">
          <div className="h-9 w-9 rounded-full bg-[#E87A1E]/20 flex items-center justify-center shrink-0 cursor-pointer" title={name}>
            <span className="text-[#E87A1E] font-semibold text-sm" suppressHydrationWarning>
              {name.charAt(0)}
            </span>
          </div>

          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="h-9 w-9 rounded-full bg-white/5 flex items-center justify-center text-gray-400 hover:bg-white/10 hover:text-white transition-all"
            title="Sign Out"
          >
            <LogOut className="h-4 w-4" />
          </button>

          <button
            className="relative h-9 w-9 rounded-full bg-white/5 flex items-center justify-center text-gray-400 hover:bg-white/10 hover:text-white transition-all"
            title="Notifications"
          >
            <Bell className="h-4 w-4" />
            <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-[#E87A1E] text-[8px] font-bold text-white flex items-center justify-center">
              3
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
