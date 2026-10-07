import { requireUser } from "@/server/session";

/** Kõik siinsed vaated nõuavad sisselogimist. */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  await requireUser();
  return children;
}
