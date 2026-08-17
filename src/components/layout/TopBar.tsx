"use client";

import React from "react";
import { useAuth } from "@/lib/auth-context";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  Bell,
  ChevronDown,
  LogOut,
  User,
  Settings,
  Moon,
  Cpu,
} from "lucide-react";
import Link from "next/link";

interface TopBarProps {
  title?: string;
  showModelStatus?: boolean;
  children?: React.ReactNode;
}

export function TopBar({ title, showModelStatus = true, children }: TopBarProps) {
  const { user, logout } = useAuth();
  const [showUserMenu, setShowUserMenu] = React.useState(false);

  return (
    <header className="h-16 bg-[#0B0F0E]/80 backdrop-blur-lg border-b border-white/10 flex items-center justify-between px-6 sticky top-0 z-30">
      <div className="flex items-center gap-4">
        {title && <h1 className="text-lg font-semibold text-white">{title}</h1>}
        {children}
        
        {showModelStatus && (
          <Badge variant="default" className="gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <Cpu size={12} />
            آماده
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Link href="/search">
          <Button variant="ghost" size="icon" className="text-gray-400">
            <Search size={20} />
          </Button>
        </Link>

        <Button variant="ghost" size="icon" className="text-gray-400 relative">
          <Bell size={20} />
        </Button>

        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-white/5 transition-colors"
          >
            <Avatar name={user?.name} size="sm" />
            <span className="text-sm text-gray-300 hidden sm:block">
              {user?.name}
            </span>
            <ChevronDown size={16} className="text-gray-500" />
          </button>

          {showUserMenu && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowUserMenu(false)}
              />
              <div className="absolute left-0 top-full mt-2 w-56 bg-[#17211D] border border-white/10 rounded-xl shadow-xl z-50 overflow-hidden">
                <div className="p-4 border-b border-white/10">
                  <p className="font-medium text-white">{user?.name}</p>
                  <p className="text-sm text-gray-400">{user?.email}</p>
                </div>
                <div className="p-2">
                  <Link
                    href="/profile"
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-gray-300 hover:bg-white/5 transition-colors"
                    onClick={() => setShowUserMenu(false)}
                  >
                    <User size={18} />
                    <span>پروفایل</span>
                  </Link>
                  <Link
                    href="/admin/settings"
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-gray-300 hover:bg-white/5 transition-colors"
                    onClick={() => setShowUserMenu(false)}
                  >
                    <Settings size={18} />
                    <span>تنظیمات</span>
                  </Link>
                  <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-gray-300 hover:bg-white/5 transition-colors">
                    <Moon size={18} />
                    <span>تم تاریک</span>
                  </button>
                </div>
                <div className="p-2 border-t border-white/10">
                  <button
                    onClick={logout}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <LogOut size={18} />
                    <span>خروج</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
