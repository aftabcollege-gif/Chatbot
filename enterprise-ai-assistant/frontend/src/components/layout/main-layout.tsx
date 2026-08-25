import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  MessageSquare,
  FolderOpen,
  BookOpen,
  Search,
  Shield,
  Settings,
  Users,
  ScrollText,
  Activity,
  Cpu,
  Globe,
  LogOut,
  Moon,
  Sun,
  User as UserIcon,
} from "lucide-react";
import { useAuth } from "@/store/auth";
import { useTheme } from "@/store/theme";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/chat", icon: MessageSquare, label: "گفتگو" },
  { to: "/resources", icon: FolderOpen, label: "منابع", perm: "resources.view" },
  { to: "/knowledge", icon: BookOpen, label: "دانش سازمانی", perm: "knowledge.view" },
  { to: "/search", icon: Search, label: "جستجو" },
];

const adminNav = [
  { to: "/admin", icon: Activity, label: "داشبورد", end: true },
  { to: "/admin/users", icon: Users, label: "کاربران" },
  { to: "/admin/roles", icon: Shield, label: "نقش‌ها" },
  { to: "/admin/web-sources", icon: Globe, label: "منابع وب" },
  { to: "/admin/logs", icon: ScrollText, label: "لاگ‌ها" },
  { to: "/admin/models", icon: Cpu, label: "مدل‌ها" },
  { to: "/admin/health", icon: Activity, label: "سلامت" },
  { to: "/admin/settings", icon: Settings, label: "تنظیمات" },
];

function initials(name: string) {
  return name.trim().slice(0, 2);
}

export function MainLayout() {
  const { user, logout, hasPermission } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const isAdmin = user?.is_superadmin || user?.permissions.includes("admin.users");

  return (
    <div className="flex h-full bg-background">
      <aside className="w-64 shrink-0 border-l flex flex-col bg-card">
        <div className="h-16 flex items-center gap-3 px-5 border-b">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            <MessageSquare className="h-5 w-5" />
          </div>
          <div>
            <div className="font-semibold text-sm leading-tight">دستیار سازمانی</div>
            <div className="text-xs text-muted-foreground">نسخه ۱.۰.۰</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {nav
            .filter((n) => !n.perm || hasPermission(n.perm))
            .map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )
                }
              >
                <n.icon className="h-4 w-4" />
                {n.label}
              </NavLink>
            ))}

          {isAdmin && (
            <>
              <div className="pt-4 pb-2 px-3 text-xs font-semibold text-muted-foreground">مدیریت</div>
              {adminNav.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.end}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )
                  }
                >
                  <n.icon className="h-4 w-4" />
                  {n.label}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        <div className="border-t p-3 space-y-1">
          <button
            onClick={toggle}
            className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            حالت {theme === "dark" ? "روشن" : "تاریک"}
          </button>
          <button
            onClick={() => navigate("/profile")}
            className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <UserIcon className="h-4 w-4" />
            پروفایل
          </button>
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
          >
            <LogOut className="h-4 w-4" />
            خروج
          </button>
          <div className="flex items-center gap-3 pt-2 mt-1 border-t px-1">
            <Avatar className="h-8 w-8">
              <AvatarImage src={user?.avatar_url || undefined} />
              <AvatarFallback>{initials(user?.name || "؟")}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{user?.name}</div>
              <div className="text-xs text-muted-foreground truncate">{user?.department?.name || user?.roles[0] || "کاربر"}</div>
            </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
