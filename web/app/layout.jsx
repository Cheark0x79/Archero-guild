import "./globals.css";

export const metadata = {
  title: "Archero Observer",
  description: "Guild management dashboard for Archero 2 observer data.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <template
          data-impeccable-contract="guild-dashboard-9ae92c11"
          dangerouslySetInnerHTML={{
            __html: `<!--
THESIS: Make collective guild progress the first answer; refuse a boss-first generic card grid.
OWN-WORLD: Navy command rail, cool light data field, cyan figures, guild-gold identity, thin rules, exact game assets.
STORY: Members recognize Shinigami, read its current standing, then scan trends or open focused Members and Boss pages.
FIRST VIEWPORT: Guild name and capture date lead; one continuous guild-stat band sits above a wide guild-power trajectory and compact status routes.
FORM: Guild operations command center, grounded direction 3; seed key 9ae92c11.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
-->`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
