import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { isLocale, LOCALE_COOKIE, negotiateLocale } from "./config";

// Keel ei ole URL-is: see tuleb küpsisest (kasutaja valik) või brauseri eelistusest.
// Selgesõnaline keel (nt `getTranslations({ locale: "en" })` arve PDF-i jaoks kliendi keeles) on eelistatud.
export default getRequestConfig(async ({ locale: explicit }) => {
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(explicit)
    ? explicit
    : isLocale(cookieLocale)
      ? cookieLocale
      : negotiateLocale((await headers()).get("accept-language"));
  return {
    locale,
    timeZone: "Europe/Tallinn",
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
