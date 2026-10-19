import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../../firebase";
import { useTheme } from "../../context/ThemeContext";
import { readIdentifier, emailForLogin } from "../../auth/resolveLogin";
import { Eyebrow, Field, Note, PrimaryButton, inputStyle } from "../../components/ui";

interface Props {
  onSwitch: () => void;
  onForgot: () => void;
  notice?: string;
}

/**
 * Whether this build is talking to the emulators.
 *
 * A module-level constant, not a check inside the component, and that is the
 * whole safety argument. Vite replaces `import.meta.env.VITE_USE_EMULATORS`
 * with a literal at build time, so in a production build this folds to
 * `"false" === "true"` — false — and everything guarded by it, the seeded
 * passwords included, is dead code the bundler drops. The buttons below are
 * not hidden in production; they are not in the file that ships.
 *
 * The flag lives only in `.env.test`, whose project id is `demo-ocealgo`.
 */
const SANDBOX = import.meta.env.VITE_USE_EMULATORS === "true";

/**
 * The accounts worth one tap in a sandbox.
 *
 * Signing in by hand is six screens of typing when the point of the sandbox is
 * the seventh. A manager and an officer are the two sides of nearly everything
 * — one assigns, approves and dispatches, the other walks the round. The admins
 * are here because what each role may see now differs enough to check as each;
 * the other seeded accounts are still a typed sign-in, so this stays a shortcut
 * rather than a menu.
 *
 * These are the addresses `tests/e2e/fixtures/seed.ts` creates. They exist in
 * no other world.
 */
const SANDBOX_LOGINS: { label: string; email: string; sub: string }[] = [
  { label: "Manager", email: "manager@ocealgo.test", sub: "Manoj Manager" },
  { label: "Sales officer", email: "rep@ocealgo.test", sub: "Ravi Rep" },
  // Admins too, now the reports and permissions differ by role enough to need
  // checking as each. The super admin exists only in the `npm run sandbox`
  // world (scripts/sandbox.mjs), not in the e2e seed, so it is offered only there.
  { label: "Admin", email: "admin@ocealgo.test", sub: "Asha Admin" },
  ...(import.meta.env.VITE_SANDBOX === "true"
    ? [{ label: "Super admin", email: "super@ocealgo.test", sub: "Sara Superadmin" }]
    : []),
];
const SANDBOX_PASSWORD = "Passw0rd!";

