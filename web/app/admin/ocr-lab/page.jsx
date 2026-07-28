import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { AUTH_COOKIE_NAME, roleForSessionToken } from "../../../lib/auth.js";
import AppSidebar from "../../components/AppSidebar.jsx";
import OcrLab from "../../components/OcrLab.jsx";

export default async function OcrLabPage() {
  if (process.env.ARCHERO_OCR_LAB_ENABLED !== "1") notFound();
  const cookieStore = await cookies();
  const sessionRole = roleForSessionToken(cookieStore.get(AUTH_COOKIE_NAME)?.value);
  return (
    <div className="app-shell">
      <AppSidebar activeRoute="ocr-lab" sessionRole={sessionRole} checkpointValue="Image → JSON" />
      <main className="main">
        <header className="topbar">
          <div>
            <h1>OCR Lab</h1>
            <p>Test one screenshot without importing or changing the database.</p>
          </div>
          <div className="topbar-meta">
            <span>Pipeline</span>
            <strong>Normalize → detect → OCR → validate</strong>
          </div>
        </header>
        <OcrLab />
      </main>
    </div>
  );
}
