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
    testToolsEnabled: process.env.NEXT_PUBLIC_TEST_DATA_ADMIN === "1"
      && ["development", "test"].includes(process.env.NEXT_PUBLIC_DEPLOYMENT_ENV),
  });
  const roleLabel = sessionRoleLabel(sessionRole);

  return (
    <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`} aria-label="Primary navigation">
      <div className="sidebar-header">
        <Link className="brand" href="/dashboard" aria-label={`${guildName} dashboard`}>
          <div className="brand-mark" aria-hidden="true">A2</div>
          <div className="brand-copy">
            <strong>{guildName}</strong>
            <span>Archero Guild</span>
          </div>
        </Link>
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
          <span className="nav-section-label">Guild</span>
          {navigation.primary.map(([key, label, href]) => (
            <SidebarNavLink active={navRoute === key} href={href} icon={key} key={key} label={label} route={key} />
          ))}
        </nav>
        {navigation.admin.length > 0 ? (
          <nav className="nav-list admin-nav-list" aria-label="Admin pages">
            <span className="nav-section-label">Administration</span>
            {navigation.admin.map(([key, label, href]) => (
              <SidebarNavLink active={navRoute === key} href={href} icon={key} key={key} label={label} route={key} />
            ))}
          </nav>
        ) : null}
        {navigation.test.length > 0 ? (
          <nav className="nav-list test-nav-list" aria-label="Test pages">
            <span className="nav-section-label">Development</span>
            {navigation.test.map(([key, label, href]) => (
              <SidebarNavLink active={navRoute === key} href={href} icon={key} key={key} label={label} route={key} />
            ))}
          </nav>
        ) : null}
        <div className="sidebar-footer">
          <div className="sidebar-note">
            <SidebarIcon type="checkpoint" />
            <span><small>{checkpointLabel}</small><strong>{checkpointValue}</strong></span>
          </div>
          <div className="sidebar-account">
            {roleLabel ? (
              <div className="session-role" aria-label={`Signed in as ${roleLabel}`}>
                <span className="session-avatar" aria-hidden="true">{roleLabel.slice(0, 1)}</span>
                <span><small>Signed in as</small><strong>{roleLabel}</strong></span>
              </div>
            ) : null}
            <LogoutButton />
          </div>
          <span className="app-version">Archero Guild · {process.env.NEXT_PUBLIC_APP_VERSION ?? "development"}</span>
        </div>
      </div>
    </aside>
  );
}

function SidebarNavLink({ active, href, icon, label, route }) {
  return (
    <Link href={href} data-route={route} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
      <SidebarIcon type={icon} />
      <span>{label}</span>
    </Link>
  );
}

function SidebarIcon({ type }) {
  const paths = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    members: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9" /></>,
    boss: <><path d="m6 3 12 12M18 3 6 15M8 13l3 3-4 4-3-3 4-4ZM16 13l-3 3 4 4 3-3-4-4Z" /></>,
    admin: <><path d="M12 3 4 7v5c0 5 3.4 8 8 9 4.6-1 8-4 8-9V7l-8-4Z" /><path d="m9 12 2 2 4-4" /></>,
    "admin-members": <><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M18 8v6M15 11h6" /></>,
    notifications: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    settings: <><path d="M4 6h16M4 12h16M4 18h16M8 4v4M16 10v4M10 16v4" /></>,
    "api-docs": <><path d="M4 4h16v16H4zM8 8h8M8 12h8M8 16h5" /></>,
    test: <><path d="M9 3h6M10 3v5l-5 9a3 3 0 0 0 2.6 4h8.8a3 3 0 0 0 2.6-4l-5-9V3M7.5 15h9" /></>,
    checkpoint: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /></>,
  };
  return <svg className="sidebar-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[type]}</svg>;
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
      <SidebarIcon type="logout" />
      <span>{loggingOut ? "Signing out…" : "Sign out"}</span>
    </button>
  );
}
