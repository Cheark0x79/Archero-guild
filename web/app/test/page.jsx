import { notFound } from "next/navigation";

import DashboardRoute from "../components/DashboardRoute.jsx";

export const dynamic = "force-dynamic";

export default function TestPage() {
  const enabled = process.env.ARCHERO_ENABLE_TEST_DATA_ADMIN === "1"
    && ["development", "test"].includes(process.env.ARCHERO_DEPLOYMENT_ENV);
  if (!enabled) notFound();
  return <DashboardRoute initialRoute="test" />;
}