export default function LoginPage({ onSwitch, onForgot, notice }: Props) {
  const { t } = useTheme();
  const [form, setForm] = useState({ identifier: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPass, setShowPass] = useState(false);

  // A wrong password, an unregistered number and an unknown email all end up
  // here. Telling them apart would let anyone with the login screen work out
  // which numbers and addresses belong to staff, so they read identically.
  const NO_MATCH = "Those details do not match an account.";

  /**
   * `as` is how the sandbox buttons sign in, and it is deliberately the same
   * path as the form rather than a shortcut around it. A quick login that
   * bypassed `emailForLogin` or the error handling would stop exercising the
   * thing it is there to let you look at.
   */
  const handleLogin = async (as?: { identifier: string; password: string }) => {
    setError("");
    const identifier = as?.identifier ?? form.identifier;
    const password = as?.password ?? form.password;
    if (!identifier.trim() || !password)
      return setError("Enter your email or mobile number, and your password.");

    setLoading(true);
    try {
      const id = readIdentifier(identifier);
      if (id.kind === "unusable") return setError(NO_MATCH);

      // A number has to be swapped for the account's email first; an email is
      // already what Firebase wants. Either way the password does the work.
      const email = await emailForLogin(id);
      if (!email) return setError(NO_MATCH);

      await signInWithEmailAndPassword(auth, email, password);
      // Nothing else to do here. A pending, rejected or deactivated account is
      // held by the status screen in App.tsx, which explains the situation and
      // offers a way out.
      //
      // This used to re-read the user document and sign the account straight
      // back out with an inline message. It raced: AuthContext's listener often
      // resolved first, App swapped in the status screen, and the signOut then
      // remounted a blank LoginPage — losing the very message that explained
      // what had happened. Two places owning one decision, and the quieter one
      // winning at random.
    } catch (e: any) {
      if (
        e.code === "auth/invalid-credential" ||
        e.code === "auth/wrong-password" ||
        e.code === "auth/user-not-found" ||
        e.code === "auth/invalid-email"
      )
        setError(NO_MATCH);
      else setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "var(--oc-screen)",
        background: t.bg,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "40px 24px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 340, margin: "0 auto" }}>
        <div style={{ marginBottom: 6 }}>
          <Eyebrow>Welcome back</Eyebrow>
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 500, color: t.text, margin: 0, letterSpacing: "-0.01em" }}>
          Ocealgo
        </h1>
        <div style={{ fontSize: 14, fontWeight: 400, color: t.text3, marginTop: 5, marginBottom: 36 }}>
          Team dashboard
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <Field label="Email or mobile number">
            <input
              type="text"
              autoComplete="username"
              value={form.identifier}
              onChange={(e) => setForm({ ...form, identifier: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              placeholder="you@example.com or 9876543210"
              style={inputStyle(t)}
            />
          </Field>

          <Field label="Password">
            <div style={{ position: "relative" }}>
              <input
                type={showPass ? "text" : "password"}
                autoComplete="current-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                placeholder="Your password"
                style={{ ...inputStyle(t), paddingRight: 62 }}
              />
              <button
                className="oc-action"
                onClick={() => setShowPass(!showPass)}
                style={{
                  position: "absolute",
                  right: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  color: t.text3,
                  fontSize: 13,
                  fontWeight: 400,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                {showPass ? "Hide" : "Show"}
              </button>
            </div>
          </Field>

          {notice && !error && <Note>{notice}</Note>}
          {error && <Note tone="warn">{error}</Note>}

          <div>
            <PrimaryButton onClick={() => handleLogin()} disabled={loading} style={{ width: "100%", padding: "13px 16px" }}>
              {loading ? "Signing in" : "Sign in"}
            </PrimaryButton>
          </div>

          {/* Sandbox only — see SANDBOX above. Says so on itself, because a
              shortcut that signs you in as somebody else should never be
              something you wonder about having pressed. */}
          {SANDBOX && (
            <div style={{ borderTop: `0.5px solid ${t.border}`, paddingTop: 18 }}>
              <div style={{ marginBottom: 10 }}>
                <Eyebrow>Sandbox · emulator only</Eyebrow>
              </div>
              {/* Two to a row, so four still fit a phone without shrinking the text. */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                {SANDBOX_LOGINS.map((who) => (
                  <button
                    key={who.email}
                    className="oc-action"
                    disabled={loading}
                    onClick={() => {
                      // The fields are filled as well as submitted, so it is
                      // visible afterwards which account is being used.
                      setForm({ identifier: who.email, password: SANDBOX_PASSWORD });
                      void handleLogin({ identifier: who.email, password: SANDBOX_PASSWORD });
                    }}
                    style={{
                      flex: 1, minWidth: 0, textAlign: "left", cursor: "pointer",
                      background: "none", border: `0.5px solid ${t.border2}`,
                      borderRadius: 6, padding: "10px 12px", minHeight: 44,
                      opacity: loading ? 0.5 : 1,
                    }}
                  >
                    <span style={{ display: "block", fontSize: 14, fontWeight: 500, color: t.text }}>
                      {who.label}
                    </span>
                    <span style={{ display: "block", fontSize: 12, fontWeight: 400, color: t.text3, marginTop: 2 }}>
                      {who.sub}
                    </span>
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 12, color: t.text3, marginTop: 9, lineHeight: 1.5 }}>
                Seeded accounts in the demo project. These buttons are not in a production build.
              </div>
            </div>
          )}

          <button
            className="oc-action"
            onClick={onForgot}
            style={{
              background: "none", border: "none", padding: 0, textAlign: "left",
              fontSize: 13, fontWeight: 400, color: t.text3, cursor: "pointer",
              textDecoration: "underline", textUnderlineOffset: 3,
            }}
          >
            Forgotten your password?
          </button>

          <div style={{ fontSize: 13, fontWeight: 400, color: t.text3 }}>
            No account yet?{" "}
            <button
              className="oc-action"
              onClick={onSwitch}
              style={{
                background: "none", border: "none", padding: 0,
                fontSize: 13, fontWeight: 400, color: t.text, cursor: "pointer",
                textDecoration: "underline", textUnderlineOffset: 3,
              }}
            >
              Request access
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
