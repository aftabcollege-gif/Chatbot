"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { useAuth } from "@/lib/auth-context";
import {
  MessageSquarePlus,
  MessageSquare,
  FolderOpen,
  Brain,
  Search,
  Settings,
  Users,
  Shield,
  Activity,
  FileText,
  PanelRightClose,
  PanelRightOpen,
  LogOut,
  ChevronDown,
  MoreHorizontal,
} from "lucide-react";

interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
  isPinned: boolean;
}

interface SidebarProps {
  conversations: Conversation[];
  currentConversationId?: string;
  onNewChat: () => void;
  collapsed: boolean;
  onToggle: () => void;
}

const navItems = [
  { href: "/chat", icon: MessageSquare, label: "گفتگو" },
  { href: "/resources", icon: FolderOpen, label: "منابع" },
  { href: "/knowledge", icon: Brain, label: "دانش سازمانی" },
  { href: "/search", icon: Search, label: "جستجو" },
];

const adminItems = [
  { href: "/admin", icon: Activity, label: "داشبورد" },
  { href: "/admin/users", icon: Users, label: "کاربران" },
  { href: "/admin/roles", icon: Shield, label: "نقش‌ها" },
  { href: "/admin/logs", icon: FileText, label: "لاگ‌ها" },
  { href: "/admin/settings", icon: Settings, label: "تنظیمات" },
];

export function Sidebar({
  conversations,
  currentConversationId,
  onNewChat,
  collapsed,
  onToggle,
}: SidebarProps) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [showAdmin, setShowAdmin] = useState(false);

  const isAdmin = !!user?.isAdmin;

  const pinnedConversations = conversations.filter((c) => c.isPinned);
  const recentConversations = conversations.filter((c) => !c.isPinned);

  return (
    <aside
      className={cn(
        "fixed top-0 right-0 h-screen bg-[#111715] border-l border-white/10 flex flex-col transition-all duration-300 z-40",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Header */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-white/10">
        {!collapsed && (
          <Link href="/chat" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
              <Brain size={18} className="text-white" />
            </div>
            <span className="font-semibold text-white">دانش‌یار</span>
          </Link>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggle}
          className="text-gray-400"
        >
          {collapsed ? <PanelRightOpen size={20} /> : <PanelRightClose size={20} />}
        </Button>
      </div>

      {/* New Chat Button */}
      <div className="p-3">
        <Button
          onClick={onNewChat}
          className={cn(
            "w-full gap-2",
            collapsed && "px-0"
          )}
        >
          <MessageSquarePlus size={20} />
          {!collapsed && "گفتگوی جدید"}
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 scrollbar-thin">
        {/* Main Nav */}
        <div className="space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all",
                  collapsed && "justify-center",
                  isActive
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "text-gray-400 hover:bg-white/5 hover:text-white"
                )}
              >
                <item.icon size={20} />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </div>

        {/* Conversations */}
        {!collapsed && conversations.length > 0 && (
          <div className="mt-6 pt-4 border-t border-white/10">
            {pinnedConversations.length > 0 && (
              <div className="mb-4">
                <p className="text-xs text-gray-500 mb-2 px-3">📌 سنجاق‌شده</p>
                {pinnedConversations.map((conv) => (
                  <ConversationItem
                    key={conv.id}
                    conversation={conv}
                    isActive={conv.id === currentConversationId}
                  />
                ))}
              </div>
            )}
            {recentConversations.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 mb-2 px-3">اخیر</p>
                {recentConversations.slice(0, 10).map((conv) => (
                  <ConversationItem
                    key={conv.id}
                    conversation={conv}
                    isActive={conv.id === currentConversationId}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Admin Section */}
        {isAdmin && (
          <div className="mt-6 pt-4 border-t border-white/10">
            <button
              onClick={() => setShowAdmin(!showAdmin)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-gray-400 hover:bg-white/5 hover:text-white transition-all",
                collapsed && "justify-center"
              )}
            >
              <Settings size={20} />
              {!collapsed && (
                <>
                  <span className="flex-1 text-right">مدیریت</span>
                  <ChevronDown
                    size={16}
                    className={cn(
                      "transition-transform",
                      showAdmin && "rotate-180"
                    )}
                  />
                </>
              )}
            </button>

            {!collapsed && showAdmin && (
              <div className="mt-1 space-y-1">
                {adminItems.map((item) => {
                  const isActive = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 pr-8 rounded-lg transition-all text-sm",
                        isActive
                          ? "bg-emerald-500/10 text-emerald-400"
                          : "text-gray-500 hover:bg-white/5 hover:text-gray-300"
                      )}
                    >
                      <item.icon size={16} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </nav>

      {/* User Section */}
      <div className="p-3 border-t border-white/10">
        <div
          className={cn(
            "flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition-colors cursor-pointer",
            collapsed && "justify-center"
          )}
        >
          <Avatar name={user?.name} size="sm" />
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {user?.name}
              </p>
              <p className="text-xs text-gray-500 truncate">{user?.email}</p>
            </div>
          )}
          {!collapsed && (
            <Button
              variant="ghost"
              size="icon"
              onClick={logout}
              className="shrink-0 text-gray-400 hover:text-red-400"
            >
              <LogOut size={18} />
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}

function ConversationItem({
  conversation,
  isActive,
}: {
  conversation: Conversation;
  isActive: boolean;
}) {
  return (
    <Link
      href={`/chat/${conversation.id}`}
      className={cn(
        "group flex items-center gap-2 px-3 py-2 rounded-lg transition-all text-sm",
        isActive
          ? "bg-emerald-500/10 text-emerald-300"
          : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
      )}
    >
      <MessageSquare size={16} className="shrink-0" />
      <span className="flex-1 truncate">{conversation.title || "گفتگوی جدید"}</span>
      <button
        onClick={(e) => {
          e.preventDefault();
        }}
        className="opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <MoreHorizontal size={14} />
      </button>
    </Link>
  );
}
