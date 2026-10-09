"use client";

/**
 * PDF-i tekstikiht ridadena (pdf.js, brauseris). Elemendid rühmitatakse y-koordinaadi järgi
 * ridadeks ja järjestatakse vasakult paremale. Skaneeritud PDF-il teksti pole – tagastab "".
 */
type TextItem = { str: string; transform: number[] };

export async function pdfText(source: string | ArrayBuffer, maxPages = 5): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const task = typeof source === "string" ? pdfjs.getDocument({ url: source, withCredentials: true }) : pdfjs.getDocument({ data: new Uint8Array(source) });
  const doc = await task.promise;
  const out: string[] = [];
  try {
    for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const rows = new Map<number, Array<{ x: number; s: string }>>();
      for (const raw of content.items as unknown[]) {
        const it = raw as TextItem;
        if (typeof it.str !== "string" || !it.str.trim()) continue;
        const y = Math.round(it.transform[5]! / 3) * 3;
        const row = rows.get(y) ?? [];
        row.push({ x: it.transform[4]!, s: it.str });
        rows.set(y, row);
      }
      const lines = [...rows.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([, items]) =>
          items
            .sort((a, b) => a.x - b.x)
            .map((i) => i.s)
            .join(" "),
        );
      out.push(lines.join("\n"));
    }
  } finally {
    await doc.destroy();
  }
  return out.join("\n");
}
