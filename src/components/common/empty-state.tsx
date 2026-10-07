import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Tühi olek: ikoon kahekordsel „kaardipakil“ (oma lihtne illustratsioon), pealkiri, selgitus
 * ja valikuline tegevus.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      <div className="relative mb-5 h-20 w-24" aria-hidden>
        <div className="absolute inset-x-3 top-0 h-14 rotate-[-6deg] rounded-xl border bg-muted" />
        <div className="absolute inset-x-1 top-2 h-14 rotate-[4deg] rounded-xl border bg-card" />
        <div className="absolute inset-x-0 top-4 flex h-14 items-center justify-center rounded-xl border bg-card shadow-sm">
          <Icon className="size-6 text-primary" />
        </div>
      </div>
      <h2 className="text-base font-semibold">{title}</h2>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
