"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { formatDocumentNumber } from "@/lib/accounting/numbering";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useActionRunner } from "@/components/common/use-action";
import { saveNumberSeries } from "@/server/actions/settings/series";

export type SeriesRow = {
  id: string;
  documentType: string;
  prefix: string;
  suffix: string;
  yearBased: boolean;
  padding: number;
  nextNumber: number;
};

/**
 * Numbriseeriad tabelina, iga rida salvestatakse eraldi. Aastapõhise seeria „järgmine number“
 * näitab jooksva aasta loendurit (muudetav ainult mitte-aastapõhisel seerial).
 */
export function NumberSeriesManager({
  companyId,
  series,
  year,
  canEdit,
}: {
  companyId: string;
  series: SeriesRow[];
  year: number;
  canEdit: boolean;
}) {
  const t = useTranslations("series");
  return (
    <Card className="overflow-hidden">
      <Table>
        <THead>
          <tr>
            <TH>{t("document")}</TH>
            <TH className="w-24">{t("prefix")}</TH>
            <TH className="w-28">{t("next")}</TH>
            <TH className="w-20">{t("padding")}</TH>
            <TH className="w-24 text-center">{t("yearBased")}</TH>
            <TH>{t("example")}</TH>
            <TH className="w-24" />
          </tr>
        </THead>
        <TBody>
          {series.map((s) => (
            <SeriesRowEditor key={s.id} companyId={companyId} row={s} year={year} canEdit={canEdit} />
          ))}
        </TBody>
      </Table>
      <p className="border-t px-4 py-3 text-xs text-muted-foreground">{t("hint")}</p>
    </Card>
  );
}

function SeriesRowEditor({ companyId, row, year, canEdit }: { companyId: string; row: SeriesRow; year: number; canEdit: boolean }) {
  const t = useTranslations("series");
  const tc = useTranslations("common");
  const { pending, run } = useActionRunner();
  const [v, setV] = useState(row);
  const dirty = JSON.stringify(v) !== JSON.stringify(row);
  const example = formatDocumentNumber(v, Math.max(1, Number(v.nextNumber) || 1), year);

  return (
    <TR>
      <TD className="font-medium">{t(`types.${row.documentType}`)}</TD>
      <TD>
        <Input
          aria-label={t("prefix")}
          value={v.prefix}
          disabled={!canEdit}
          onChange={(e) => setV({ ...v, prefix: e.target.value })}
          className="h-8"
        />
      </TD>
      <TD>
        <Input
          aria-label={t("next")}
          type="number"
          min={1}
          value={v.nextNumber}
          disabled={!canEdit || v.yearBased}
          onChange={(e) => setV({ ...v, nextNumber: Number(e.target.value) })}
          className="h-8"
        />
      </TD>
      <TD>
        <Input
          aria-label={t("padding")}
          type="number"
          min={0}
          max={10}
          value={v.padding}
          disabled={!canEdit}
          onChange={(e) => setV({ ...v, padding: Number(e.target.value) })}
          className="h-8"
        />
      </TD>
      <TD className="text-center">
        <input
          type="checkbox"
          aria-label={t("yearBased")}
          className="size-4 accent-[var(--primary)]"
          checked={v.yearBased}
          disabled={!canEdit}
          onChange={(e) => setV({ ...v, yearBased: e.target.checked })}
        />
      </TD>
      <TD className="font-mono text-[13px] text-muted-foreground">{example}</TD>
      <TD className="text-right">
        {canEdit && dirty && (
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  saveNumberSeries(companyId, {
                    id: v.id,
                    prefix: v.prefix,
                    suffix: v.suffix,
                    yearBased: v.yearBased,
                    padding: Number(v.padding) || 0,
                    nextNumber: Number(v.nextNumber) || 1,
                  }),
                { success: tc("saved") },
              )
            }
          >
            {tc("save")}
          </Button>
        )}
      </TD>
    </TR>
  );
}
