import ApiDocsClient from "./ApiDocsClient.jsx";

export const metadata = {
  title: "API Docs · Archero Guild",
  description: "Interactive Archero Guild API documentation for integrations and Discord bots.",
};

export default function ApiDocsPage() {
  return <ApiDocsClient publicOrigin={process.env.ARCHERO_PUBLIC_ORIGIN ?? ""} />;
}
