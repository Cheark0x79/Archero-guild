import { ADMIN_ROLE, USER_ROLE } from "./auth.js";

export const publicNavItems = [
  ["dashboard", "Dashboard", "/dashboard"],
  ["members", "Members", "/members"],
  ["boss", "Boss", "/boss"],
];

const adminNavItems = [
  ["admin", "Overview", "/admin"],
  ["admin-members", "Member management", "/admin/members"],
  ["daily-editor", "Daily data editor", "/admin/data-editor"],
  ["notifications", "Notifications", "/admin/notifications"],
  ["settings", "Rules", "/admin/rules"],
  ["api-docs", "API reference", "/api-docs"],
];

export function navigationItemsForRole(role, { testToolsEnabled = false } = {}) {
  if (role !== ADMIN_ROLE) return { primary: publicNavItems, admin: [], test: [] };
  const test = testToolsEnabled ? [["test", "Test tools", "/test"]] : [];
  return { primary: publicNavItems, admin: adminNavItems, test };
}

export function sessionRoleLabel(role) {
  if (role === ADMIN_ROLE) return "Administrator";
  if (role === USER_ROLE) return "Viewer";
  return null;
}
