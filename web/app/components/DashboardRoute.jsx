import { cookies } from "next/headers";

import { AUTH_COOKIE_NAME, roleForSessionToken } from "../../lib/auth.js";
import DashboardApp from "./DashboardApp.jsx";

export default async function DashboardRoute({ initialRoute, memberKeyParam = null }) {
  const cookieStore = await cookies();
  const initialSessionRole = roleForSessionToken(cookieStore.get(AUTH_COOKIE_NAME)?.value);
  return (
    <DashboardApp
      initialRoute={initialRoute}
      memberKeyParam={memberKeyParam}
      initialSessionRole={initialSessionRole}
    />
  );
}
