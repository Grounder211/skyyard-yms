import React, { useState, useEffect, useRef } from "react";
import { useScrollReveal } from "../hooks/useScrollReveal";

interface RevealProps {
  children: React.ReactNode;
  delay?: number;
  preset?: "fade-up" | "spring-pop";
  className?: string;
}

export function Reveal({ children, delay = 0, preset = "fade-up", className = "" }: RevealProps) {
  const { ref, revealed } = useScrollReveal();
  
  return (
    <div 
      ref={ref as any} 
      className={`${revealed ? `motion-${preset}` : "opacity-0"} ${className}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

interface CountUpProps {
  value: number;
  duration?: number;
  format?: (v: number) => string;
}

export function CountUp({ value, duration = 800, format = (v) => Math.round(v).toLocaleString() }: CountUpProps) {
  const [display, setDisplay] = useState(0);
  const startTime = useRef<number>(0);
  const startValue = useRef(0);
  const raf = useRef<number>(0);

  useEffect(() => {
    startValue.current = display;
    startTime.current = performance.now();
    
    const tick = (now: number) => {
      const elapsed = now - startTime.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // cubic ease-out
      
      const current = startValue.current + (value - startValue.current) * eased;
      setDisplay(current);
      
      if (progress < 1) {
        raf.current = requestAnimationFrame(tick);
      }
    };
    
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value, duration]);

  return <span>{format(display)}</span>;
}
