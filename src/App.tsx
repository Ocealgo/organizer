import { useState, useEffect, ReactNode } from "react";
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

// Seed default product only if Baby Wet Wipes doesn't exist yet
async function seedDefaultProducts() {
  const { getDocs, collection, addDoc, query, where } =
    await import("firebase/firestore");
  const { db } = await import("./firebase");
  const snap = await getDocs(
    query(collection(db, "products"), where("name", "==", "Baby Wet Wipes")),
  );
  if (snap.empty) {
    await addDoc(collection(db, "products"), {
      name: "Baby Wet Wipes",
      unitLabel: "packets",
      defaultPricePerUnit: 45,
      unitsPerCarton: 12,
      active: true,
      createdBy: "system",
      createdAt: Date.now(),
    });
  }
}

function AppContent() {
  const { firebaseUser, appUser, loading } = useAuth();
  const { theme, toggle, t } = useTheme();
  const [authScreen, setAuthScreen] = useState<"login" | "signup">("login");

  // Only admins may write `products` (see firestore.rules). Running this for a
  // sales rep would fail with a permission error on every app load.
  useEffect(() => {
    const role = appUser?.role;
    if (role !== "admin" && role !== "super_admin") return;
    seedDefaultProducts().catch(() => {});
  }, [appUser?.role]);
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
          background: "linear-gradient(145deg,#0d3d2e,#060a0f)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 56, marginBottom: 20 }}>
          {status === "pending" ? "⏳" : status === "deactivated" ? "🚫" : "❌"}
        </div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 800,
            marginBottom: 10,
            color: "#fff",
          }}
        >
          {status === "pending"
            ? "Awaiting Approval"
            : status === "deactivated"
              ? "Account Deactivated"
              : "Access Rejected"}
        </div>
        <div
          style={{
            color: "#a7f3d0",
            fontSize: 14,
            lineHeight: 1.8,
            marginBottom: 32,
            maxWidth: 300,
          }}
        >
          {status === "pending"
            ? "Your account is pending admin approval."
            : status === "deactivated"
              ? "Your account has been deactivated. Contact the admin team."
              : "Your account was rejected. Contact the admin team."}
        </div>
        <button
          onClick={() => signOut(auth)}
          style={{
            background: "rgba(255,255,255,0.1)",
            border: "1px solid rgba(255,255,255,0.2)",
            color: "#fff",
            padding: "12px 32px",
            borderRadius: 50,
            fontSize: 14,
          }}
        >
          Sign Out
        </button>
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
          gap: 18,
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <NotificationBell />
        {showUsers && <TextAction onClick={onUsers}>Team</TextAction>}
        <TextAction onClick={onThemeToggle}>
          {theme === "dark" ? "Light" : "Dark"}
        </TextAction>
        <TextAction onClick={onSignOut}>Sign out</TextAction>
      </nav>
    </header>
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
