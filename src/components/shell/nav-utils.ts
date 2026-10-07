import { findNavItem } from "@/lib/navigation";

/** Aktiivne vaade ja grupp praeguse URL-i järgi. */
export function activeNav(pathname: string, basePath: string): { itemId: string | null; groupId: string } {
  const rel = pathname.startsWith(basePath) ? pathname.slice(basePath.length) : pathname;
  if (rel === "" || rel === "/") return { itemId: null, groupId: "dashboard" };
  const item = findNavItem(rel);
  return { itemId: item?.id ?? null, groupId: item?.group.id ?? "" };
}
