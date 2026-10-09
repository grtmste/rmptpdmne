import { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "./prisma";

/**
 * Ettevõtte andmete eraldamine.
 *
 * `scopeToCompany(client, companyId)` tagastab Prisma kliendi, mille iga päring on piiratud
 * ühe ettevõttega:
 * - kõikidele `where` tingimustele lisatakse AND-iga `companyId` (ka findUnique/update/delete –
 *   Prisma lubab unikaalvõtme kõrval lisatingimusi); võõra ettevõtte filter annab tühja tulemuse;
 * - `create`/`createMany`/`upsert` saavad `companyId` automaatselt;
 * - `companyId` muutmine teise ettevõtte omaks on keelatud;
 * - mudelid, millel `companyId` puudub, on keelatud (v.a `Company`, mis on piiratud oma reaga).
 *
 * Alamkirjed (nt arve read) seotakse komposiitvõtmega (companyId, parentId), nii et pesastatud
 * create täidab companyId vanemalt ja andmebaas ei luba viidata teise ettevõtte kirjele.
 */

/** Mudelid, millel on `companyId`. Test `tenant-models.test.ts` kontrollib, et nimekiri vastab skeemile. */
export const TENANT_MODELS = [
  "RecurringInvoice",
  "Warehouse",
  "StockMovement",
  "StockMovementLine",
  "RecurringInvoiceLine",
  "LateInterestCharge",
  "Membership",
  "Invitation",
  "Notification",
  "AuditLog",
  "GlAccount",
  "VatRate",
  "VatRatePeriod",
  "FiscalYear",
  "NumberSeries",
  "NumberSeriesCounter",
  "CompanyCurrency",
  "Department",
  "Dimension",
  "DimensionValue",
  "JournalEntry",
  "JournalLine",
  "JournalLineDimension",
  "JournalTemplate",
  "JournalTemplateLine",
  "CustomerGroup",
  "Customer",
  "ItemGroup",
  "Item",
  "SalesInvoice",
  "SalesInvoiceLine",
  "Quote",
  "QuoteLine",
  "EmailLog",
  "SupplierGroup",
  "Supplier",
  "Employee",
  "PurchaseInvoice",
  "PurchaseInvoiceLine",
  "PurchaseOrder",
  "PurchaseOrderLine",
  "ExpenseReport",
  "ExpenseReportLine",
  "Attachment",
  "BankAccount",
  "Payment",
  "PaymentAllocation",
  "BankStatement",
  "BankStatementLine",
  "PaymentOrder",
  "PaymentOrderLine",
] as const;
export type TenantModel = (typeof TENANT_MODELS)[number];

const tenantModels = new Set<string>(TENANT_MODELS);

const WHERE_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "upsert",
]);

export class TenantViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantViolationError";
  }
}

type AnyArgs = Record<string, unknown> & {
  where?: Record<string, unknown>;
  data?: unknown;
  create?: Record<string, unknown>;
  update?: Record<string, unknown>;
};

function assertNoForeignCompany(data: unknown, companyId: string, model: string) {
  const rows = Array.isArray(data) ? data : [data];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if ("company" in r) {
      throw new TenantViolationError(`${model}: kasuta companyDb-s companyId välja, mitte company seost`);
    }
    if ("companyId" in r && r.companyId !== undefined && r.companyId !== companyId) {
      throw new TenantViolationError(`${model}: companyId ei vasta aktiivsele ettevõttele`);
    }
  }
}

/**
 * Lisab tingimuse AND-iga, et kasutaja enda filter (ka võõras companyId) ei kirjutuks üle,
 * vaid annaks tühja tulemuse. Unikaalvõtme päringutes jääb unikaalväli tippu alles.
 */
function andWhere(where: Record<string, unknown> | undefined, condition: Record<string, unknown>) {
  const w = { ...(where ?? {}) };
  const existing = w.AND === undefined ? [] : Array.isArray(w.AND) ? w.AND : [w.AND];
  return { ...w, AND: [...existing, condition] };
}

function withCompanyId(data: unknown, companyId: string): unknown {
  if (Array.isArray(data)) return data.map((row) => ({ ...(row as object), companyId }));
  return { ...(data as object), companyId };
}

/** Puhas funktsioon, mis muudab päringu argumente. Eraldi eksporditud testimiseks. */
export function scopeArgs(model: string, operation: string, rawArgs: unknown, companyId: string): AnyArgs {
  const args: AnyArgs = { ...((rawArgs as AnyArgs | undefined) ?? {}) };

  if (model === "Company") {
    if (operation.startsWith("create") || operation === "upsert" || operation.startsWith("delete")) {
      throw new TenantViolationError("Company: ettevõtte loomine/kustutamine käib süsteemse kliendi kaudu");
    }
    args.where = andWhere(args.where, { id: companyId });
    return args;
  }

  if (!tenantModels.has(model)) {
    throw new TenantViolationError(`${model} ei ole ettevõttepõhine mudel; kasuta süsteemset klienti`);
  }

  if (WHERE_OPERATIONS.has(operation)) {
    args.where = andWhere(args.where, { companyId });
  }

  switch (operation) {
    case "create":
    case "createMany":
    case "createManyAndReturn":
      assertNoForeignCompany(args.data, companyId, model);
      args.data = withCompanyId(args.data, companyId);
      break;
    case "update":
    case "updateMany":
    case "updateManyAndReturn":
      assertNoForeignCompany(args.data, companyId, model);
      break;
    case "upsert":
      assertNoForeignCompany(args.create, companyId, model);
      assertNoForeignCompany(args.update, companyId, model);
      args.create = withCompanyId(args.create, companyId) as Record<string, unknown>;
      break;
  }
  return args;
}

export function scopeToCompany(client: PrismaClient, companyId: string) {
  if (!companyId) throw new TenantViolationError("companyId puudub");
  return client.$extends(
    Prisma.defineExtension({
      name: "company-scope",
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            return query(scopeArgs(model, operation, args, companyId) as typeof args);
          },
        },
      },
    }),
  );
}

export type CompanyDb = ReturnType<typeof scopeToCompany>;
