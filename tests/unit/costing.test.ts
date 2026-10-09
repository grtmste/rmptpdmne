import { describe, expect, it } from "vitest";
import { compareEvents, firstNegative, replayCosts, type StockEvent } from "@/lib/inventory/costing";

const ev = (id: string, date: string, quantity: string, extra: Partial<StockEvent> = {}, seq = 0): StockEvent => ({ id, date, seq, quantity, ...extra });
const costs = (r: ReturnType<typeof replayCosts>) => Object.fromEntries([...r.results].map(([k, v]) => [k, v.totalCost.toFixed(2)]));

describe("FIFO", () => {
  it("võtab väljamineku vanimatest kihtidest", () => {
    const r = replayCosts(
      [
        ev("in1", "2026-01-05", "10", { unitCost: "2" }),
        ev("in2", "2026-01-10", "10", { unitCost: "3" }),
        ev("out1", "2026-01-15", "-15"),
        ev("out2", "2026-01-20", "-3"),
      ],
      "FIFO",
    );
    expect(costs(r)).toEqual({ in1: "20.00", in2: "30.00", out1: "-35.00", out2: "-9.00" });
    expect(r.results.get("out1")!.unitCost.toFixed(4)).toBe("2.3333");
    expect([r.state.quantity.toFixed(4), r.state.value.toFixed(2)]).toEqual(["2.0000", "6.00"]);
  });

  it("tagantjärele sisestatud sissetulek muudab hilisema väljamineku omahinda", () => {
    const base = [ev("in1", "2026-01-05", "10", { value: "100" }), ev("out", "2026-02-01", "-10")];
    expect(costs(replayCosts(base, "FIFO")).out).toBe("-100.00");
    // Odavam sissetulek varasema kuupäevaga läheb järjekorras ette
    const r = replayCosts([...base, ev("early", "2026-01-01", "5", { value: "25" })], "FIFO");
    expect(costs(r).out).toBe("-75.00");
    expect(r.state.value.toFixed(2)).toBe("50.00");
  });

  it("jagab kihi väärtuse sentideni ja viimane väljaminek tühjendab väärtuse täpselt", () => {
    const r = replayCosts(
      [ev("in", "2026-01-01", "3", { value: "10" }), ev("a", "2026-01-02", "-1"), ev("b", "2026-01-03", "-1"), ev("c", "2026-01-04", "-1")],
      "FIFO",
    );
    expect(costs(r)).toMatchObject({ a: "-3.33", b: "-3.34", c: "-3.33" });
    expect(r.state.value.toFixed(2)).toBe("0.00");
  });

  it("sama päeva sissetulek läheb enne väljaminekut sõltumata sisestamise järjekorrast", () => {
    const r = replayCosts([ev("out", "2026-03-01", "-2", {}, 1), ev("in", "2026-03-01", "2", { value: "8" }, 2)], "FIFO");
    expect(costs(r).out).toBe("-8.00");
    expect(r.results.get("out")!.shortage.isZero()).toBe(true);
  });

  it("tagastatud kaup (hinnata sissetulek) võetakse viimase omahinnaga", () => {
    const r = replayCosts([ev("in", "2026-01-01", "4", { value: "20" }), ev("out", "2026-01-02", "-4"), ev("ret", "2026-01-03", "1")], "FIFO");
    expect(costs(r).ret).toBe("5.00");
  });

  it("fikseeritud väärtusega väljamineku vahe jääb laoseisu", () => {
    const r = replayCosts([ev("in", "2026-01-01", "10", { value: "100" }), ev("ret", "2026-01-02", "-2", { value: "-25" })], "FIFO");
    expect(costs(r).ret).toBe("-25.00");
    expect([r.state.quantity.toFixed(0), r.state.value.toFixed(2)]).toEqual(["8", "75.00"]);
  });
});

describe("kaalutud keskmine", () => {
  it("arvutab keskmise iga sissetuleku järel", () => {
    const r = replayCosts(
      [
        ev("in1", "2026-01-05", "10", { unitCost: "2" }),
        ev("out1", "2026-01-06", "-5"),
        ev("in2", "2026-01-10", "5", { unitCost: "4" }),
        ev("out2", "2026-01-15", "-6"),
        ev("out3", "2026-01-16", "-4"),
      ],
      "AVERAGE",
    );
    // 10 × 2 = 20; −5 → 10; +20 → 30 / 10 = 3; −6 = 18; viimane −4 = 12
    expect(costs(r)).toEqual({ in1: "20.00", out1: "-10.00", in2: "20.00", out2: "-18.00", out3: "-12.00" });
    expect(r.state.value.toFixed(2)).toBe("0.00");
  });

  it("puudujäägi korral kasutab viimast teadaolevat või varuhinda ja märgib puudujäägi", () => {
    const r = replayCosts([ev("out", "2026-01-01", "-2")], "AVERAGE", "7.5");
    expect(costs(r).out).toBe("-15.00");
    expect(r.results.get("out")!.shortage.toFixed(0)).toBe("2");
    expect(r.state.quantity.toFixed(0)).toBe("-2");
    // Järgmine sissetulek katab puudujäägi
    const r2 = replayCosts([ev("out", "2026-01-01", "-2"), ev("in", "2026-01-02", "4", { value: "40" })], "AVERAGE", "7.5");
    expect([r2.state.quantity.toFixed(0), r2.state.value.toFixed(2)]).toEqual(["2", "25.00"]);
  });

  it("kogus 0 ja väärtus (hinnaparandus) muudab ainult väärtust", () => {
    const r = replayCosts([ev("in", "2026-01-01", "2", { value: "10" }), ev("fix", "2026-01-02", "0", { value: "2" }), ev("out", "2026-01-03", "-1")], "AVERAGE");
    expect(costs(r).out).toBe("-6.00");
  });
});

describe("koguse kontroll", () => {
  const q = (date: string, warehouseId: string, quantity: string, seq = 0) => ({ date, seq, warehouseId, quantity, itemId: "i" });

  it("leiab esimese negatiivse seisu lao kaupa", () => {
    expect(firstNegative([q("2026-01-01", "A", "5"), q("2026-01-02", "A", "-3"), q("2026-01-02", "B", "1")])).toBeNull();
    const neg = firstNegative([q("2026-01-01", "A", "5"), q("2026-01-02", "A", "-5"), q("2026-01-02", "B", "3"), q("2026-01-03", "B", "-1"), q("2026-01-04", "A", "-1")]);
    expect(neg).toMatchObject({ warehouseId: "A", date: "2026-01-04" });
    expect(neg!.quantity.toFixed(0)).toBe("-1");
  });

  it("tagantjärele väljaminek, mis tekitab hilisema puudujäägi, avastatakse", () => {
    const events = [q("2026-01-01", "A", "5"), q("2026-03-01", "A", "-5"), q("2026-02-01", "A", "-1")];
    expect(firstNegative(events)).toMatchObject({ date: "2026-03-01" });
  });

  it("päevasisene järjekord ei loe", () => {
    expect(firstNegative([q("2026-01-01", "A", "-2", 1), q("2026-01-01", "A", "2", 2)])).toBeNull();
    expect(compareEvents({ date: "2026-01-01", seq: 5, quantity: "1" }, { date: "2026-01-01", seq: 1, quantity: "-1" })).toBeLessThan(0);
  });
});
