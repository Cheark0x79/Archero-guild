import DashboardRoute from "../../components/DashboardRoute.jsx";

export default async function MemberPage({ params }) {
  const { memberKey } = await params;
  return <DashboardRoute initialRoute="member" memberKeyParam={memberKey} />;
}
