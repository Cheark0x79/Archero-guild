import "./globals.css";

export const metadata = {
  title: "Archero Observer",
  description: "Guild management dashboard for Archero 2 observer data.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
