"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { companyAction } from "@/lib/action";

const widgetId = z.string().regex(/^[a-z]{2,20}$/);

/** Kasutaja töölaua paigutus selles ettevõttes (vidinate järjestus ja peidetud vidinad). */
export const saveDashboardLayout = companyAction(
  {
    module: "dashboard",
    level: "view",
    schema: z.object({ order: z.array(widgetId).max(20), hidden: z.array(widgetId).max(20) }),
  },
  async (input, ctx) => {
    await db.membership.update({ where: { id: ctx.membership.id }, data: { dashboard: input } });
    return null;
  },
);
