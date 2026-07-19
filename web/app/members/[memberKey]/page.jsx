import DashboardApp from "../../components/DashboardApp.jsx";

export default async function MemberPage({ params }) {
  const { memberKey } = await params;
  return <DashboardApp initialRoute="member" memberKeyParam={memberKey} />;
}
