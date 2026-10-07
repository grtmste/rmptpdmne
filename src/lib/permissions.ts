import { z } from "zod";

/**
 * Õiguste mudel: roll annab igale moodulile vaiketaseme, Membership.permissions võib
 * üksikmooduli taset muuta. Sama funktsioon `can()` kehtib serveris ja kasutajaliideses
 * (kasutajaliides ainult peidab, otsustab alati server).
 */

export const MODULES = [
  "dashboard",
  "sales",
  "purchases",
  "payments",
  "finance",
  "inventory",
  "assets",
  "reports",
  "settings",
  "users",
] as const;
export type Module = (typeof MODULES)[number];

/** none < view < edit < confirm. confirm = dokumendi kinnitamine, perioodi sulgemine. */
export const LEVELS = ["none", "view", "edit", "confirm"] as const;
export type Level = (typeof LEVELS)[number];

export const COMPANY_ROLES = ["OWNER", "ACCOUNTANT", "EDITOR", "VIEWER"] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

export type PermissionMap = Record<Module, Level>;
export type PermissionOverrides = Partial<Record<Module, Level>>;

const BUSINESS_MODULES: Module[] = [
  "dashboard",
  "sales",
  "purchases",
  "payments",
  "finance",
  "inventory",
  "assets",
  "reports",
];

function build(business: Level, settings: Level, users: Level): PermissionMap {
  const map = {} as PermissionMap;
  for (const m of BUSINESS_MODULES) map[m] = business;
  map.settings = settings;
  map.users = users;
  // Töölaud on alati vähemalt vaatamiseks.
  if (map.dashboard === "none") map.dashboard = "view";
  return map;
}

export const ROLE_DEFAULTS: Record<CompanyRole, PermissionMap> = {
  OWNER: build("confirm", "confirm", "confirm"),
  ACCOUNTANT: build("confirm", "confirm", "none"),
  EDITOR: build("edit", "view", "none"),
  VIEWER: build("view", "view", "none"),
};

export const permissionOverridesSchema = z
  .partialRecord(z.enum(MODULES), z.enum(LEVELS))
  .nullable()
  .optional();

/** Loeb andmebaasi JSON-välja ohutult; tundmatud võtmed ja väärtused jäetakse kõrvale. */
export function parseOverrides(raw: unknown): PermissionOverrides {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: PermissionOverrides = {};
  for (const [key, value] of Object.entries(raw)) {
    if ((MODULES as readonly string[]).includes(key) && (LEVELS as readonly string[]).includes(value as string)) {
      result[key as Module] = value as Level;
    }
  }
  return result;
}

export function effectivePermissions(role: CompanyRole, overrides?: unknown): PermissionMap {
  const base = { ...ROLE_DEFAULTS[role] };
  const parsed = parseOverrides(overrides);
  for (const m of MODULES) {
    const o = parsed[m];
    if (o) base[m] = o;
  }
  // Kasutajate haldust ei saa erandiga anda kellelegi peale omaniku.
  if (role !== "OWNER") base.users = "none";
  return base;
}

export function levelRank(level: Level): number {
  return LEVELS.indexOf(level);
}

export function hasLevel(actual: Level, required: Level): boolean {
  return levelRank(actual) >= levelRank(required);
}

export type MembershipLike = { role: CompanyRole; permissions?: unknown };

export function can(membership: MembershipLike | null | undefined, module: Module, required: Level = "view"): boolean {
  if (!membership) return false;
  return hasLevel(effectivePermissions(membership.role, membership.permissions)[module], required);
}
