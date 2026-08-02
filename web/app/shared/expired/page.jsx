import Link from "next/link";

import styles from "../shared.module.css";

export const metadata = { title: "Shared link unavailable · Archero Guild", robots: { index: false, follow: false } };

export default function SharedLinkExpiredPage() {
  return (
    <main className={styles.statePage}>
      <section className={styles.statePanel}>
        <div className={styles.brandMark}>A2</div>
        <h1>This shared link is unavailable</h1>
        <p>It may have expired or the address may be incomplete. Ask the bot to generate a new member link.</p>
        <Link href="/login">Return to sign in</Link>
      </section>
    </main>
  );
}
