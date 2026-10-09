import { describe, expect, it } from "vitest";
import { parseISODate, toISODate } from "@/lib/accounting/dates";
import { agingBucket, weekBucket, weekBucketRange, weekStart } from "@/lib/reports/aging";

const d = (s: string) => parseISODate(s)!;

describe("võlgnevuste vanus", () => {
  it("tähtaja ületamise vahemikud", () => {
    const asOf = d("2026-10-09");
    expect(agingBucket(d("2026-10-09"), asOf)).toBe("notDue");
    expect(agingBucket(d("2026-10-20"), asOf)).toBe("notDue");
    expect(agingBucket(d("2026-10-08"), asOf)).toBe("d1_30");
    expect(agingBucket(d("2026-09-09"), asOf)).toBe("d1_30");
    expect(agingBucket(d("2026-09-08"), asOf)).toBe("d31_60");
    expect(agingBucket(d("2026-07-11"), asOf)).toBe("d61_90");
    expect(agingBucket(d("2026-07-10"), asOf)).toBe("d90plus");
  });

  it("nädalad algavad esmaspäeval", () => {
    expect(toISODate(weekStart(d("2026-10-09")))).toBe("2026-10-05"); // reede
    expect(toISODate(weekStart(d("2026-10-05")))).toBe("2026-10-05");
    expect(toISODate(weekStart(d("2026-10-11")))).toBe("2026-10-05"); // pühapäev
  });

  it("töölaua nädalatulbad", () => {
    const today = d("2026-10-09");
    expect(weekBucket(d("2026-10-05"), today)).toBe("w0");
    expect(weekBucket(d("2026-10-04"), today)).toBe("w-1");
    expect(weekBucket(d("2026-09-07"), today)).toBe("w-4");
    expect(weekBucket(d("2026-09-06"), today)).toBe("older");
    expect(weekBucket(d("2026-10-12"), today)).toBe("w+1");
    expect(weekBucket(d("2026-11-01"), today)).toBe("w+3");
    expect(weekBucket(d("2026-11-02"), today)).toBe("later");
    const r = weekBucketRange("w-1", today);
    expect([toISODate(r.from!), toISODate(r.to!)]).toEqual(["2026-09-28", "2026-10-04"]);
    expect(toISODate(weekBucketRange("older", today).to!)).toBe("2026-09-06");
    expect(toISODate(weekBucketRange("later", today).from!)).toBe("2026-11-02");
  });
});
