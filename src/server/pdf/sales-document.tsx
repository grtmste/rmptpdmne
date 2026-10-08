import "server-only";
import path from "node:path";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

/**
 * Müügiarve, kreeditarve, ettemaksuarve ja pakkumise PDF. Andmed tulevad valmis
 * vormindatuna (summad, kuupäevad, tõlgitud sildid dokumendi keeles), nii et mall ei arvuta.
 */

const FONT_DIR = path.join(process.cwd(), "src/server/pdf/fonts");
let fontsRegistered = false;
function registerFonts() {
  if (fontsRegistered) return;
  // Noto Sans: ladina, eesti, soome ja kirillitsa tähed (vene keelsed arved)
  Font.register({
    family: "Noto Sans",
    fonts: [
      { src: path.join(FONT_DIR, "NotoSans-Regular.ttf"), fontWeight: 400 },
      { src: path.join(FONT_DIR, "NotoSans-Bold.ttf"), fontWeight: 700 },
    ],
  });
  Font.registerHyphenationCallback((word) => [word]);
  fontsRegistered = true;
}

export type PdfLine = {
  code: string | null;
  description: string;
  quantity: string;
  unit: string | null;
  unitPrice: string;
  discount: string | null;
  vat: string;
  amount: string;
};

export type PdfDocumentData = {
  title: string;
  number: string;
  accent: string;
  company: {
    name: string;
    regCode: string | null;
    vatNumber: string | null;
    address: string | null;
    email: string | null;
    phone: string | null;
    website: string | null;
    bankDetails: string | null;
    footer: string | null;
  };
  customer: { name: string; regCode: string | null; vatNumber: string | null; address: string | null };
  /** Silt–väärtus paarid päises (kuupäev, maksetähtaeg, viitenumber …) */
  meta: Array<[string, string]>;
  lines: PdfLine[];
  showDiscount: boolean;
  vatSummary: Array<[string, string]>;
  totals: Array<[string, string]>;
  payable: [string, string];
  notes: string[];
  labels: {
    seller: string;
    buyer: string;
    regCode: string;
    vatNumber: string;
    code: string;
    description: string;
    quantity: string;
    unit: string;
    price: string;
    discount: string;
    vat: string;
    amount: string;
    bank: string;
    page: string;
  };
};

