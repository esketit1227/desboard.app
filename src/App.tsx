/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { Dashboard } from "./pages/Dashboard";

export default function App() {
  return (
    <div className="w-screen h-screen flex items-center justify-center bg-[#1a0c14] overflow-hidden selection:bg-[#fff]/20">
       <Dashboard />
    </div>
  );
}
