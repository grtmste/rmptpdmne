"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Pencil, Tags, Trash2, X } from "lucide-react";
import type { ActionResult } from "@/lib/action";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useActionRunner } from "./use-action";

export type GroupRow = { id: string; name: string; count: number };

/** Gruppide (kliendi-, artikli-, hiljem tarnijagrupid) lihtne haldus dialoogis. */
export function GroupsDialog({
  title,
  groups,
  canEdit,
  save,
  remove,
}: {
  title: string;
  groups: GroupRow[];
  canEdit: boolean;
  save: (input: { id?: string; name: string }) => Promise<ActionResult<unknown>>;
  remove: (input: { id: string }) => Promise<ActionResult<unknown>>;
}) {
  const t = useTranslations("groups");
  const tc = useTranslations("common");
  const { pending, run } = useActionRunner();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Tags /> {title}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc("close")} aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3 pb-6">
          {groups.length === 0 && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
          <ul className="divide-y rounded-lg border">
            {groups.map((g) => (
              <li key={g.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                {editing?.id === g.id ? (
                  <form
                    className="flex flex-1 items-center gap-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(() => save({ id: g.id, name: editing.name }), { onSuccess: () => setEditing(null) });
                    }}
                  >
                    <Input className="h-8" value={editing.name} onChange={(e) => setEditing({ id: g.id, name: e.target.value })} autoFocus aria-label={t("name")} />
                    <Button type="submit" size="icon-sm" variant="ghost" aria-label={tc("save")} disabled={pending}>
                      <Check />
                    </Button>
                    <Button type="button" size="icon-sm" variant="ghost" aria-label={tc("cancel")} onClick={() => setEditing(null)}>
                      <X />
                    </Button>
                  </form>
                ) : (
                  <>
                    <span className="flex-1">{g.name}</span>
                    <span className="text-xs text-muted-foreground">{t("count", { count: g.count })}</span>
                    {canEdit && (
                      <>
                        <Button size="icon-sm" variant="ghost" aria-label={t("rename", { name: g.name })} onClick={() => setEditing({ id: g.id, name: g.name })}>
                          <Pencil />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t("delete", { name: g.name })}
                          disabled={pending}
                          onClick={() => confirm(t("deleteConfirm", { name: g.name })) && run(() => remove({ id: g.id }))}
                        >
                          <Trash2 />
                        </Button>
                      </>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
          {canEdit && (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => save({ name }), { onSuccess: () => setName("") });
              }}
            >
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("newPlaceholder")} aria-label={t("name")} />
              <Button type="submit" disabled={pending || !name.trim()}>
                {t("add")}
              </Button>
            </form>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
