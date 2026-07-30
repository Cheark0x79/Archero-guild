"use client";

import Link from "next/link";
import { useState } from "react";

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
  ...(process.env.NEXT_PUBLIC_LOCAL_OCR_ENABLED === "1"
    ? [["data", "Data", "/admin/data"]]
    : []),
  ["settings", "Rules", "/admin/rules"],
];

export default function AppSidebar({
  activeRoute,
  sessionRole,
  checkpointLabel = "Checkpoint",
  checkpointValue = "API v1",
}) {
  const navRoute = activeRoute === "member" ? "members" : activeRoute;

  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">A2</div>
        <div>
          <strong>Archero Guild</strong>
          <span>Guild tracking</span>
        </div>
      </div>
      <nav className="nav-list" aria-label="Pages">
        {publicNavItems.map(([key, label, href]) => (
          <Link key={key} href={href} data-route={key} className={navRoute === key ? "active" : ""}>
            {label}
          </Link>
        ))}
      </nav>
      {sessionRole === "admin" ? (
        <nav className="nav-list admin-nav-list" aria-label="Admin pages">
          <span>Admin</span>
          {adminNavItems.map(([key, label, href]) => (
            <Link key={key} href={href} data-route={key} className={navRoute === key ? "active" : ""}>
              {label}
            </Link>
          ))}
        </nav>
      ) : null}
      <LogoutButton />
      <div className="sidebar-note">
        <span>{checkpointLabel}</span>
        <strong>{checkpointValue}</strong>
        <span className="app-version">Version {process.env.NEXT_PUBLIC_APP_VERSION ?? "development"}</span>
      </div>
    </aside>
  );
}

function LogoutButton() {
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign("/login");
    }
  }

  return (
    <button className="login-link logout-button" type="button" disabled={loggingOut} onClick={logout}>
      {loggingOut ? "Signing out…" : "Sign out"}
    </button>
  );
}
