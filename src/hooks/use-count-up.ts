import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'react-native-reanimated';

import { motion } from '@/theme';

/**
 * Counts a figure up from zero on its first paint, then follows the target
 * exactly on every later change. A balance that re-animates each time a screen
 * regains focus is irritating and makes the app feel slow; it should read as
 * the figure being totalled once, then settled. Honours the reduce-motion
 * setting by skipping the animation entirely.
 */
export function useCountUp(target: number, enabled = true): number {
  const reduceMotion = useReducedMotion();
  const animate = enabled && !reduceMotion;
  const [value, setValue] = useState(animate ? 0 : target);
  const firstPaint = useRef(true);

  useEffect(() => {
    if (!firstPaint.current || !animate) {
      firstPaint.current = false;
      setValue(target);
      return;
    }
    firstPaint.current = false;

    const start = Date.now();
    const duration = motion.numberReveal.duration;
    let frame = 0;
    const tick = () => {
      const t = Math.min((Date.now() - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, animate]);

  return value;
}
