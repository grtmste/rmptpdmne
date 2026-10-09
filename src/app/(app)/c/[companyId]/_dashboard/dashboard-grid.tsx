"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, Eye, EyeOff, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useActionRunner } from "@/components/common/use-action";
import { saveDashboardLayout } from "@/server/actions/dashboard";

export type Widget = { id: string; title: string; wide?: boolean; node: React.ReactNode };

/**
 * Töölaua vidinad kasutaja järjestuses. „Kohanda“ režiimis saab vidinaid liigutada ja peita;
 * paigutus salvestatakse kasutaja ja ettevõtte kaupa.
 */
export function DashboardGrid({ companyId, widgets, layout }: { companyId: string; widgets: Widget[]; layout: { order: string[]; hidden: string[] } }) {
  const t = useTranslations("dashboard");
  const { pending, run } = useActionRunner();
  const ids = widgets.map((w) => w.id);
  const initialOrder = [...layout.order.filter((id) => ids.includes(id)), ...ids.filter((id) => !layout.order.includes(id))];
  const [order, setOrder] = useState(initialOrder);
  const [hidden, setHidden] = useState(layout.hidden.filter((id) => ids.includes(id)));
  const [editing, setEditing] = useState(false);
  const byId = new Map(widgets.map((w) => [w.id, w]));

  const move = (id: string, dir: -1 | 1) => {
    const i = order.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setOrder(next);
  };
  const save = () => run(() => saveDashboardLayout(companyId, { order, hidden }), { success: t("layoutSaved"), refresh: false, onSuccess: () => setEditing(false) });

  return (
    <div className="space-y-3">
      <div className="flex justify-end gap-2 print:hidden">
        {editing ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setOrder(ids);
                setHidden([]);
              }}
            >
              {t("resetLayout")}
            </Button>
            <Button size="sm" disabled={pending} onClick={save}>
              {t("saveLayout")}
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <LayoutGrid /> {t("customize")}
          </Button>
        )}
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        {order.map((id, i) => {
          const w = byId.get(id)!;
          const isHidden = hidden.includes(id);
          if (isHidden && !editing) return null;
          return (
            <section key={id} aria-label={w.title} className={cn("relative", w.wide && "lg:col-span-2", editing && "rounded-xl ring-2 ring-primary/30 ring-offset-2 ring-offset-background", isHidden && "opacity-40")}>
              {editing && (
                <div className="absolute top-2 right-2 z-10 flex gap-1 rounded-lg border bg-card p-1 shadow-sm">
                  <Button size="icon-sm" variant="ghost" aria-label={t("moveUp", { name: w.title })} disabled={i === 0} onClick={() => move(id, -1)}>
                    <ArrowUp />
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label={t("moveDown", { name: w.title })} disabled={i === order.length - 1} onClick={() => move(id, 1)}>
                    <ArrowDown />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={isHidden ? t("showWidget", { name: w.title }) : t("hideWidget", { name: w.title })}
                    onClick={() => setHidden(isHidden ? hidden.filter((h) => h !== id) : [...hidden, id])}
                  >
                    {isHidden ? <Eye /> : <EyeOff />}
                  </Button>
                </div>
              )}
              {w.node}
            </section>
          );
        })}
      </div>
    </div>
  );
}
