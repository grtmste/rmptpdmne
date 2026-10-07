"use server";

import { z } from "zod";
import { companyAction } from "@/lib/action";
import { searchAll } from "@/server/search/registry";
import "@/server/search/providers";

export const searchCompanyData = companyAction(
  { module: "dashboard", level: "view", schema: z.object({ query: z.string().trim().min(2).max(100) }) },
  async ({ query }, ctx) => searchAll(ctx, query),
);
