import "server-only";
import type { CompanyContext } from "@/server/session";
import { can, type Module } from "@/lib/permissions";

/**
 * Käsupaleti andmeotsingu register. Iga moodul lisab oma otsinguallika
 * (müügiarved, kliendid, tarnijad, artiklid …). Tulemused on ettevõttega piiratud,
 * sest allikad kasutavad `ctx.cdb`-d.
 */
export type SearchResult = {
  id: string;
  /** i18n võti nimeruumis `palette.kinds` */
  kind: string;
  title: string;
  subtitle?: string;
  /** suhteline ettevõtte juure suhtes */
  href: string;
};

export type SearchProvider = {
  id: string;
  module: Module;
  search: (ctx: CompanyContext, query: string, limit: number) => Promise<SearchResult[]>;
};

const providers: SearchProvider[] = [];

export function registerSearchProvider(provider: SearchProvider) {
  if (!providers.some((p) => p.id === provider.id)) providers.push(provider);
}

export async function searchAll(ctx: CompanyContext, query: string, limit = 5): Promise<SearchResult[]> {
  const allowed = providers.filter((p) => can(ctx.membership, p.module, "view"));
  const results = await Promise.all(allowed.map((p) => p.search(ctx, query, limit).catch(() => [])));
  return results.flat();
}
