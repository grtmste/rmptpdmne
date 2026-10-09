import "server-only";
import path from "node:path";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

/**
 * Maksemeeldetuletuse ja saldoteatise PDF: kliendi tasumata arved seisuga, kokkuvõte ja
 * saldoteatise korral kinnitusosa. Andmed tulevad valmis vormindatuna kliendi keeles.
 */

const FONT_DIR = path.join(process.cwd(), "src/server/pdf/fonts");
let fontsRegistered = false;
function registerFonts() {
  if (fontsRegistered) return;
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

export type StatementPdfData = {
  title: string;
  accent: string;
  company: { name: string; address: string | null; regCode: string | null; email: string | null; phone: string | null; bankDetails: string | null };
  customer: { name: string; regCode: string | null; address: string | null };
  meta: Array<[string, string]>;
  intro: string;
  rows: Array<{ number: string; date: string; dueDate: string; total: string; open: string; overdue: string }>;
  totals: Array<[string, string]>;
  payable: [string, string];
  /** Saldoteatise kinnitusosa */
  confirmation: { text: string; agree: string; disagree: string; signature: string } | null;
  labels: { buyer: string; regCode: string; number: string; date: string; dueDate: string; total: string; open: string; overdue: string; bank: string; page: string };
};

const s = StyleSheet.create({
  page: { fontFamily: "Noto Sans", fontSize: 9, color: "#1c1917", paddingBottom: 64, paddingHorizontal: 40 },
  band: { height: 6, marginHorizontal: -40, marginBottom: 28 },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 22 },
  companyName: { fontSize: 15, fontWeight: 700 },
  muted: { color: "#78716c" },
  title: { fontSize: 17, fontWeight: 700, letterSpacing: 0.5, textAlign: "right" },
  parties: { flexDirection: "row", gap: 24, marginBottom: 16 },
  label: { fontSize: 7, textTransform: "uppercase", letterSpacing: 1, color: "#78716c", marginBottom: 4 },
  partyName: { fontSize: 11, fontWeight: 700, marginBottom: 2 },
  metaBox: { flex: 1, borderRadius: 6, backgroundColor: "#f5f4f0", padding: 10 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  intro: { marginBottom: 14, lineHeight: 1.5 },
  th: { flexDirection: "row", borderBottomWidth: 1, paddingBottom: 4, marginBottom: 2 },
  thText: { fontSize: 7.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "#57534e" },
  tr: { flexDirection: "row", paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: "#e7e5e4" },
  cNo: { flex: 1 },
  cDate: { width: 70 },
  cNum: { width: 78, textAlign: "right" },
  cOver: { width: 60, textAlign: "right" },
  totals: { width: 240, alignSelf: "flex-end", marginTop: 12 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  payable: { flexDirection: "row", justifyContent: "space-between", borderRadius: 6, paddingVertical: 7, paddingHorizontal: 10, marginTop: 6 },
  payableText: { color: "#ffffff", fontWeight: 700, fontSize: 11 },
  confirm: { marginTop: 28, borderWidth: 0.5, borderColor: "#d6d3d1", borderRadius: 6, padding: 12, gap: 8 },
  box: { flexDirection: "row", gap: 6, alignItems: "center" },
  check: { width: 9, height: 9, borderWidth: 0.8, borderColor: "#57534e" },
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

function StatementDocument({ data }: { data: StatementPdfData }) {
  const l = data.labels;
  const c = data.company;
  return (
    <Document title={`${data.title} – ${data.customer.name}`} author={c.name} creator="LILY SOKID" producer="LILY SOKID">
      <Page size="A4" style={s.page}>
        <View style={[s.band, { backgroundColor: data.accent }]} fixed />
        <View style={s.header}>
          <View>
            <Text style={s.companyName}>{c.name}</Text>
            {c.address && <Text style={s.muted}>{c.address}</Text>}
          </View>
          <Text style={[s.title, { color: data.accent }]}>{data.title}</Text>
        </View>
        <View style={s.parties}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>{l.buyer}</Text>
            <Text style={s.partyName}>{data.customer.name}</Text>
            {data.customer.address && <Text>{data.customer.address}</Text>}
            {data.customer.regCode && (
              <Text>
                {l.regCode}: {data.customer.regCode}
              </Text>
            )}
          </View>
          <View style={s.metaBox}>
            {data.meta.map(([k, v]) => (
              <View key={k} style={s.metaRow}>
                <Text style={s.muted}>{k}</Text>
                <Text style={{ fontWeight: 700 }}>{v}</Text>
              </View>
            ))}
          </View>
        </View>
        <Text style={s.intro}>{data.intro}</Text>
        <View style={[s.th, { borderBottomColor: data.accent }]} fixed>
          <Text style={[s.thText, s.cNo]}>{l.number}</Text>
          <Text style={[s.thText, s.cDate]}>{l.date}</Text>
          <Text style={[s.thText, s.cDate]}>{l.dueDate}</Text>
          <Text style={[s.thText, s.cNum]}>{l.total}</Text>
          <Text style={[s.thText, s.cNum]}>{l.open}</Text>
          <Text style={[s.thText, s.cOver]}>{l.overdue}</Text>
        </View>
        {data.rows.map((r, i) => (
          <View key={i} style={s.tr} wrap={false}>
            <Text style={s.cNo}>{r.number}</Text>
            <Text style={s.cDate}>{r.date}</Text>
            <Text style={s.cDate}>{r.dueDate}</Text>
            <Text style={s.cNum}>{r.total}</Text>
            <Text style={[s.cNum, { fontWeight: 700 }]}>{r.open}</Text>
            <Text style={s.cOver}>{r.overdue}</Text>
          </View>
        ))}
        <View style={s.totals} wrap={false}>
          {data.totals.map(([k, v]) => (
            <View key={k} style={s.totalRow}>
              <Text>{k}</Text>
              <Text>{v}</Text>
            </View>
          ))}
          <View style={[s.payable, { backgroundColor: data.accent }]}>
            <Text style={s.payableText}>{data.payable[0]}</Text>
            <Text style={s.payableText}>{data.payable[1]}</Text>
          </View>
        </View>
        {data.confirmation && (
          <View style={s.confirm} wrap={false}>
            <Text>{data.confirmation.text}</Text>
            <View style={s.box}>
              <View style={s.check} />
              <Text>{data.confirmation.agree}</Text>
            </View>
            <View style={s.box}>
              <View style={s.check} />
              <Text>{data.confirmation.disagree}</Text>
            </View>
            <Text style={{ marginTop: 14, color: "#78716c" }}>{data.confirmation.signature} ______________________________</Text>
          </View>
        )}
        <View style={s.footer} fixed>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: 700 }}>{c.name}</Text>
            {c.regCode && (
              <Text>
                {l.regCode}: {c.regCode}
              </Text>
            )}
          </View>
          <View style={{ flex: 1 }}>
            {c.phone && <Text>{c.phone}</Text>}
            {c.email && <Text>{c.email}</Text>}
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
      </Page>
    </Document>
  );
}

export async function renderStatementPdf(data: StatementPdfData): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<StatementDocument data={data} />);
}
