import { getTranslations } from "next-intl/server";
import { BrandMark, BrandWordmark } from "@/components/brand";
import { LocaleSwitcher } from "@/components/shell/locale-switcher";
import { ThemeToggle } from "@/components/shell/theme-toggle";

export default async function AuthLayout({ children }: LayoutProps<"/">) {
  const t = await getTranslations("auth");
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_minmax(0,560px)]">
      <aside className="relative hidden overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex lg:flex-col lg:justify-between">
        <BrandWordmark className="text-white" />
        <div className="relative z-10 max-w-md space-y-4">
          <h2 className="text-3xl leading-tight font-semibold text-white">{t("heroTitle")}</h2>
          <p className="text-sidebar-muted">{t("heroBody")}</p>
          <ul className="space-y-2 pt-2 text-sm">
            {(["heroPoint1", "heroPoint2", "heroPoint3"] as const).map((k) => (
              <li key={k} className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-sidebar-primary" aria-hidden />
                {t(k)}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-sidebar-muted">© {new Date().getFullYear()} LILY SOKID</p>
        {/* Dekoratiivne ruudustik (oma illustratsioon) */}
        <svg className="pointer-events-none absolute -right-24 -bottom-24 size-[520px] opacity-[0.12]" viewBox="0 0 200 200" aria-hidden>
          {Array.from({ length: 10 }).map((_, i) => (
            <rect key={i} x={10 + i * 9} y={10 + i * 9} width={180 - i * 18} height={180 - i * 18} rx={24 - i * 2} fill="none" stroke="#5ed3c1" strokeWidth="1" />
          ))}
        </svg>
      </aside>
      <main className="flex flex-col">
        <div className="flex items-center justify-between p-4 sm:p-6">
          <span className="lg:invisible">
            <BrandMark />
          </span>
          <div className="flex items-center gap-1">
            <LocaleSwitcher />
            <ThemeToggle />
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center px-4 pb-16 sm:px-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </main>
    </div>
  );
}
