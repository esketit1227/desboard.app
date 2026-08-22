/**
 * Gate between "nobody's signed in" and the actual app. Checks the existing
 * session once on mount (GET /api/auth/me) — every /api/* route the
 * Dashboard calls requires a session, so nothing behind this gate can load
 * without one. When there's no session: /signin renders the actual sign-in
 * form (see SignInPage.tsx), anything else renders the marketing landing
 * page (see LandingSections.tsx) — both are plain pathname checks, matching
 * how the rest of this app routes without a router (see App.tsx).
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { MotionConfig } from "motion/react";
import { api } from "../../lib/api";
import type { AuthUser } from "../../types";
import { AuthContext } from "./AuthContext";
import SignInPage from "../../pages/SignInPage";
import {
  EditorialNav,
  EditorialHero,
  IntegrationMarquee,
  StudioAtmosphere,
  ProductBlocks,
  PrincipleQuote,
  UpdateSpotlight,
  FeatureCarousel,
  LandingPricingTeaser,
  EditorialFAQ,
  EditorialFooter,
} from "./LandingSections";

type Status = "loading" | "anon" | "authed";

export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);

  const refresh = useCallback(async () => {
    const u = await api.me();
    setUser(u);
    setStatus("authed");
  }, []);

  useEffect(() => {
    refresh().catch(() => setStatus("anon"));
  }, [refresh]);

  const handleLogout = useCallback(async () => {
    await api.logout();
    setUser(null);
    setStatus("anon");
  }, []);

  if (status === "loading") {
    return <div className="w-screen h-screen bg-paper" />;
  }

  if (status === "authed" && user) {
    return (
      <AuthContext.Provider value={{ user, refresh, logout: handleLogout }}>
        {children}
      </AuthContext.Provider>
    );
  }

  if (window.location.pathname === "/signin") {
    return <SignInPage />;
  }

  return (
    <MotionConfig reducedMotion="user">
      <div id="editorial-scroll" className="editorial w-screen h-screen overflow-y-auto">
        <EditorialNav />
        <EditorialHero />

        <IntegrationMarquee />
        <StudioAtmosphere />
        <ProductBlocks />
        <PrincipleQuote />
        <UpdateSpotlight />
        <FeatureCarousel />
        <LandingPricingTeaser />
        <EditorialFAQ />
        <EditorialFooter />
      </div>
    </MotionConfig>
  );
}
