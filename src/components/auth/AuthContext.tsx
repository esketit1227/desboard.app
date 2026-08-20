import { createContext, useContext } from "react";
import type { AuthUser } from "../../types";

export interface AuthContextValue {
  user: AuthUser;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth() must be used within an authenticated AuthGate tree");
  return ctx;
}
