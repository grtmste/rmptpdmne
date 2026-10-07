"use client";

import { useTranslations } from "next-intl";
import {
  LEVELS,
  MODULES,
  ROLE_DEFAULTS,
  type CompanyRole,
  type Level,
  type PermissionOverrides,
} from "@/lib/permissions";
import { NativeSelect } from "@/components/ui/native-select";

/** Mooduli kaupa erandid rolli vaikeõigustest. Kasutajate haldust erandiga anda ei saa. */
export function PermissionEditor({
  role,
  value,
  onChange,
}: {
  role: CompanyRole;
  value: PermissionOverrides;
  onChange: (value: PermissionOverrides) => void;
}) {
  const t = useTranslations("permissions");
  const defaults = ROLE_DEFAULTS[role];
  const modules = MODULES.filter((m) => m !== "users" && m !== "dashboard");
  return (
    <div className="rounded-lg border">
      <div className="grid grid-cols-[1fr_auto] gap-x-4 border-b bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
        <span>{t("module")}</span>
        <span>{t("level")}</span>
      </div>
      <ul className="divide-y">
        {modules.map((m) => {
          const override = value[m];
          return (
            <li key={m} className="grid grid-cols-[1fr_auto] items-center gap-x-4 px-3 py-1.5">
              <label htmlFor={`perm-${m}`} className="text-sm">
                {t(`modules.${m}`)}
              </label>
              <NativeSelect
                id={`perm-${m}`}
                className="w-48"
                value={override ?? ""}
                onChange={(e) => {
                  const next = { ...value };
                  if (e.target.value === "") delete next[m];
                  else next[m] = e.target.value as Level;
                  onChange(next);
                }}
              >
                <option value="">{t("defaultLevel", { level: t(`levels.${defaults[m]}`) })}</option>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {t(`levels.${l}`)}
                  </option>
                ))}
              </NativeSelect>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
