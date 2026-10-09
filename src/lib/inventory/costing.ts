import type Decimal from "decimal.js";
import { dec, roundMoney, roundTo, type DecimalInput } from "@/lib/money";

/**
 * Laokaupade omahinna arvestus. Omahind arvutatakse artikli kaupa üle kõigi ladude, liikumiste
 * ajalugu kronoloogiliselt läbi mängides (sama kuupäeva sees enne sissetulekud, siis väljaminekud,
 * kinnitamise järjekorras). Nii annab tagantjärele sisestatud dokument ümberarvestusel sama
 * tulemuse, nagu oleks see sisestatud õigel ajal.
 *
 * Väärtused on sentides täpsed: iga liikumise väärtus ümardatakse 2 kohani ja laoseisu väärtus on
 * täpselt liikumiste väärtuste summa (viimane väljaminek viib väärtuse nulli).
 */

export type CostMethod = "FIFO" | "AVERAGE";

export type StockEvent = {
  id: string;
  /** ISO kuupäev (YYYY-MM-DD) */
  date: string;
  /** Järjekord sama kuupäeva sees (kinnitamise järjekord) */
  seq: number;
  /** Kogus märgiga: + sissetulek, − väljaminek */
  quantity: DecimalInput;
  /**
   * Fikseeritud väärtus märgiga (nt ostuarve rea summa või suletud perioodi liikumine).
   * Puudumisel arvutatakse: väljaminek meetodi järgi, sissetulek jooksva omahinnaga.
   */
  value?: DecimalInput | null;
  /** Sissetulek kindla ühikuhinnaga (väärtus = kogus × hind) */
  unitCost?: DecimalInput | null;
};

export type EventCost = { totalCost: Decimal; unitCost: Decimal; shortage: Decimal };

type Layer = { quantity: Decimal; value: Decimal };

export type StockState = { quantity: Decimal; value: Decimal; layers: Layer[] };

/** Sama kuupäeva sees sissetulekud enne väljaminekuid, seejärel kinnitamise järjekord. */
export function compareEvents(a: Pick<StockEvent, "date" | "seq" | "quantity">, b: Pick<StockEvent, "date" | "seq" | "quantity">) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const ai = dec(a.quantity).isNegative() ? 1 : 0;
  const bi = dec(b.quantity).isNegative() ? 1 : 0;
  if (ai !== bi) return ai - bi;
  return a.seq - b.seq;
}

const unitOf = (value: Decimal, quantity: Decimal) => (quantity.isZero() ? dec(0) : roundTo(value.div(quantity).abs(), 4));

/**
 * Mängib liikumised läbi ja tagastab iga liikumise väärtuse ning lõppseisu.
 * `fallbackCost` – ühikuhind, kui laos pole kunagi midagi olnud (nt artikli ostuhind).
 */
