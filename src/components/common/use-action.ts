"use client";

import { useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/action";

type Failure = Extract<ActionResult<unknown>, { ok: false }>;

/**
 * Server Actioni käivitamine kliendis: ootamise olek, tõlgitud veateade (koos muutujatega,
 * nt rea number), eduteade ja lehe värskendamine.
 */
export function useActionRunner() {
  const te = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const message = useCallback(
    (res: Failure) => (te.has(res.error) ? te(res.error, res.errorParams ?? {}) : te("unexpected")),
    [te],
  );

  const run = useCallback(
    <T>(
      fn: () => Promise<ActionResult<T>>,
      opts: {
        success?: string;
        refresh?: boolean;
        onSuccess?: (data: T) => void;
        onError?: (res: Failure, message: string) => void;
      } = {},
    ) => {
      startTransition(async () => {
        const res = await fn();
        if (!res.ok) {
          const text = message(res);
          if (opts.onError) opts.onError(res, text);
          else toast.error(text);
          return;
        }
        if (opts.success) toast.success(opts.success);
        opts.onSuccess?.(res.data);
        if (opts.refresh !== false) router.refresh();
      });
    },
    [message, router],
  );

  return { pending, run, message };
}
