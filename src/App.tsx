import { useState, useEffect, useRef, ReactNode } from "react";
import { signOut } from "firebase/auth";
import { auth } from "./firebase";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { can, isManagement, ROLE_LABELS_PLAIN } from "./auth/permissions";
import { ThemeProvider, useTheme } from "./context/ThemeContext";
import LoginPage from "./pages/auth/LoginPage";
import SignupPage from "./pages/auth/SignupPage";
import ForgotPasswordPage from "./pages/auth/ForgotPasswordPage";
import AddPhoneGate from "./pages/auth/AddPhoneGate";
import ChangePasswordGate from "./pages/auth/ChangePasswordGate";
import ProfilePage from "./pages/profile/ProfilePage";
import SalesView from "./pages/sales/SalesView";
import MarketingView from "./pages/marketing/MarketingView";
import OnlineMarketingView from "./pages/marketing/OnlineMarketingView";
import AdminDashboard from "./pages/admin/AdminDashboard";
import UserManagement from "./pages/admin/UserManagement";
import NotificationBell from "./components/NotificationBell";
import ListenerErrors from "./components/ListenerErrors";
import { Eyebrow, GhostButton } from "./components/ui";

// Nothing is auto-seeded any more.
//
// There used to be a seedDefaultProducts() here that recreated "Baby Wet Wipes"
// whenever it was absent, on every admin app load. It meant a deleted product
// silently reappeared on the next refresh — the delete worked, the seed undid
// it. A convenience that fires forever to handle a first-run case once, and
// quietly resurrects data somebody deliberately removed, is not worth having.
// Products are added from the Products screen.

/**
 * Whether an account with no verified mobile number is stopped before the app.
 *
 * Off. Two reasons, and the second is the one that matters.
 *
 * A gate needs a door. Verification depends on an SMS arriving, and while that
 * is unreliable this stops being "add your number" and becomes "you cannot
 * work today" — for every rep at once, which is a far worse outage than the
 * problem it was added to solve.
 *
 * And it is no longer carrying much. It existed because a verified number was
 * the only dependable way back into a locked-out account; a manager can now
 * reset a password directly, so recovery does not rest on the number any more.
 *
 * Signup still asks for a number and the Account screen still takes one — this
 * only decides whether anyone is *stopped*. Turn back on when a code reliably
 * arrives and there is a reason to insist.
 */
const REQUIRE_VERIFIED_PHONE = false

