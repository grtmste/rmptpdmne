import "server-only";
import { Resend } from "resend";

type Mail = { to: string; subject: string; text: string; html: string };

/**
 * E-kirjade saatmine. Kui RESEND_API_KEY puudub (arendus, testid), kirjutatakse kiri
 * serveri logisse ja salvestatakse mällu (`sentMail`), et E2E testid saaksid lingi kätte.
 */
export const sentMail: Mail[] = [];

async function send(mail: Mail) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    sentMail.push(mail);
    if (sentMail.length > 50) sentMail.shift();
    console.info(`\n[e-post] Saaja: ${mail.to}\n[e-post] Teema: ${mail.subject}\n${mail.text}\n`);
    return;
  }
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: process.env.EMAIL_FROM ?? "LILY SOKID <noreply@example.com>",
    ...mail,
  });
  if (error) throw new Error(`E-kirja saatmine ebaõnnestus: ${error.message}`);
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function layout(title: string, body: string, buttonText: string, url: string) {
  return `<!doctype html><html><body style="margin:0;background:#f5f4f0;font-family:Inter,Arial,sans-serif;color:#1c1917">
<div style="max-width:480px;margin:32px auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e7e5e4">
<div style="font-weight:700;letter-spacing:.04em;color:#0f5c55;margin-bottom:24px">LILY SOKID</div>
<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(title)}</h1>
<p style="line-height:1.6;margin:0 0 24px">${body}</p>
<a href="${escapeHtml(url)}" style="display:inline-block;background:#0f5c55;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${escapeHtml(buttonText)}</a>
<p style="font-size:12px;color:#78716c;margin-top:24px;word-break:break-all">${escapeHtml(url)}</p>
</div></body></html>`;
}

export async function sendMagicLink(to: string, url: string) {
  await send({
    to,
    subject: "Sisselogimise link – LILY SOKID",
    text: `Logi sisse sellel lingil (kehtib 15 minutit):\n${url}\n\nKui sa ei küsinud linki, jäta see kiri tähelepanuta.`,
    html: layout(
      "Sinu sisselogimise link",
      "Vajuta nupule, et sisse logida. Link kehtib 15 minutit ja töötab ühe korra. Kui sa linki ei küsinud, võid selle kirja kustutada.",
      "Logi sisse",
      url,
    ),
  });
}

export async function sendInvitationEmail(to: string, url: string, companyName: string, inviterName: string) {
  await send({
    to,
    subject: `Kutse ettevõttesse ${companyName} – LILY SOKID`,
    text: `${inviterName} kutsus sind ettevõtte ${companyName} raamatupidamisse.\nKutse vastuvõtmiseks ava link (kehtib 7 päeva):\n${url}`,
    html: layout(
      `Kutse: ${companyName}`,
      `${escapeHtml(inviterName)} kutsus sind ettevõtte <b>${escapeHtml(companyName)}</b> raamatupidamisse. Kutse kehtib 7 päeva.`,
      "Võta kutse vastu",
      url,
    ),
  });
}
