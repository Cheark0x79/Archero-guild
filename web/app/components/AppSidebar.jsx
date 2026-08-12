"use client";

import Link from "next/link";
import { useState } from "react";

import { navigationItemsForRole, sessionRoleLabel } from "../../lib/navigation.js";

export default function AppSidebar({
  activeRoute,
  sessionRole,
  guildName = "Archero Guild",
  checkpointLabel = "Checkpoint",
  checkpointValue = "API v1",
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navRoute = activeRoute === "member" ? "members" : activeRoute;
  const navigation = navigationItemsForRole(sessionRole, {
    localOcrEnabled: process.env.NEXT_PUBLIC_LOCAL_OCR_ENABLED === "1",
    testToolsEnabled: process.env.NEXT_PUBLIC_TEST_DATA_ADMIN === "1"
      && ["development", "test"].includes(process.env.NEXT_PUBLIC_DEPLOYMENT_ENV),
  });
  const roleLabel = sessionRoleLabel(sessionRole);

  return (
    <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`} aria-label="Primary navigation">
      <div className="sidebar-header">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">A2</div>
          <div>
            <strong>{guildName}</strong>
            <span>Guild command center</span>
          </div>
        </div>
        <button
          className="sidebar-menu-button"
          type="button"
          aria-expanded={mobileOpen}
          aria-controls="sidebar-navigation"
          onClick={() => setMobileOpen((open) => !open)}
        >
          {mobileOpen ? "Close" : "Menu"}
        </button>
      </div>
      <div className="sidebar-navigation" id="sidebar-navigation">
        <nav className="nav-list" aria-label="Pages">
          {navigation.primary.map(([key, label, href]) => (
            <Link key={key} href={href} data-route={key} className={navRoute === key ? "active" : ""}>
              {label}
            </Link>
          ))}
        </nav>
        {navigation.admin.length > 0 ? (
          <nav className="nav-list admin-nav-list" aria-label="Admin pages">
            <span>Admin</span>
            {navigation.admin.map(([key, label, href]) => (
              <Link key={key} href={href} data-route={key} className={navRoute === key ? "active" : ""}>
                {label}
              </Link>
            ))}
          </nav>
        ) : null}
        {navigation.test.length > 0 ? (
          <nav className="nav-list test-nav-list" aria-label="Test pages">
            <span>Test</span>
            {navigation.test.map(([key, label, href]) => (
              <Link key={key} href={href} data-route={key} className={navRoute === key ? "active" : ""}>
                {label}
              </Link>
            ))}
          </nav>
        ) : null}
        {roleLabel ? (
          <div className="session-role" aria-label={`Signed in as ${roleLabel}`}>
            <span>Signed in as</span>
            <strong>{roleLabel}</strong>
          </div>
        ) : null}
        <LogoutButton />
        <div className="sidebar-note">
          <span>{checkpointLabel}</span>
          <strong>{checkpointValue}</strong>
          <span className="app-version">Version {process.env.NEXT_PUBLIC_APP_VERSION ?? "development"}</span>
        </div>
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
