import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { api, API_URL, AUTH_TOKEN_KEY } from "../api/client";
import { User } from "../types";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  logout: () => Promise<void>;
  googleLoginUrl: string;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// The Google OAuth callback redirects here with #token=<jwt> instead of
// setting a cookie (see backend/src/routes/auth.ts). Pull it out of the
// URL fragment once, store it, and scrub it from the address bar/history
// so it doesn't linger somewhere it could be copied or shared by mistake.
function captureTokenFromRedirect(): void {
  if (!window.location.hash.includes("token=")) return;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get("token");
  if (token) {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  }
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    captureTokenFromRedirect();
    api
      .get<User>("/auth/me")
      .then((res) => setUser(res.data))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  async function logout() {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    setUser(null);
    await api.post("/auth/logout").catch(() => {});
  }

  return (
    <AuthContext.Provider value={{ user, loading, logout, googleLoginUrl: `${API_URL}/api/auth/google` }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
