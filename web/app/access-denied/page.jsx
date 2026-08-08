import Link from "next/link";
import { cookies } from "next/headers";

import AppSidebar from "../components/AppSidebar.jsx";
import { AUTH_COOKIE_NAME, roleForSessionToken } from "../../lib/auth.js";

export const metadata = {
  title: "Access denied · Archero Guild",
};

export default async function AccessDeniedPage() {
  const cookieStore = await cookies();
  const sessionRole = roleForSessionToken(cookieStore.get(AUTH_COOKIE_NAME)?.value);

  return (
    <div className="app-shell">
      <AppSidebar activeRoute="access-denied" sessionRole={sessionRole} checkpointValue="Protected area" />
      <main className="main">
        <header className="topbar">
          <div>
            <h1>Access denied</h1>
            <p>This area is reserved for guild administrators.</p>
          </div>
        </header>
        <section className="panel access-denied-panel" role="alert">
          <div>
            <span className="eyebrow">Viewer account</span>
            <h2>Administrator access required</h2>
            <p>Your session is valid, but it does not grant access to this page or its administrative actions.</p>
          </div>
          <div className="access-denied-actions">
            <Link className="primary-button" href="/dashboard">Return to Dashboard</Link>
            <Link className="secondary-button" href="/members">View members</Link>
          </div>
        </section>
      </main>
    </div>
  );
}
