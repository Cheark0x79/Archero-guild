import { ADMIN_ROLE, USER_ROLE } from "./auth.js";

export const publicNavItems = [
  ["dashboard", "Dashboard", "/dashboard"],
  ["members", "Members", "/members"],
  ["boss", "Boss", "/boss"],
  ["rankings", "Records", "/records"],
  ["activity", "Activity", "/activity"],
  ["api-docs", "API Docs", "/api-docs"],
];

const adminNavItems = [
  ["admin", "Admin", "/admin"],
  ["settings", "Rules", "/admin/rules"],
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
