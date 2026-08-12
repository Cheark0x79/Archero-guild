import "./globals.css";

export const metadata = {
  title: "Archero Guild",
  description: "Guild management dashboard for Archero 2 data.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
