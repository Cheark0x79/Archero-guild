import { ADMIN_ROLE, USER_ROLE } from "./auth.js";

export const publicNavItems = [
  ["dashboard", "Dashboard", "/dashboard"],
  ["members", "Members", "/members"],
  ["boss", "Boss", "/boss"],
];

const adminNavGroups = [
  { id: "manage-members", label: "Manage members · Admin", items: [
    ["admin", "Overview", "/admin"],
    ["admin-members", "Member management", "/admin/members"],
    ["member-history", "Member history", "/admin/member-history"],
  ] },
  { id: "configure-guild", label: "Configure guild · Admin", items: [
    ["notifications", "Notifications", "/admin/notifications"],
    ["settings", "Rules", "/admin/rules"],
  ] },
  { id: "reference", label: "Reference · Admin", items: [
    ["api-docs", "API reference", "/api-docs"],
  ] },
];
const adminNavItems = adminNavGroups.flatMap(({ items }) => items);

export function navigationGroupsForRole(role, options = {}) {
  const { primary, test } = navigationItemsForRole(role, options);
  return [
    { id: "guild", label: "Guild", items: primary },
    ...(role === ADMIN_ROLE ? adminNavGroups : []),
    ...(test.length ? [{ id: "development", label: "Development · Admin", items: test }] : []),
  ];
}

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
