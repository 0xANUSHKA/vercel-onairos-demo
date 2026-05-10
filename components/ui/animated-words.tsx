"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

export function AnimatedWord({
  words,
  className,
}: {
  words: string[];
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const [maxWidth, setMaxWidth] = useState<number | undefined>(undefined);
  const measureRef = useRef<HTMLSpanElement>(null);
  const titles = useMemo(() => words, [words]);

  // Measure the widest word once on mount
  useEffect(() => {
  if (!measureRef.current) return;
  
  // Measure only the current word being displayed
  const el = measureRef.current;
  el.textContent = titles[index]; // 'currentWord' is the one currently visible
  
  // Update the width to match only this specific word
  setMaxWidth(el.offsetWidth);
}, [titles[index]]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setIndex(index === titles.length - 1 ? 0 : index + 1);
    }, 2500);
    return () => clearTimeout(timeout);
  }, [index, titles]);

  return (
    <>
      {/* Hidden measurer */}
      <span
        ref={measureRef}
        aria-hidden
        className={className}
        style={{
          position: "absolute",
          visibility: "hidden",
          whiteSpace: "nowrap",
          pointerEvents: "none",
        }}
      />
      <span
        className={className}
        style={{
          position: "relative",
          display: "inline-flex",
          justifyContent: "flex-start",
          overflow: "hidden",
          verticalAlign: "bottom",
          width: maxWidth ? maxWidth + 4 : undefined,
          transition: "width 0.35s ease-in-out",
        }}
      >
        <AnimatePresence mode="wait">
          <motion.span
            key={titles[index]}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -30 }}
            transition={{ duration: 0.35, ease: "easeInOut" }}
            style={{ 
              display: "inline-block",
              whiteSpace: "nowrap" 
            }}
          >
            {titles[index]}
          </motion.span>
        </AnimatePresence>
      </span>
    </>
  );
}
