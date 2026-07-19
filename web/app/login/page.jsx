export default function LoginPage() {
  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="brand login-brand">
          <div className="brand-mark" aria-hidden="true">
            A2
          </div>
          <div>
            <strong>Archero Guild</strong>
            <span>Observer access</span>
          </div>
        </div>
        <div>
          <h1>Login</h1>
          <p>Authentication is a placeholder for now. Use these entry points while account roles are wired.</p>
        </div>
        <div className="login-actions">
          <a className="primary-button" href="/dashboard">
            Continue as user
          </a>
          <a className="secondary-button" href="/admin">
            Continue as admin
          </a>
        </div>
      </section>
    </main>
  );
}
