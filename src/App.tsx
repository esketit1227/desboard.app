/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { Dashboard } from "./pages/Dashboard";
import { AuthGate } from "./components/auth/AuthGate";
import { JoinInvite } from "./components/auth/JoinInvite";

export default function App() {
  // No router in this app — the dashboard is a single-page desktop shell with
  // its own internal window/dock navigation. /join/:token is the one real URL
  // a teammate lands on cold (from an invite link, no session yet), so it's
  // handled as a simple path check rather than pulling in full routing.
  const joinMatch = /^\/join\/([^/]+)/.exec(window.location.pathname);
  if (joinMatch) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-black overflow-hidden selection:bg-white/20">
        <JoinInvite token={joinMatch[1]} />
      </div>
    );
  }

  return (
    <div className="w-screen h-screen flex items-center justify-center bg-black overflow-hidden selection:bg-white/20">
      <AuthGate>
        <Dashboard />
      </AuthGate>
    </div>
  );
}
