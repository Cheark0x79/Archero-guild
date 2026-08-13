import DashboardRoute from "../../../components/DashboardRoute.jsx";

export default async function AdminMemberEditPage({ params }) {
  const { memberKey } = await params;
  return <DashboardRoute initialRoute="admin-member" memberKeyParam={memberKey} />;
}
