"use client";

import { useRouter } from "next/navigation";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/money";

export type WeekPoint = { bucket: string; label: string; amount: number; past: boolean; href: string };

/** Tasumata summad tähtaja nädalate kaupa; möödunud nädalad hoiatusvärviga. Tulbal klõps avab aruande. */
export function WeeklyChart({ data, locale, ariaLabel }: { data: WeekPoint[]; locale: string; ariaLabel: string }) {
  const router = useRouter();
  return (
    <div className="h-40 w-full" role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <XAxis dataKey="label" tickLine={false} axisLine={false} interval={0} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
          <YAxis hide />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
            formatter={(v) => [formatMoney(Number(v), locale), ""]}
            separator=""
          />
          <Bar dataKey="amount" radius={[4, 4, 0, 0]} onClick={(d: { payload?: WeekPoint }) => d.payload && router.push(d.payload.href)} className="cursor-pointer">
            {data.map((d) => (
              <Cell key={d.bucket} fill={d.past ? "var(--warning)" : d.bucket === "w0" ? "var(--primary)" : "color-mix(in oklab, var(--primary) 55%, transparent)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
