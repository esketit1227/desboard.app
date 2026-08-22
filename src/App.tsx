/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { Dashboard } from "./pages/Dashboard";
import PricingPage from "./pages/PricingPage";
import { AuthGate } from "./components/auth/AuthGate";
import { BillingGate } from "./components/auth/BillingGate";
import { JoinInvite } from "./components/auth/JoinInvite";

export default function App() {
  // No router in this app — the dashboard is a single-page desktop shell with
  // its own internal window/dock navigation. /join/:token and /pricing are
  // the real URLs someone can land on cold, so each is handled as a simple
  // path check rather than pulling in full routing.
  const joinMatch = /^\/join\/([^/]+)/.exec(window.location.pathname);
  if (joinMatch) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-black overflow-hidden selection:bg-white/20">
        <JoinInvite token={joinMatch[1]} />
      </div>
    );
  }

  // Rendered on its own, not inside the dashboard shell's overflow-hidden
  // wrapper below — that wrapper is sized for the fixed-viewport app UI and
  // would clip this page's normal, scrollable document flow.
  if (window.location.pathname === "/pricing") {
    return <PricingPage />;
  }

  return (
    <div className="w-screen h-screen flex items-center justify-center bg-black overflow-hidden selection:bg-white/20">
      <AuthGate>
        <BillingGate>
          <Dashboard />
        </BillingGate>
      </AuthGate>
    </div>
  );
}
