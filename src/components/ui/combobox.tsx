"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type ComboOption = { value: string; label: string; hint?: string; keywords?: string };

/**
 * Kerge otsinguga valik tabelridade jaoks: käitub nagu tekstiväli, kirjutamine filtreerib,
 * ↑/↓ liigub, Enter/Tab valib esimese (või esiletõstetud) vaste, Esc taastab väärtuse.
 * Koodi algusega vaste on eespool (nt „41“ → 4100, 4110 …).
 */
export const Combobox = React.forwardRef<
  HTMLInputElement,
  {
    options: ComboOption[];
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
    disabled?: boolean;
    "aria-label"?: string;
    "aria-invalid"?: boolean;
    onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
    /** Kutsutakse pärast valikut Enteriga (nt fookuse liigutamiseks järgmisele väljale) */
    onCommit?: () => void;
    noResults?: string;
  }
>(function Combobox(
  { options, value, onChange, placeholder, className, disabled, onKeyDown, onCommit, noResults, ...aria },
  ref,
) {
  const selected = options.find((o) => o.value === value);
  const [text, setText] = React.useState(selected?.label ?? "");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const listId = React.useId();
  const listRef = React.useRef<HTMLUListElement>(null);

  // Väline väärtuse muutus (nt mallist laadimine) uuendab teksti – olekut kohandatakse renderdamisel
  const [shownLabel, setShownLabel] = React.useState(selected?.label);
  if (!open && selected?.label !== shownLabel) {
    setShownLabel(selected?.label);
    setText(selected?.label ?? "");
  }

  const query = text.trim().toLowerCase();
  const filtered = React.useMemo(() => {
    if (!open || !query || query === selected?.label.toLowerCase()) return options.slice(0, 50);
    const starts: ComboOption[] = [];
    const contains: ComboOption[] = [];
    for (const o of options) {
      const label = o.label.toLowerCase();
      if (label.startsWith(query)) starts.push(o);
      else if (label.includes(query) || o.keywords?.toLowerCase().includes(query)) contains.push(o);
      if (starts.length + contains.length >= 50) break;
    }
    return [...starts, ...contains];
  }, [options, query, open, selected?.label]);

  function choose(option: ComboOption | undefined) {
    if (!option) return;
    onChange(option.value);
    setText(option.label);
    setOpen(false);
  }

  React.useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div className={cn("relative", className)}>
      <input
        ref={ref}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        value={text}
        aria-label={aria["aria-label"]}
        aria-invalid={aria["aria-invalid"]}
        className="flex h-8 w-full min-w-0 rounded-md border border-input bg-card px-2.5 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring disabled:opacity-50 aria-invalid:border-destructive"
        onFocus={(e) => {
          e.currentTarget.select();
          setOpen(true);
          setActive(0);
        }}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
          if (e.target.value === "") onChange("");
        }}
        onBlur={() => {
          // Pooliku teksti korral valitakse esimene vaste, tühja korral jääb tühjaks
          if (open && query && query !== selected?.label.toLowerCase()) choose(filtered[0]);
          else setText(selected?.label ?? "");
          setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, filtered.length - 1));
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
            return;
          }
          if (e.key === "Escape" && open) {
            e.preventDefault();
            e.stopPropagation();
            setText(selected?.label ?? "");
            setOpen(false);
            return;
          }
          if (e.key === "Enter" && open) {
            e.preventDefault();
            if (filtered[active] && (query || !selected)) choose(filtered[active]);
            else setOpen(false);
            onCommit?.();
            return;
          }
          if (e.key === "Tab" && open && query && query !== selected?.label.toLowerCase()) {
            choose(filtered[active]);
          }
          onKeyDown?.(e);
        }}
      />
      {open && !disabled && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="absolute top-full left-0 z-40 mt-1 max-h-64 w-full min-w-72 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg"
        >
          {filtered.length === 0 ? (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">{noResults ?? "—"}</li>
          ) : (
            filtered.map((o, i) => (
              <li
                key={o.value}
                id={`${listId}-${i}`}
                data-index={i}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex cursor-pointer items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-sm",
                  i === active && "bg-accent text-accent-foreground",
                  o.value === value && "font-medium",
                )}
              >
                <span className="truncate">{o.label}</span>
                {o.hint && <span className="shrink-0 text-xs text-muted-foreground">{o.hint}</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
});
