import React, { useRef, useEffect, RefObject } from "react";

export function use3DTilt(maxDeg = 8) {
  const ref = useRef<HTMLDivElement>(null);
  const spring = useRef({ x: 0, y: 0, vx: 0, vy: 0 });
  const raf = useRef<number>(0);

  const animate = () => {
    const s = spring.current;
    const stiffness = 0.15;
    const damping = 0.75;
    
    s.vx += (0 - s.x) * stiffness;
    s.vx *= damping;
    s.vy += (0 - s.y) * stiffness;
    s.vy *= damping;
    s.x += s.vx;
    s.y += s.vy;

    if (ref.current) {
      ref.current.style.transform = `perspective(600px) rotateX(${s.x.toFixed(2)}deg) rotateY(${s.y.toFixed(2)}deg)`;
    }

    if (Math.abs(s.vx) > 0.01 || Math.abs(s.vy) > 0.01) {
      raf.current = requestAnimationFrame(animate);
    } else {
      raf.current = 0;
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (window.matchMedia("(hover: none)").matches) return; // No tilt on touch
    if (!ref.current) return;

    const rect = ref.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (e.clientX - cx) / (rect.width / 2);
    const dy = (e.clientY - cy) / (rect.height / 2);

    spring.current.x = -dy * maxDeg;
    spring.current.y = dx * maxDeg;
    
    if (raf.current === 0) {
      raf.current = requestAnimationFrame(animate);
    }
  };

  const onMouseLeave = () => {
    spring.current.x = 0;
    spring.current.y = 0;
    if (raf.current === 0) {
      raf.current = requestAnimationFrame(animate);
    }
  };

  return { ref, onMouseMove, onMouseLeave };
}
