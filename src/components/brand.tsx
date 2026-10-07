import { cn } from "@/lib/utils";

/** LILY SOKID märk: stiliseeritud sokk ümardatud ruudus. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-8", className)}>
      <rect width="32" height="32" rx="8" fill="currentColor" className="text-primary" />
      <path
        d="M12 6.5h7.5v11.2c0 .9.4 1.7 1 2.3l1.2 1.1a3.6 3.6 0 0 1-2.5 6.2h-4.4a5.3 5.3 0 0 1-5.3-5.3c0-1.5.6-2.9 1.7-3.9l.8-.7V6.5Z"
        fill="#fff"
        fillOpacity=".95"
      />
      <path d="M12 9.5h7.5" stroke="#5ed3c1" strokeWidth="1.6" />
      <path d="M12 12h7.5" stroke="#5ed3c1" strokeWidth="1.6" />
    </svg>
  );
}

export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <BrandMark />
      <span className="text-[15px] font-bold tracking-[0.08em]">LILY SOKID</span>
    </span>
  );
}
