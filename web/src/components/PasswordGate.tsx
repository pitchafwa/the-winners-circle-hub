import { useState } from "react";
import type { ReactNode } from "react";

const PASSWORD = "password123";
const SESSION_KEY = "league-hub:v1:trade-admin-unlocked";

export default function PasswordGate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(SESSION_KEY) === "1");
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);

  if (unlocked) return <>{children}</>;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input === PASSWORD) {
      sessionStorage.setItem(SESSION_KEY, "1");
      setUnlocked(true);
    } else {
      setError(true);
    }
  };

  return (
    <section className="section" style={{ maxWidth: "24rem" }}>
      <div className="section-head">
        <h2>Locked</h2>
      </div>
      <form onSubmit={submit}>
        <label>
          <span className="label">Password</span>
          <input
            type="password"
            className="control"
            style={{ display: "block", width: "100%", marginTop: "0.4rem" }}
            value={input}
            autoFocus
            onChange={(e) => {
              setInput(e.target.value);
              setError(false);
            }}
          />
        </label>
        {error && (
          <p className="error-state" style={{ marginTop: "0.75rem" }}>
            Wrong password.
          </p>
        )}
        <button
          type="submit"
          className="control"
          style={{ marginTop: "1rem", cursor: "pointer", background: "var(--paper-2)" }}
        >
          Unlock
        </button>
      </form>
    </section>
  );
}
