import { useState, useEffect, useRef, ReactNode } from "react";
import { signOut } from "firebase/auth";
import { auth } from "./firebase";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { can, isManagement, ROLE_LABELS_PLAIN } from "./auth/permissions";
import { ThemeProvider, useTheme } from "./context/ThemeContext";
import LoginPage from "./pages/auth/LoginPage";
import SignupPage from "./pages/auth/SignupPage";
import SalesView from "./pages/sales/SalesView";
import MarketingView from "./pages/marketing/MarketingView";
import OnlineMarketingView from "./pages/marketing/OnlineMarketingView";
import AdminDashboard from "./pages/admin/AdminDashboard";
import UserManagement from "./pages/admin/UserManagement";
import NotificationBell from "./components/NotificationBell";
import { Eyebrow, GhostButton } from "./components/ui";

// Nothing is auto-seeded any more.
//
// There used to be a seedDefaultProducts() here that recreated "Baby Wet Wipes"
// whenever it was absent, on every admin app load. It meant a deleted product
// silently reappeared on the next refresh — the delete worked, the seed undid
// it. A convenience that fires forever to handle a first-run case once, and
// quietly resurrects data somebody deliberately removed, is not worth having.
// Products are added from the Products screen.

function AppContent() {
  const { firebaseUser, appUser, loading } = useAuth();
  const { theme, toggle, t } = useTheme();
  const [authScreen, setAuthScreen] = useState<"login" | "signup">("login");

  const [showUserMgmt, setShowUserMgmt] = useState(false);

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

  if (!firebaseUser || !appUser) {
    if (authScreen === "signup")
      return <SignupPage onSwitch={() => setAuthScreen("login")} />;
    return <LoginPage onSwitch={() => setAuthScreen("signup")} />;
  }

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

  // sales_manager lands on the AdminDashboard too — what they actually see
  // inside it is decided per-permission, not per-role.
  const management = isManagement(appUser);
  const canViewUsers = can(appUser, "view_users");
  const isSales =
    appUser.role === "offline_sales" || appUser.role === "online_sales";

  if (showUserMgmt)
    return (
      <div style={{ background: t.bg, minHeight: "100vh" }}>
        <TopBar
          roleLabel={ROLE_LABELS_PLAIN[appUser.role]}
          showUsers={canViewUsers}
          theme={theme}
          onThemeToggle={toggle}
          onUsers={() => setShowUserMgmt(true)}
          onSignOut={() => signOut(auth)}
        />
        <UserManagement onBack={() => setShowUserMgmt(false)} />
      </div>
    );

  return (
    <div style={{ background: t.bg, minHeight: "100vh" }}>
      <TopBar
        roleLabel={ROLE_LABELS_PLAIN[appUser.role]}
        showUsers={canViewUsers}
        theme={theme}
        onThemeToggle={toggle}
        onUsers={() => setShowUserMgmt(true)}
        onSignOut={() => signOut(auth)}
      />
      {isSales && <SalesView name={appUser.name} />}
      {appUser.role === "offline_marketing" && <MarketingView />}
      {appUser.role === "online_marketing" && <OnlineMarketingView />}
      {management && <AdminDashboard />}
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
  onSignOut,
}: {
  roleLabel: string;
  showUsers: boolean;
  theme: string;
  onThemeToggle: () => void;
  onUsers: () => void;
  onSignOut: () => void;
}) {
  const { t } = useTheme();
  return (
    <header
      style={{
        background: t.bg,
        borderBottom: `0.5px solid ${t.border}`,
        padding: "14px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        position: "sticky",
        top: 0,
        zIndex: 50,
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
            onThemeToggle={onThemeToggle}
            onSignOut={onSignOut}
          />
        </div>
      </nav>
    </header>
  );
}

function HeaderMenu({
  roleLabel,
  showUsers,
  theme,
  onUsers,
  onThemeToggle,
  onSignOut,
}: {
  roleLabel: string;
  showUsers: boolean;
  theme: string;
  onUsers: () => void;
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
