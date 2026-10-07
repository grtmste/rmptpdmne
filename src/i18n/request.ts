import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { isLocale, LOCALE_COOKIE, negotiateLocale } from "./config";

// Keel ei ole URL-is: see tuleb küpsisest (kasutaja valik) või brauseri eelistusest.
export default getRequestConfig(async () => {
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookieLocale) ? cookieLocale : negotiateLocale((await headers()).get("accept-language"));
  return {
    locale,
    timeZone: "Europe/Tallinn",
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