export function replayCosts(events: StockEvent[], method: CostMethod, fallbackCost: DecimalInput = 0) {
  const sorted = [...events].sort(compareEvents);
  const results = new Map<string, EventCost>();
  let layers: Layer[] = [];
  // Väärtus, millel pole kogust (fikseeritud väärtuse vahe tühjas laos); läheb järgmise sissetuleku hulka
  let residual = dec(0);
  let lastUnit = dec(fallbackCost);
  const quantity = () => layers.reduce((s, l) => s.plus(l.quantity), dec(0));
  const value = () => layers.reduce((s, l) => s.plus(l.value), residual);
  const currentUnit = () => {
    const q = quantity();
    if (q.greaterThan(0)) return method === "AVERAGE" ? value().div(q) : layers.at(-1)!.value.div(layers.at(-1)!.quantity);
    return lastUnit;
  };
  const addValue = (v: Decimal) => {
    if (layers[0]) layers[0].value = layers[0].value.plus(v);
    else residual = residual.plus(v);
  };

  function receive(qty: Decimal, v: Decimal) {
    if (method === "AVERAGE" || (layers[0] && layers[0].quantity.isNegative())) {
      // Keskmine (või puudujäägi katmine): üks koondkiht
      const q = quantity().plus(qty);
      const total = value().plus(v);
      residual = dec(0);
      layers = q.isZero() ? [] : [{ quantity: q, value: total }];
      if (q.isZero()) residual = total;
      return;
    }
    layers.push({ quantity: qty, value: v.plus(residual) });
    residual = dec(0);
  }

  /** Väljaminek; `forced` – fikseeritud väärtus (positiivne). Tagastab mahaläinud väärtuse (positiivne). */
  function issue(qty: Decimal, forced: Decimal | null): { taken: Decimal; shortage: Decimal } {
    let remaining = qty;
    let taken = dec(0);
    if (method === "AVERAGE") {
      const q = quantity();
      if (q.greaterThan(0)) {
        const take = remaining.lessThan(q) ? remaining : q;
        taken = take.equals(q) ? value() : roundMoney(value().times(take).div(q));
        remaining = remaining.minus(take);
      }
    } else {
      while (remaining.greaterThan(0) && layers[0] && layers[0].quantity.greaterThan(0)) {
        const layer = layers[0];
        if (layer.quantity.lessThanOrEqualTo(remaining)) {
          taken = taken.plus(layer.value);
          remaining = remaining.minus(layer.quantity);
          layers.shift();
        } else {
          const part = roundMoney(layer.value.times(remaining).div(layer.quantity));
          taken = taken.plus(part);
          layer.quantity = layer.quantity.minus(remaining);
          layer.value = layer.value.minus(part);
          remaining = dec(0);
        }
      }
      if (layers.length === 0) {
        taken = taken.plus(residual);
        residual = dec(0);
      }
    }
    const shortage = remaining;
    if (shortage.greaterThan(0)) taken = taken.plus(roundMoney(shortage.times(currentUnit())));
    const removed = forced ?? taken;
    if (method === "AVERAGE") {
      const q = quantity().minus(qty);
      const total = value().minus(removed);
      residual = dec(0);
      layers = q.isZero() ? [] : [{ quantity: q, value: total }];
      if (q.isZero()) residual = total;
    } else {
      if (shortage.greaterThan(0)) {
        // Puudujääk jääb negatiivse kihina, järgmine sissetulek katab selle
        const neg = roundMoney(shortage.times(currentUnit()));
        layers = [{ quantity: shortage.negated(), value: neg.negated() }];
      }
      // Fikseeritud ja arvutatud väärtuse vahe jääb laoseisu
      if (forced && !taken.equals(forced)) addValue(taken.minus(forced));
    }
    return { taken: removed, shortage };
  }

  for (const e of sorted) {
    const qty = dec(e.quantity);
    if (qty.isZero()) {
      const v = e.value != null ? roundMoney(e.value) : dec(0);
      if (!v.isZero()) addValue(v);
      results.set(e.id, { totalCost: v, unitCost: dec(0), shortage: dec(0) });
      continue;
    }
    if (qty.isPositive()) {
      const v = e.value != null ? roundMoney(e.value) : e.unitCost != null ? roundMoney(qty.times(dec(e.unitCost))) : roundMoney(qty.times(currentUnit()));
      receive(qty, v);
      lastUnit = v.div(qty).abs();
      results.set(e.id, { totalCost: v, unitCost: unitOf(v, qty), shortage: dec(0) });
    } else {
      const { taken, shortage } = issue(qty.negated(), e.value != null ? roundMoney(dec(e.value).negated()) : null);
      if (!taken.isZero()) lastUnit = taken.div(qty).abs();
      results.set(e.id, { totalCost: taken.negated(), unitCost: unitOf(taken, qty), shortage });
    }
  }

  return { results, state: { quantity: quantity(), value: value(), layers } satisfies StockState };
}

export type QuantityEvent = { date: string; seq: number; warehouseId: string; quantity: DecimalInput; itemId: string };

/**
 * Esimene hetk, mil mõne artikli kogus mõnes laos läheks negatiivseks (või null).
 * Kontrollitakse kogu ajalugu, et ka tagantjärele sisestatud väljaminek ei tekitaks hilisemat puudujääki.
 */
export function firstNegative(events: QuantityEvent[]) {
  const sorted = [...events].sort(compareEvents);
  const balance = new Map<string, Decimal>();
  // Sama kuupäeva sees kontrollitakse päeva lõpu seisu: päevasisesed liikumised ei pea olema õiges järjekorras
  let i = 0;
  while (i < sorted.length) {
    const date = sorted[i]!.date;
    const touched = new Set<string>();
    for (; i < sorted.length && sorted[i]!.date === date; i++) {
      const e = sorted[i]!;
      const key = `${e.itemId}|${e.warehouseId}`;
      balance.set(key, (balance.get(key) ?? dec(0)).plus(dec(e.quantity)));
      touched.add(key);
    }
    for (const key of touched) {
      const b = balance.get(key)!;
      if (b.isNegative()) {
        const [itemId, warehouseId] = key.split("|") as [string, string];
        return { itemId, warehouseId, date, quantity: b };
      }
    }
  }
  return null;
}
