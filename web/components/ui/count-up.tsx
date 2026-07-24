"use client";

import {
  useInView,
  useMotionValue,
  useMotionValueEvent,
  useSpring,
} from "motion/react";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

export type CountUpProps = {
  to: number;
  from?: number;
  direction?: "up" | "down";
  delay?: number;
  duration?: number;
  className?: string;
  startWhen?: boolean;
  separator?: string;
  onStart?: () => void;
  onEnd?: () => void;
  /** When set, used instead of Intl-based formatting (for tokens, currency, duration, etc.). */
  format?: (value: number) => string;
};

function getDecimalPlaces(num: number): number {
  const str = num.toString();
  if (str.includes(".")) {
    const decimals = str.split(".")[1];
    if (decimals && Number.parseInt(decimals, 10) !== 0) {
      return decimals.length;
    }
  }
  return 0;
}

export default function CountUp({
  to,
  from = 0,
  direction = "up",
  delay = 0,
  duration = 0.1,
  className = "",
  startWhen = true,
  separator = "",
  onStart,
  onEnd,
  format: formatProp,
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const motionValue = useMotionValue(direction === "down" ? to : from);

  const onEndStable = useEffectEvent(() => {
    if (typeof onEnd === "function") {
      onEnd();
    }
  });

  const onStartStable = useEffectEvent(() => {
    if (typeof onStart === "function") {
      onStart();
    }
  });

  const damping = 20 + 40 * (1 / duration);
  const stiffness = 100 * (1 / duration);

  const springValue = useSpring(motionValue, {
    damping,
    stiffness,
  });

  const isInView = useInView(ref, { once: true, margin: "0px" });

  const maxDecimals = Math.max(getDecimalPlaces(from), getDecimalPlaces(to));

  const formatValue = useCallback(
    (latest: number) => {
      if (formatProp) {
        return formatProp(latest);
      }

      const hasDecimals = maxDecimals > 0;

      const options: Intl.NumberFormatOptions = {
        useGrouping: Boolean(separator),
        minimumFractionDigits: hasDecimals ? maxDecimals : 0,
        maximumFractionDigits: hasDecimals ? maxDecimals : 0,
      };

      const formattedNumber = Intl.NumberFormat("en-US", options).format(
        latest,
      );

      return separator
        ? formattedNumber.replace(/,/g, separator)
        : formattedNumber;
    },
    [formatProp, maxDecimals, separator],
  );

  // Keep latest formatter for motion subscriptions without listing it in
  // effect deps (react-doctor treats useEffectEvent as Effect-only).
  const formatValueRef = useRef(formatValue);
  useEffect(() => {
    formatValueRef.current = formatValue;
  }, [formatValue]);

  const initialText = formatValue(direction === "down" ? to : from);
  const [display, setDisplay] = useState(() => initialText);

  useEffect(() => {
    if (isInView && startWhen) {
      onStartStable();

      const timeoutId = setTimeout(() => {
        motionValue.set(direction === "down" ? from : to);
      }, delay * 1000);

      const durationTimeoutId = setTimeout(
        () => {
          onEndStable();
        },
        delay * 1000 + duration * 1000,
      );

      return () => {
        clearTimeout(timeoutId);
        clearTimeout(durationTimeoutId);
      };
    }
  }, [isInView, startWhen, motionValue, direction, from, to, delay, duration]);

  useMotionValueEvent(springValue, "change", (latest) => {
    setDisplay(formatValueRef.current(latest));
  });

  return (
    <span className={className} ref={ref}>
      {display}
    </span>
  );
}
