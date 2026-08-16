import React from "react";
import { ArrowRight, Minus } from "lucide-react";

/**
 * A clickable card in the right-hand widget column of the Dashboard. Provides the
 * shared chrome (title, arrow, minus button, divider); each widget passes its own
 * body as children.
 */
export function WidgetCard({
  title,
  onClick,
  children,
  active = false,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className={`backdrop-blur-xl rounded-[20px] flex flex-col flex-1 group shadow-xl cursor-pointer transition-all border overflow-hidden ${
        active ? "bg-white/[0.12] border-white/30" : "bg-white/[0.06] border-white/10 hover:bg-white/[0.11]"
      }`}
    >
      <div className="px-4 py-3 flex-1 flex flex-col justify-center">
        <div className="flex justify-between items-start mb-2">
          <div className="flex flex-col">
            <span className="font-display font-light text-[13px] uppercase tracking-[0.15em] text-[#EBE6DD] mb-[2px]">{title}</span>
            <ArrowRight className="w-[14px] h-[14px] transition-colors stroke-[1.5] text-white/50 group-hover:text-white" />
          </div>
          <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors">
            <Minus className="w-[12px] h-[12px] text-white" strokeWidth={2} />
          </div>
        </div>
        <div className="w-full h-px bg-white/10 mb-2"></div>
        {children}
      </div>
    </div>
  );
}
