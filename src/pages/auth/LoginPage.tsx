import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../../firebase";
import { useTheme } from "../../context/ThemeContext";
import { Eyebrow, Field, Note, PrimaryButton, inputStyle } from "../../components/ui";

interface Props {
  onSwitch: () => void;
}

export default function LoginPage({ onSwitch }: Props) {
  const { t } = useTheme();
  const [form, setForm] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPass, setShowPass] = useState(false);

  const handleLogin = async () => {
    setError("");
    if (!form.email || !form.password)
      return setError("Enter your email and password.");
    setLoading(true);
    try {
      const { user } = await signInWithEmailAndPassword(
        auth,
        form.email,
        form.password,
      );
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) {
        const data = snap.data();
        if (data.status === "pending") {
          await auth.signOut();
          setError("Your account is still waiting for an admin to approve it.");
        } else if (data.status === "rejected") {
          await auth.signOut();
          setError("Your request for access was turned down. Speak to an admin.");
        }
      }
    } catch (e: any) {
      if (
        e.code === "auth/invalid-credential" ||
        e.code === "auth/wrong-password"
      )
        setError("That email and password do not match.");
      else if (e.code === "auth/user-not-found")
        setError("No account uses that email address.");
      else setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
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
          <Field label="Email">
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="you@example.com"
              style={inputStyle(t)}
            />
          </Field>

          <Field label="Password">
            <div style={{ position: "relative" }}>
              <input
                type={showPass ? "text" : "password"}
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

          {error && <Note tone="warn">{error}</Note>}

          <div>
            <PrimaryButton onClick={handleLogin} disabled={loading} style={{ width: "100%", padding: "13px 16px" }}>
              {loading ? "Signing in" : "Sign in"}
            </PrimaryButton>
          </div>

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
