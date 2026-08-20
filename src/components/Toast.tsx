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
          initial={{ opacity: 0, y: 20, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.96 }}
          className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2.5 bg-ink text-paper pl-3.5 pr-4 py-2.5 rounded-full text-[13px] shadow-lg"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" aria-hidden />
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
