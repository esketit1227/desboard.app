import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';

export function Toast({ message, onClose }: { message: string | null; onClose: () => void }) {
  useEffect(() => {
    if (message) {
      const t = setTimeout(onClose, 3000);
      return () => clearTimeout(t);
    }
  }, [message, onClose]);

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ opacity: 0, y: 50, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.9 }}
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[100] bg-[#D85E25] text-white px-6 py-3 rounded-full text-[12px] font-mono tracking-widest uppercase shadow-2xl border border-white/20"
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