function AppContent() {
  const { firebaseUser, appUser, loading } = useAuth();
  const { theme, toggle, t } = useTheme();
  const [authScreen, setAuthScreen] = useState<"login" | "signup" | "forgot">("login");
  const [authNotice, setAuthNotice] = useState<string>("");

  const [showUserMgmt, setShowUserMgmt] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  if (loading)
    return (
      <div
        style={{
          minHeight: "100vh",
          background: t.bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ color: t.text2, fontSize: 14, fontWeight: 400 }}>
          Loading Ocealgo
        </div>
      </div>
    );

  // Signup and password reset both sign the account in partway through — the
  // one to attach a phone number, the other to change the password. Gating
  // those screens on "nobody is signed in" would therefore pull them out from
  // under the person using them at the exact moment they were working. They
  // are gated on the flow being open instead, and each closes its own flow.
  if (authScreen === "signup")
    return <SignupPage onSwitch={() => setAuthScreen("login")} />;

  if (authScreen === "forgot")
    return (
      <ForgotPasswordPage
        onDone={(message) => {
          setAuthNotice(message ?? "");
          setAuthScreen("login");
        }}
      />
    );

  if (!firebaseUser || !appUser)
    return (
      <LoginPage
        onSwitch={() => setAuthScreen("signup")}
        onForgot={() => { setAuthNotice(""); setAuthScreen("forgot"); }}
        notice={authNotice}
      />
    );

  const status = appUser.status;
  if (status === "pending" || status === "rejected" || status === "deactivated")
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
            <Eyebrow>
              {status === "pending" ? "Not approved yet" : "No access"}
            </Eyebrow>
          </div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 500,
              color: t.text,
              margin: 0,
              lineHeight: 1.3,
            }}
          >
            {status === "pending"
              ? "Waiting for approval"
              : status === "deactivated"
                ? "Your account was switched off"
                : "Your request was turned down"}
          </h1>
          <div
            style={{
              fontSize: 14,
              fontWeight: 400,
              color: t.text3,
              lineHeight: 1.6,
              marginTop: 8,
              marginBottom: 28,
            }}
          >
            {status === "pending"
              ? "An admin has to approve your account before you can use the dashboard. You will not need to sign up again — just sign in once they have."
              : status === "deactivated"
                ? "Someone on the admin team switched this account off. Talk to them if that was not expected."
                : "An admin turned down the request for access. Talk to them if you think that was a mistake."}
          </div>
          <GhostButton onClick={() => signOut(auth)}>Sign out</GhostButton>
        </div>
      </div>
    );

  // A password somebody else chose and read out loud comes first, ahead even
  // of the number gate. Until it is replaced, two people know it.
  if (appUser.mustChangePassword)
    return (
      <ChangePasswordGate
        uid={appUser.uid}
        name={appUser.name}
        byName={appUser.passwordResetByName}
      />
    );

  // Where "every account has a number" would be enforced, if it were. See
  // REQUIRE_VERIFIED_PHONE above for why it is not, and what to weigh before
  // switching it back on.
  //
  // super_admin stays exempt regardless. If the phone provider is
  // misconfigured, the region policy is wrong, or billing lapses, this screen
  // has no way past it — and locking out the one account that can fix any of
  // those turns a small outage into an unrecoverable one.
  if (REQUIRE_VERIFIED_PHONE && !firebaseUser.phoneNumber && appUser.role !== "super_admin")
    return <AddPhoneGate name={appUser.name} />;

  // sales_manager lands on the AdminDashboard too — what they actually see
  // inside it is decided per-permission, not per-role.
  const management = isManagement(appUser);
  const canViewUsers = can(appUser, "view_users");
  const isSales =
    appUser.role === "offline_sales" || appUser.role === "online_sales";

  return (
    <div style={{ background: t.bg, minHeight: "100vh" }}>
      <TopBar
        roleLabel={ROLE_LABELS_PLAIN[appUser.role]}
        showUsers={canViewUsers}
        theme={theme}
        onThemeToggle={toggle}
        onUsers={() => { setShowProfile(false); setShowUserMgmt(true); }}
        onProfile={() => { setShowUserMgmt(false); setShowProfile(true); }}
        onSignOut={() => signOut(auth)}
      />
      {/* Every screen below is written phone-first. This is the only place the
          wide-screen case is handled: one centred column instead of a phone
          layout stretched across a monitor. */}
      <div className="oc-page">
        {showProfile ? (
          <ProfilePage onBack={() => setShowProfile(false)} />
        ) : showUserMgmt ? (
          <UserManagement onBack={() => setShowUserMgmt(false)} />
        ) : (
          <>
            {isSales && <SalesView name={appUser.name} />}
            {appUser.role === "offline_marketing" && <MarketingView />}
            {appUser.role === "online_marketing" && <OnlineMarketingView />}
            {management && <AdminDashboard />}
          </>
        )}
      </div>
    </div>
  );
}

