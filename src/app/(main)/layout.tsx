"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import Link from "next/link";

const NAV_ITEMS = [
  { href: "/chat", label: "گفتگوی هوشمند", icon: "💬" },
  { href: "/search", label: "جستجو", icon: "🔍" },
  { href: "/documents", label: "اسناد", icon: "📄" },
  { href: "/knowledge", label: "پایگاه دانش", icon: "📚" },
  { href: "/experiences", label: "تجربیات سازمانی", icon: "💡" },
];

const ADMIN_ITEMS = [
  { href: "/admin", label: "مدیریت", icon: "⚙️" },
];

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated || !user) return null;

  const handleLogout = async () => {
    await logout();
    router.push("/login");
  };

  return (
    <div className="flex h-screen bg-slate-900 overflow-hidden">
      {/* Sidebar */}
      <aside
        className="w-64 flex-shrink-0 bg-slate-800 border-l border-slate-700 flex flex-col"
        style={{ direction: "rtl" }}
      >
        {/* Logo */}
        <div className="p-5 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center text-lg flex-shrink-0">
              🧠
            </div>
            <div className="min-w-0">
              <p className="text-white font-semibold text-sm truncate">هوش سازمانی</p>
              <p className="text-slate-500 text-xs truncate">{user.organizationId ? "آفلاین" : "بدون سازمان"}</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          <p className="text-slate-500 text-xs px-3 pt-2 pb-1 font-medium">ابزارها</p>
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  active
                    ? "bg-blue-600 text-white"
                    : "text-slate-400 hover:bg-slate-700 hover:text-white"
                }`}
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}

          {user.isAdmin && (
            <>
              <p className="text-slate-500 text-xs px-3 pt-4 pb-1 font-medium">مدیریت</p>
              {ADMIN_ITEMS.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                      active
                        ? "bg-blue-600 text-white"
                        : "text-slate-400 hover:bg-slate-700 hover:text-white"
                    }`}
                  >
                    <span className="text-base">{item.icon}</span>
                    {item.label}
                  </Link>
                );
              })}
            </>
          )}
        </nav>

        {/* User footer */}
        <div className="p-3 border-t border-slate-700">
          <div className="flex items-center gap-3 px-2 py-2 rounded-lg">
            <div className="w-8 h-8 bg-blue-700 rounded-full flex items-center justify-center text-sm font-semibold text-white flex-shrink-0">
              {user.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm truncate font-medium">{user.name}</p>
              <p className="text-slate-500 text-xs truncate">{user.roles[0] ?? "کاربر"}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full mt-1 text-slate-500 hover:text-white text-xs py-1.5 rounded-lg hover:bg-slate-700 transition-colors flex items-center justify-center gap-1"
          >
            🚪 خروج
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden" style={{ direction: "rtl" }}>
        {children}
      </main>
    </div>
  );
}
