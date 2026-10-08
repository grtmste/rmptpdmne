import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Kõik vaated on kasutaja- ja ettevõttepõhised, seega renderdame dünaamiliselt
  // ega kasuta Cache Components režiimi.
  serverExternalPackages: ["@node-rs/argon2"],
  // PDF-i fondid loetakse failist – need peavad jõudma ka Verceli serverless-funktsioonidesse.
  outputFileTracingIncludes: {
    "/**": ["./src/server/pdf/fonts/*.ttf"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withNextIntl(nextConfig);
