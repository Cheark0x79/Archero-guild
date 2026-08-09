import { ADMIN_ROLE, USER_ROLE } from "./auth.js";

export const publicNavItems = [
  ["dashboard", "Dashboard", "/dashboard"],
  ["members", "Members", "/members"],
  ["boss", "Boss", "/boss"],
];

const adminNavItems = [
  ["admin", "Overview", "/admin"],
  ["activity", "Member activity", "/admin/activity"],
  ["settings", "Rules", "/admin/rules"],
  ["api-docs", "API reference", "/api-docs"],
];

export function navigationItemsForRole(role, { localOcrEnabled = false, testToolsEnabled = false } = {}) {
  if (role !== ADMIN_ROLE) return { primary: publicNavItems, admin: [], test: [] };
  const admin = [...adminNavItems];
  if (localOcrEnabled) admin.splice(2, 0, ["data", "Data imports", "/admin/data"]);
  const test = testToolsEnabled ? [["test", "Test tools", "/test"]] : [];
  return { primary: publicNavItems, admin, test };
}

export function sessionRoleLabel(role) {
  if (role === ADMIN_ROLE) return "Administrator";
  if (role === USER_ROLE) return "Viewer";
  return null;
}
