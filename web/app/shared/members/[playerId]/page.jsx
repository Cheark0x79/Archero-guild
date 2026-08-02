import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { loadDashboardData } from "../../../api/dashboard-data/source.js";
import { apiLastImportDate } from "../../../api/v1/_lib/metadata.js";
import { shareCookieName, verifyMemberShareToken } from "../../../../lib/share-links.js";
import { sharedMemberProfileFromData } from "../../../../lib/shared-member.js";
import SharedMemberProfile from "../../SharedMemberProfile.jsx";

export const dynamic = "force-dynamic";
export const metadata = { title: "Shared member profile · Archero Guild", robots: { index: false, follow: false } };

export default async function SharedMemberPage({ params, searchParams }) {
  const { playerId: rawPlayerId } = await params;
  const playerId = decodeURIComponent(rawPlayerId);
  const query = await searchParams;
  const cookieStore = await cookies();
  const token = typeof query?.token === "string"
    ? query.token
    : cookieStore.get(shareCookieName(playerId))?.value;
  const grant = verifyMemberShareToken(token);
  if (!grant || grant.playerId !== playerId) redirect("/shared/expired");

  const payload = await loadDashboardData();
  const profile = sharedMemberProfileFromData(payload.data, playerId);
  if (!profile) redirect("/shared/expired");

  return (
    <SharedMemberProfile
      profile={profile}
      expiresAt={grant.expiresAt.toISOString()}
      lastImportDate={apiLastImportDate(payload)}
    />
  );
}
