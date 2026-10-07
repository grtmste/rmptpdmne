"use client";

import { createContext, use } from "react";
import type { PermissionMap } from "@/lib/permissions";
import type { CompanyRole } from "@/lib/permissions";

export type ShellCompany = { id: string; name: string; regCode: string | null; role: CompanyRole; isDemo: boolean };
export type ShellUser = { name: string | null; email: string };

export type ShellValue = {
  company: ShellCompany;
  companies: ShellCompany[];
  permissions: PermissionMap;
  role: CompanyRole;
  user: ShellUser;
  canCreateCompany: boolean;
  /** `/c/[companyId]` */
  basePath: string;
  openPalette: () => void;
};

export const ShellContext = createContext<ShellValue | null>(null);

export function useShell(): ShellValue {
  const value = use(ShellContext);
  if (!value) throw new Error("useShell peab olema ShellContexti sees");
  return value;
}

/** Membership-sarnane objekt õiguste kontrolliks kliendis (ainult UI peitmiseks). */
export function useMembership() {
  const { role, permissions } = useShell();
  return { role, permissions };
}
