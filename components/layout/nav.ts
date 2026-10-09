import {
  BarChart3,
  BookOpen,
  ClipboardList,
  LayoutDashboard,
  Library,
  Receipt,
  Search,
  Settings,
  TriangleAlert,
  UserRound,
  Users,
  ArrowLeftRight,
  type LucideIcon,
} from "lucide-react";

export type NavVariant = "admin" | "student";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Sidebar navigation (design §3 / prd §6).
 * Admin = dense 9-item rail; student = simpler 6-item nav with its own feel.
 *
 * NOTE: this module is only imported from client components (sidebar/shell)
 * so the lucide icon components stay inside the client bundle.
 */
export const NAV_ITEMS: Record<NavVariant, NavItem[]> = {
  admin: [
    { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/admin/requests", label: "Requests", icon: ClipboardList },
    { href: "/admin/loans", label: "Borrowed", icon: ArrowLeftRight },
    { href: "/admin/books", label: "Books", icon: Library },
    { href: "/admin/students", label: "Students", icon: Users },
    { href: "/admin/penalties", label: "Penalties", icon: Receipt },
    { href: "/admin/damages", label: "Damages", icon: TriangleAlert },
    { href: "/admin/reports", label: "Reports", icon: BarChart3 },
    { href: "/admin/settings", label: "Settings", icon: Settings },
  ],
  student: [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/dashboard/catalog", label: "Browse Books", icon: Search },
    { href: "/dashboard/requests", label: "My Requests", icon: ClipboardList },
    { href: "/dashboard/loans", label: "My Borrowed Books", icon: BookOpen },
    { href: "/dashboard/penalties", label: "My Penalties", icon: Receipt },
    { href: "/dashboard/profile", label: "Profile", icon: UserRound },
  ],
};
