import { NextResponse, type NextRequest } from "next/server";
import { todayLocal } from "@/lib/dates";
import { runDeadlineNotifications, runRecurringJob } from "@/server/jobs/daily";

export const maxDuration = 300;

/**
 * Vercel Cron: GET /api/cron/daily (vt vercel.json). Vercel saadab päise
 * `Authorization: Bearer $CRON_SECRET`; tootmises ilma saladuseta tööd ei käivitata.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if (request.headers.get("authorization") !== `Bearer ${secret}`) return new NextResponse("Unauthorized", { status: 401 });
  } else if (process.env.NODE_ENV === "production") {
    return new NextResponse("CRON_SECRET puudub", { status: 503 });
  }
  const today = todayLocal();
  const recurring = await runRecurringJob(today);
  const deadlines = await runDeadlineNotifications(today);
  return NextResponse.json({ ok: true, date: today.toISOString().slice(0, 10), recurring, deadlines });
}