const styles = StyleSheet.create({
  page: { fontFamily: "Noto Sans", fontSize: 9, color: "#1c1917", paddingTop: 0, paddingBottom: 64, paddingHorizontal: 40 },
  band: { height: 6, marginHorizontal: -40, marginBottom: 28 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 },
  companyName: { fontSize: 15, fontWeight: 700 },
  muted: { color: "#78716c" },
  titleBox: { alignItems: "flex-end" },
  title: { fontSize: 18, fontWeight: 700, letterSpacing: 0.5 },
  number: { fontSize: 11, marginTop: 2 },
  parties: { flexDirection: "row", gap: 24, marginBottom: 20 },
  party: { flex: 1 },
  partyLabel: { fontSize: 7, textTransform: "uppercase", letterSpacing: 1, color: "#78716c", marginBottom: 4 },
  partyName: { fontSize: 11, fontWeight: 700, marginBottom: 2 },
  metaBox: { flex: 1, borderRadius: 6, backgroundColor: "#f5f4f0", padding: 10 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  table: { marginTop: 4 },
  th: { flexDirection: "row", borderBottomWidth: 1, paddingBottom: 4, marginBottom: 2 },
  thText: { fontSize: 7.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "#57534e" },
  tr: { flexDirection: "row", paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: "#e7e5e4" },
  cCode: { width: 50 },
  cDesc: { flex: 1, paddingRight: 6 },
  cQty: { width: 42, textAlign: "right" },
  cUnit: { width: 34, paddingLeft: 4 },
  cPrice: { width: 58, textAlign: "right" },
  cDisc: { width: 36, textAlign: "right" },
  cVat: { width: 34, textAlign: "right" },
  cAmount: { width: 66, textAlign: "right" },
  summary: { flexDirection: "row", justifyContent: "space-between", marginTop: 14, gap: 24 },
  vatTable: { width: 200 },
  totals: { width: 220 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  payable: { flexDirection: "row", justifyContent: "space-between", borderRadius: 6, paddingVertical: 7, paddingHorizontal: 10, marginTop: 6 },
  payableText: { color: "#ffffff", fontWeight: 700, fontSize: 11 },
  notes: { marginTop: 18, gap: 4 },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    borderTopWidth: 0.5,
    borderTopColor: "#d6d3d1",
    paddingTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7.5,
    color: "#57534e",
    gap: 12,
  },
});

function SalesDocument({ data }: { data: PdfDocumentData }) {
  const l = data.labels;
  const c = data.company;
  return (
    <Document title={`${data.title} ${data.number}`} author={c.name} creator="LILY SOKID" producer="LILY SOKID">
      <Page size="A4" style={styles.page}>
        <View style={[styles.band, { backgroundColor: data.accent }]} fixed />
        <View style={styles.header}>
          <View>
            <Text style={styles.companyName}>{c.name}</Text>
            {c.address && <Text style={styles.muted}>{c.address}</Text>}
          </View>
          <View style={styles.titleBox}>
            <Text style={[styles.title, { color: data.accent }]}>{data.title}</Text>
            <Text style={styles.number}>{data.number}</Text>
          </View>
        </View>

        <View style={styles.parties}>
          <View style={styles.party}>
            <Text style={styles.partyLabel}>{l.buyer}</Text>
            <Text style={styles.partyName}>{data.customer.name}</Text>
            {data.customer.address && <Text>{data.customer.address}</Text>}
            {data.customer.regCode && (
              <Text>
                {l.regCode}: {data.customer.regCode}
              </Text>
            )}
            {data.customer.vatNumber && (
              <Text>
                {l.vatNumber}: {data.customer.vatNumber}
              </Text>
            )}
          </View>
          <View style={styles.metaBox}>
            {data.meta.map(([k, v]) => (
              <View key={k} style={styles.metaRow}>
                <Text style={styles.muted}>{k}</Text>
                <Text style={{ fontWeight: 700 }}>{v}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.table}>
          <View style={[styles.th, { borderBottomColor: data.accent }]} fixed>
            <Text style={[styles.thText, styles.cCode]}>{l.code}</Text>
            <Text style={[styles.thText, styles.cDesc]}>{l.description}</Text>
            <Text style={[styles.thText, styles.cQty]}>{l.quantity}</Text>
            <Text style={[styles.thText, styles.cUnit]}>{l.unit}</Text>
            <Text style={[styles.thText, styles.cPrice]}>{l.price}</Text>
            {data.showDiscount && <Text style={[styles.thText, styles.cDisc]}>{l.discount}</Text>}
            <Text style={[styles.thText, styles.cVat]}>{l.vat}</Text>
            <Text style={[styles.thText, styles.cAmount]}>{l.amount}</Text>
          </View>
          {data.lines.map((line, i) => (
            <View key={i} style={styles.tr} wrap={false}>
              <Text style={[styles.cCode, styles.muted]}>{line.code ?? ""}</Text>
              <Text style={styles.cDesc}>{line.description}</Text>
              <Text style={styles.cQty}>{line.quantity}</Text>
              <Text style={styles.cUnit}>{line.unit ?? ""}</Text>
              <Text style={styles.cPrice}>{line.unitPrice}</Text>
              {data.showDiscount && <Text style={styles.cDisc}>{line.discount ?? ""}</Text>}
              <Text style={styles.cVat}>{line.vat}</Text>
              <Text style={styles.cAmount}>{line.amount}</Text>
            </View>
          ))}
        </View>

        <View style={styles.summary} wrap={false}>
          <View style={styles.vatTable}>
            {data.vatSummary.map(([k, v]) => (
              <View key={k} style={styles.totalRow}>
                <Text style={styles.muted}>{k}</Text>
                <Text>{v}</Text>
              </View>
            ))}
          </View>
          <View style={styles.totals}>
            {data.totals.map(([k, v]) => (
              <View key={k} style={styles.totalRow}>
                <Text>{k}</Text>
                <Text>{v}</Text>
              </View>
            ))}
            <View style={[styles.payable, { backgroundColor: data.accent }]}>
              <Text style={styles.payableText}>{data.payable[0]}</Text>
              <Text style={styles.payableText}>{data.payable[1]}</Text>
            </View>
          </View>
        </View>

        {data.notes.length > 0 && (
          <View style={styles.notes}>
            {data.notes.map((n, i) => (
              <Text key={i}>{n}</Text>
            ))}
          </View>
        )}

        <View style={styles.footer} fixed>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: 700 }}>{c.name}</Text>
            {c.regCode && (
              <Text>
                {l.regCode}: {c.regCode}
              </Text>
            )}
            {c.vatNumber && (
              <Text>
                {l.vatNumber}: {c.vatNumber}
              </Text>
            )}
          </View>
          <View style={{ flex: 1 }}>
            {c.phone && <Text>{c.phone}</Text>}
            {c.email && <Text>{c.email}</Text>}
            {c.website && <Text>{c.website}</Text>}
          </View>
          <View style={{ flex: 1.3 }}>
            {c.bankDetails && (
              <>
                <Text style={{ fontWeight: 700 }}>{l.bank}</Text>
                <Text>{c.bankDetails}</Text>
              </>
            )}
          </View>
          <View style={{ width: 40, alignItems: "flex-end" }}>
            <Text render={({ pageNumber, totalPages }) => `${l.page} ${pageNumber}/${totalPages}`} />
          </View>
        </View>
        {c.footer && (
          <Text style={{ position: "absolute", bottom: 10, left: 40, right: 40, fontSize: 7, color: "#a8a29e", textAlign: "center" }} fixed>
            {c.footer}
          </Text>
        )}
      </Page>
    </Document>
  );
}

export async function renderSalesDocumentPdf(data: PdfDocumentData): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<SalesDocument data={data} />);
}
