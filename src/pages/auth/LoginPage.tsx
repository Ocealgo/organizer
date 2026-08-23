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

  const handleLogin = async () => {
    setError("");
    if (!form.identifier.trim() || !form.password)
      return setError("Enter your email or mobile number, and your password.");

    setLoading(true);
    try {
      const id = readIdentifier(form.identifier);
      if (id.kind === "unusable") return setError(NO_MATCH);

      // A number has to be swapped for the account's email first; an email is
      // already what Firebase wants. Either way the password does the work.
      const email = await emailForLogin(id);
      if (!email) return setError(NO_MATCH);

      await signInWithEmailAndPassword(auth, email, form.password);
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
            <PrimaryButton onClick={handleLogin} disabled={loading} style={{ width: "100%", padding: "13px 16px" }}>
              {loading ? "Signing in" : "Sign in"}
            </PrimaryButton>
          </div>

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
