import { useState, useEffect } from "react";
import { signOut } from "firebase/auth";
import { auth } from "./firebase";
import { AuthProvider, useAuth } from "./context/AuthContext";
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

  useEffect(() => {
    seedDefaultProducts();
  }, []);
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
        <div style={{ color: t.text2, fontSize: 14, letterSpacing: 2 }}>
          Loading Ocealgo...
        </div>
      </div>
    );

  if (!firebaseUser || !appUser) {
    if (authScreen === "signup")
      return <SignupPage onSwitch={() => setAuthScreen("login")} />;
    return <LoginPage onSwitch={() => setAuthScreen("signup")} />;
  }

  const status = (appUser as any).status;
  if (status === "pending" || status === "rejected" || status === "deactivated")
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#000000",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
          textAlign: "center",
        }}
      >
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
            color: "rgba(255,255,255,0.55)",
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

  const isAdmin = appUser.role === "super_admin" || appUser.role === "admin";
  const isSales =
    appUser.role === "offline_sales" || appUser.role === "online_sales";

  const ROLE_LABEL: Record<string, string> = {
    offline_sales: "Offline Sales",
    online_sales: "Online Sales",
    offline_marketing: "Offline Marketing",
    online_marketing: "Online Marketing",
    admin: "Admin",
    super_admin: "Super Admin",
  };

  if (showUserMgmt)
    return (
      <div style={{ background: t.bg, minHeight: "100vh" }}>
        <TopBar
          roleLabel={ROLE_LABEL[appUser.role]}
          isAdmin={isAdmin}
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
        roleLabel={ROLE_LABEL[appUser.role]}
        isAdmin={isAdmin}
        theme={theme}
        onThemeToggle={toggle}
        onUsers={() => setShowUserMgmt(true)}
        onSignOut={() => signOut(auth)}
      />
      {isSales && <SalesView name={appUser.name} />}
      {appUser.role === "offline_marketing" && <MarketingView />}
      {appUser.role === "online_marketing" && <OnlineMarketingView />}
      {isAdmin && <AdminDashboard />}
    </div>
  );
}

function TopBar({
  roleLabel,
  isAdmin,
  theme,
  onThemeToggle,
  onUsers,
  onSignOut,
}: {
  roleLabel: string;
  isAdmin: boolean;
  theme: string;
  onThemeToggle: () => void;
  onUsers: () => void;
  onSignOut: () => void;
}) {
  return (
    <div
      style={{
        background: "#000000",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        padding: "10px 12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}
      >
        <span
          style={{
            color: "#ffffff",
            fontSize: 13,
            fontWeight: 800,
            whiteSpace: "nowrap",
          }}
        >
          Ocealgo
        </span>
        <span
          style={{
            fontSize: 10,
            color: "rgba(255,255,255,0.45)",
            background: "rgba(255,255,255,0.07)",
            padding: "2px 6px",
            borderRadius: 99,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: 120,
          }}
        >
          {roleLabel}
        </span>
      </div>
      <div
        style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}
      >
        <button
          onClick={onThemeToggle}
          style={{
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 10,
            padding: "7px 10px",
            fontSize: 11,
            fontWeight: 700,
            cursor: "pointer",
            lineHeight: 1,
            color: "#ffffff",
          }}
        >
          {theme === "dark" ? "Light" : "Dark"}
        </button>
        <NotificationBell />
        {isAdmin && (
          <button
            onClick={onUsers}
            style={{
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "#ffffff",
              borderRadius: 10,
              padding: "7px 10px",
              fontSize: 11,
              fontWeight: 700,
              lineHeight: 1,
            }}
          >
            Users
          </button>
        )}
        <button
          onClick={onSignOut}
          style={{
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.2)",
            color: "#ef4444",
            borderRadius: 10,
            padding: "7px 10px",
            fontSize: 11,
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          Exit
        </button>
      </div>
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
