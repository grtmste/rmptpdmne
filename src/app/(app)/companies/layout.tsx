import Link from "next/link";
import { BrandWordmark } from "@/components/brand";
import { LocaleSwitcher } from "@/components/shell/locale-switcher";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { LogoutButton } from "./logout-button";

/** Ettevõtteülene vaade (ettevõtete valik ja lisamine) ilma külgmenüüta. */
export default function CompaniesLayout({ children }: LayoutProps<"/companies">) {
  return (
    <div className="min-h-screen">
      <header className="flex h-14 items-center justify-between border-b bg-card px-4 md:px-8">
        <Link href="/">
          <BrandWordmark />
        </Link>
        <div className="flex items-center gap-1">
          <LocaleSwitcher />
          <ThemeToggle />
          <LogoutButton />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 md:px-8">{children}</main>
    </div>
  );
}
