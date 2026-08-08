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

export function navigationItemsForRole(role, { localOcrEnabled = false } = {}) {
  if (role !== ADMIN_ROLE) return { primary: publicNavItems, admin: [] };
  const admin = [...adminNavItems];
  if (localOcrEnabled) admin.splice(1, 0, ["data", "Data", "/admin/data"]);
  return { primary: publicNavItems, admin };
}

export function sessionRoleLabel(role) {
  if (role === ADMIN_ROLE) return "Administrator";
  if (role === USER_ROLE) return "Viewer";
  return null;
}
