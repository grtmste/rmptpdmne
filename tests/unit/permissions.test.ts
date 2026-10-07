import { describe, expect, it } from "vitest";
import { can, effectivePermissions, parseOverrides } from "@/lib/permissions";
import { visibleNavigation, visibleQuickActions } from "@/lib/navigation";

describe("rollide vaikeõigused", () => {
  it("omanik saab kõike", () => {
    expect(can({ role: "OWNER" }, "users", "confirm")).toBe(true);
    expect(can({ role: "OWNER" }, "finance", "confirm")).toBe(true);
  });

  it("raamatupidaja kinnitab, aga ei halda kasutajaid", () => {
    expect(can({ role: "ACCOUNTANT" }, "sales", "confirm")).toBe(true);
    expect(can({ role: "ACCOUNTANT" }, "settings", "confirm")).toBe(true);
    expect(can({ role: "ACCOUNTANT" }, "users", "view")).toBe(false);
  });

  it("koostaja muudab, aga ei kinnita", () => {
    expect(can({ role: "EDITOR" }, "sales", "edit")).toBe(true);
    expect(can({ role: "EDITOR" }, "sales", "confirm")).toBe(false);
    expect(can({ role: "EDITOR" }, "settings", "edit")).toBe(false);
  });

  it("vaataja ainult vaatab", () => {
    expect(can({ role: "VIEWER" }, "sales", "view")).toBe(true);
    expect(can({ role: "VIEWER" }, "sales", "edit")).toBe(false);
  });

  it("liikmesuseta pole midagi", () => {
    expect(can(null, "dashboard", "view")).toBe(false);
  });
});

describe("mooduli erandid", () => {
  it("erand muudab ainult seda moodulit", () => {
    const m = { role: "EDITOR" as const, permissions: { purchases: "none", finance: "view" } };
    expect(can(m, "purchases", "view")).toBe(false);
    expect(can(m, "finance", "edit")).toBe(false);
    expect(can(m, "sales", "edit")).toBe(true);
  });

  it("kasutajate haldust ei saa erandiga anda", () => {
    expect(effectivePermissions("ACCOUNTANT", { users: "confirm" }).users).toBe("none");
  });

  it("vigane JSON jäetakse kõrvale", () => {
    expect(parseOverrides({ sales: "admin", hacker: "confirm", finance: "view" })).toEqual({ finance: "view" });
    expect(parseOverrides("x")).toEqual({});
    expect(parseOverrides([1, 2])).toEqual({});
  });
});

describe("menüü õiguste järgi", () => {
  it("peidab moodulid, millele ligipääs puudub", () => {
    const nav = visibleNavigation({ role: "EDITOR", permissions: { purchases: "none" } });
    expect(nav.map((g) => g.id)).not.toContain("purchases");
    expect(nav.map((g) => g.id)).toContain("sales");
  });

  it("kasutajate haldus ainult omanikule", () => {
    const ids = (role: "OWNER" | "ACCOUNTANT") =>
      visibleNavigation({ role }).flatMap((g) => g.sections.flatMap((s) => s.items.map((i) => i.id)));
    expect(ids("OWNER")).toContain("settings.users");
    expect(ids("ACCOUNTANT")).not.toContain("settings.users");
  });

  it("vaatajale pole loomise kiirtoiminguid", () => {
    expect(visibleQuickActions({ role: "VIEWER" }).map((a) => a.id)).toEqual(["newCompany"]);
  });
});
