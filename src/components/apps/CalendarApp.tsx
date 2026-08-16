import { Clock } from "lucide-react";

/** Calendar window: upcoming events + a live-collab room panel. Static demo content. */
export function CalendarApp({ showToast }: { showToast: (msg: string) => void }) {
  return (
    <div className="flex flex-col h-full text-[#EBE6DD] w-full">
      <h2 className="font-display text-[42px] uppercase leading-[0.8] mb-4">Calendar</h2>
      <p className="text-[#DBCBC2]/80 text-[13px] tracking-wide mb-8">Real-time collaboration & schedule.</p>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 h-full">
        <div className="bg-[#111]/60 backdrop-blur-md rounded-2xl border border-white/5 p-6">
          <h3 className="text-[11px] uppercase tracking-widest text-[#DBCBC2]/60 mb-6">Upcoming Events</h3>
          <div className="flex flex-col gap-6">
            <div className="border-l-2 border-[#D85E25] pl-4">
              <h4 className="font-display text-[16px] uppercase tracking-wider mb-1 leading-none">Brand Kickoff</h4>
              <p className="text-[#DBCBC2]/80 text-[11px] uppercase tracking-widest mb-2">Nebula Inc.</p>
              <div className="flex items-center gap-2 text-[11px] font-mono text-[#DBCBC2]/40 bg-white/5 px-2 py-1 rounded w-fit">
                <Clock className="w-3.5 h-3.5" /> 14:00 - 15:30
              </div>
            </div>
            <div className="border-l-2 border-white/20 pl-4">
              <h4 className="font-display text-[16px] uppercase tracking-wider mb-1 leading-none">UI Review</h4>
              <p className="text-[#DBCBC2]/80 text-[11px] uppercase tracking-widest mb-2">Acme Corp</p>
              <div className="flex items-center gap-2 text-[11px] font-mono text-[#DBCBC2]/40 bg-white/5 px-2 py-1 rounded w-fit">
                <Clock className="w-3.5 h-3.5" /> Tomorrow, 10:00
              </div>
            </div>
          </div>
        </div>

        <div className="bg-[#111]/60 backdrop-blur-md rounded-2xl border border-white/5 p-6 flex flex-col">
          <h3 className="text-[11px] uppercase tracking-widest text-[#DBCBC2]/60 mb-6 flex items-center justify-between">
            Live Collab Room
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span> Active
            </span>
          </h3>
          <div className="flex-1 flex flex-col items-center justify-center text-center mt-4">
            <div className="flex -space-x-3 w-full justify-center mb-6">
              <div className="w-12 h-12 rounded-full bg-orange-400 border-[3px] border-[#1a0c14] z-30"></div>
              <div className="w-12 h-12 rounded-full bg-purple-400 border-[3px] border-[#1a0c14] z-20"></div>
              <div className="w-12 h-12 rounded-full bg-blue-400 border-[3px] border-[#1a0c14] z-10 flex items-center justify-center text-white text-[10px] uppercase font-bold">
                +2
              </div>
            </div>
            <p className="text-[13px] text-[#DBCBC2]/80 mb-6">3 team members active in Figma.</p>
            <button
              onClick={() => showToast("Joining session...")}
              className="px-6 py-3 w-full bg-white/5 border border-white/10 rounded-xl text-[11px] uppercase font-mono tracking-widest hover:bg-white/10 transition-colors"
            >
              Join Session
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