function TextAction({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  const { t } = useTheme();
  return (
    <button
      className="oc-action"
      onClick={onClick}
      style={{
        background: "none",
        border: "none",
        padding: 0,
        fontSize: 13,
        fontWeight: 400,
        color: t.text2,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function TopBar({
  roleLabel,
  showUsers,
  theme,
  onThemeToggle,
  onUsers,
  onProfile,
  onSignOut,
}: {
  roleLabel: string;
  showUsers: boolean;
  theme: string;
  onThemeToggle: () => void;
  onUsers: () => void;
  onProfile: () => void;
  onSignOut: () => void;
}) {
  const { t } = useTheme();
  return (
    <header
      className="oc-safe-top"
      style={{
        background: t.bg,
        borderBottom: `0.5px solid ${t.border}`,
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}
    >
      {/* The rule spans the window; its contents line up with the page column. */}
      <div
        className="oc-page"
        style={{
          padding: "14px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div
          style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}
        >
          <span
            style={{
              fontSize: 15,
              fontWeight: 500,
              color: t.text,
              whiteSpace: "nowrap",
              letterSpacing: "-0.01em",
            }}
          >
            Ocealgo
          </span>
          <span
            className="oc-md-up"
            style={{
              fontSize: 11,
              fontWeight: 400,
              color: t.text2,
              border: `0.5px solid ${t.border}`,
              borderRadius: 4,
              padding: "2px 7px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {roleLabel}
          </span>
        </div>

        <nav
          style={{
            display: "flex",
            gap: 16,
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          <NotificationBell />

          {/* Wide screens: actions inline */}
          <div
            className="oc-md-up"
            style={{ display: "flex", gap: 16, alignItems: "center" }}
          >
            {showUsers && <TextAction onClick={onUsers}>Team</TextAction>}
            <TextAction onClick={onProfile}>Account</TextAction>
            <TextAction onClick={onThemeToggle}>
              {theme === "dark" ? "Light" : "Dark"}
            </TextAction>
            <TextAction onClick={onSignOut}>Sign out</TextAction>
          </div>

          {/* Narrow screens: same actions behind one menu, so nothing wraps */}
          <div className="oc-sm-only">
            <HeaderMenu
              roleLabel={roleLabel}
              showUsers={showUsers}
              theme={theme}
              onUsers={onUsers}
              onProfile={onProfile}
              onThemeToggle={onThemeToggle}
              onSignOut={onSignOut}
            />
          </div>
        </nav>
      </div>
    </header>
  );
}

function HeaderMenu({
  roleLabel,
  showUsers,
  theme,
  onUsers,
  onProfile,
  onThemeToggle,
  onSignOut,
}: {
  roleLabel: string;
  showUsers: boolean;
  theme: string;
  onUsers: () => void;
  onProfile: () => void;
  onThemeToggle: () => void;
  onSignOut: () => void;
}) {
  const { t } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const item = (label: string, action: () => void) => (
    <button
      key={label}
      className="oc-row"
      onClick={() => {
        setOpen(false);
        action();
      }}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        background: "none",
        border: "none",
        borderTop: `0.5px solid ${t.border}`,
        padding: "12px 16px",
        fontSize: 14,
        fontWeight: 400,
        color: t.text,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        className="oc-action"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          fontSize: 13,
          fontWeight: 400,
          color: t.text2,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        Menu
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 12px)",
            right: 0,
            width: "min(220px, calc(100vw - 40px))",
            background: t.bg2,
            border: `0.5px solid ${t.border}`,
            borderRadius: 8,
            overflow: "hidden",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              padding: "11px 16px",
              fontSize: 12,
              fontWeight: 400,
              color: t.text3,
            }}
          >
            {roleLabel}
          </div>
          {showUsers && item("Team", onUsers)}
          {item("Account", onProfile)}
          {item(theme === "dark" ? "Light theme" : "Dark theme", onThemeToggle)}
          {item("Sign out", onSignOut)}
        </div>
      )}
    </div>
  );
}

function AppWithTheme() {
  const { firebaseUser, appUser } = useAuth();
  return (
    <ThemeProvider userId={appUser?.uid || firebaseUser?.uid}>
      <AppContent />
      {/* Mounted once, outside the route switch, so a listener that fails on
          any screen is reported. Renders nothing unless a super admin is
          signed in and something has actually failed. */}
      <ListenerErrors />
    </ThemeProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppWithTheme />
    </AuthProvider>
  );
}
