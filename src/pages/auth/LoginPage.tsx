import { useState } from "react";
import { signInWithEmailAndPassword, signOut, type ConfirmationResult } from "firebase/auth";
import { auth } from "../../firebase";
import { useTheme } from "../../context/ThemeContext";
import { sendSignInCode, confirmAsExistingUser, phoneAuthMessage } from "../../auth/phoneAuth";
import { isIndianMobile, asTyped, pretty } from "../../lib/phone";
import { Eyebrow, Field, Note, GhostButton, PrimaryButton, inputStyle } from "../../components/ui";

interface Props {
  onSwitch: () => void;
  onForgot: () => void;
  notice?: string;
}

export default function LoginPage({ onSwitch, onForgot, notice }: Props) {
  const { t } = useTheme();
  const [form, setForm] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPass, setShowPass] = useState(false);

  // The phone route signs in with a code instead of a password. It is the same
  // account either way — the number is linked to it at signup — so whichever
  // door a rep comes through, they land on the same uid with the same role.
  const [mode, setMode] = useState<"email" | "phone">("email");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<ConfirmationResult | null>(null);

  const sendCode = async () => {
    setError("");
    if (!isIndianMobile(phone))
      return setError("Enter your 10-digit mobile number.");
    setLoading(true);
    try {
      setPending(await sendSignInCode(phone));
    } catch (e) {
      setError(phoneAuthMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    setError("");
    if (code.trim().length < 6)
      return setError("Enter the six-digit code from the message.");
    if (!pending) return setError("That code has expired. Ask for a new one.");
    setLoading(true);
    try {
      await confirmAsExistingUser(pending, code.trim());
      // Signed in. AuthContext picks it up and App swaps the screen out.
    } catch (e: any) {
      if (e?.code === "oc/unknown-number") {
        await signOut(auth).catch(() => {});
        setPending(null);
        setCode("");
        setError("No account uses that number. Sign in with your email, or ask an admin.");
      } else setError(phoneAuthMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    setError("");
    if (!form.email || !form.password)
      return setError("Enter your email and password.");
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, form.email, form.password);
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
          <div style={{ display: "flex", gap: 20 }}>
            {(["email", "phone"] as const).map((m) => (
              <button
                key={m}
                className="oc-action"
                onClick={() => {
                  setMode(m);
                  setError("");
                  setPending(null);
                  setCode("");
                }}
                style={{
                  background: "none", border: "none", padding: "0 0 6px", cursor: "pointer",
                  fontSize: 13, fontWeight: 400,
                  color: mode === m ? t.text : t.text3,
                  borderBottom: `1px solid ${mode === m ? t.text : "transparent"}`,
                }}
              >
                {m === "email" ? "Email" : "Mobile number"}
              </button>
            ))}
          </div>

          {mode === "email" ? (
            <>
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
            </>
          ) : !pending ? (
            <Field label="Mobile number" hint="The number registered on your account.">
              <input
                type="tel"
                inputMode="numeric"
                value={phone}
                onChange={(e) => setPhone(asTyped(e.target.value))}
                onKeyDown={(e) => e.key === "Enter" && sendCode()}
                placeholder="10-digit mobile number"
                style={inputStyle(t)}
              />
            </Field>
          ) : (
            <Field label="Code" hint={`Sent to ${pretty(phone)}.`}>
              <input
                type="text"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => e.key === "Enter" && verifyCode()}
                placeholder="123456"
                style={inputStyle(t)}
              />
            </Field>
          )}

          {notice && !error && <Note>{notice}</Note>}
          {error && <Note tone="warn">{error}</Note>}

          <div>
            {mode === "email" ? (
              <PrimaryButton onClick={handleLogin} disabled={loading} style={{ width: "100%", padding: "13px 16px" }}>
                {loading ? "Signing in" : "Sign in"}
              </PrimaryButton>
            ) : !pending ? (
              <PrimaryButton onClick={sendCode} disabled={loading} style={{ width: "100%", padding: "13px 16px" }}>
                {loading ? "Sending" : "Send code"}
              </PrimaryButton>
            ) : (
              <PrimaryButton onClick={verifyCode} disabled={loading} style={{ width: "100%", padding: "13px 16px" }}>
                {loading ? "Checking" : "Sign in"}
              </PrimaryButton>
            )}
          </div>

          {mode === "phone" && pending && (
            <GhostButton onClick={() => { setPending(null); setCode(""); setError(""); }}>
              Use a different number
            </GhostButton>
          )}

          {mode === "email" && (
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
          )}

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
