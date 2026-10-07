import { describe, expect, it } from "vitest";
import { migrationDatabaseUrl, runtimeDatabaseUrl } from "@/lib/database-url";

describe("andmebaasi aadress", () => {
  it("rakendus eelistab pooled, migratsioonid otseühendust", () => {
    const env = { DATABASE_URL: "pooled", DATABASE_URL_UNPOOLED: "direct" };
    expect(runtimeDatabaseUrl(env)).toBe("pooled");
    expect(migrationDatabaseUrl(env)).toBe("direct");
  });
  it("leiab Verceli Postgres nimed ja eesliitega muutujad", () => {
    expect(runtimeDatabaseUrl({ POSTGRES_PRISMA_URL: "p" })).toBe("p");
    expect(runtimeDatabaseUrl({ STORAGE_DATABASE_URL: "s" })).toBe("s");
    expect(migrationDatabaseUrl({ STORAGE_DATABASE_URL_UNPOOLED: "d", STORAGE_DATABASE_URL: "s" })).toBe("d");
  });
  it("tagastab undefined, kui midagi pole", () => {
    expect(runtimeDatabaseUrl({})).toBeUndefined();
    expect(runtimeDatabaseUrl({ TEST_DATABASE_URL: "t" })).toBeUndefined();
  });
});
