// LINE Messaging API webhook for the zipcode bot.  A text message is treated
// as an address and answered with its 3+3 code, using the same
// _shared/zipcode.ts lookup as the public API -- so the bot and the API can
// never give different answers for the same address.
//
// Two secrets are required:
//   supabase secrets set LINE_CHANNEL_SECRET=... LINE_CHANNEL_ACCESS_TOKEN=...
import { logCall, lookupZipcode, takeToken, type LookupRow, type Outcome } from "../_shared/zipcode.ts";

type LineEvent = {
  type?: string;
  replyToken?: string;
  message?: { type?: string; text?: string };
  source?: { userId?: string; groupId?: string; roomId?: string };
};

const windows = new Map<string, { startedAt: number; count: number }>();
const LIMIT_PER_WINDOW = 20;
const MAX_ROWS = 5;
const WEB_QUERY = "https://ck2008.github.io/gh_zipcode/prog1/?qry_addr=";
const HELP = "傳一個台灣地址給我，我回你 3+3 郵遞區號。\n例如：台北市信義區信義路五段7號";
const encoder = new TextEncoder();

function constantTimeEquals(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// The signature covers the raw request body, so it has to be checked against
// the exact bytes LINE sent -- never against a re-serialised JSON object.
async function signatureMatches(body: string, signature: string) {
  const secret = Deno.env.get("LINE_CHANNEL_SECRET") ?? "";
  if (!secret || !signature) return false;
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return constantTimeEquals(btoa(String.fromCharCode(...new Uint8Array(mac))), signature);
}

async function reply(replyToken: string, text: string) {
  const token = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") ?? "";
  if (!token) {
    console.error("LINE_CHANNEL_ACCESS_TOKEN is not set");
    return;
  }
  const response = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text: text.slice(0, 4900) }] }),
  });
  if (!response.ok) console.error("line reply failed", response.status, await response.text());
}

function rangeLabel(row: LookupRow) {
  const street = `${row.street_name ?? ""}${row.sector && row.sector !== "0" ? `${row.sector}段` : ""}`;
  return `${row.city_name ?? ""}${row.district_name ?? ""}${street} ${row.source_detail ?? ""}`.trimEnd();
}

function replyText(adrs: string, outcome: Outcome) {
  if (typeof outcome.body.error === "string") {
    return outcome.status === 400 ? `${outcome.body.error}\n\n${HELP}` : outcome.body.error;
  }
  const rows = (outcome.body.results ?? []) as LookupRow[];
  if (!rows.length) {
    return `查不到「${adrs}」的 3+3 郵遞區號。\n請補上縣市、行政區、路名或門牌再試一次。\n\n${HELP}`;
  }
  // A lookup can hit several ranges that all cover the same door number, and
  // the rows come back ordered by code -- not by how specific they are.  So a
  // lone row is stated as the answer, and anything more is offered as
  // candidates to read against the door number rather than picking one and
  // sounding certain about it.
  if (rows.length === 1) {
    return `${adrs}\n郵遞區號：${rows[0].zip_code}\n（${rangeLabel(rows[0])}）`;
  }
  const lines = [adrs, `命中 ${rows.length} 組，請依門牌對照：`];
  for (const row of rows.slice(0, MAX_ROWS)) {
    lines.push(`${row.zip_code}　${rangeLabel(row)}`);
  }
  if (rows.length > MAX_ROWS) {
    lines.push(`…其餘 ${rows.length - MAX_ROWS} 筆請看網頁：${WEB_QUERY}${encodeURIComponent(adrs)}`);
  }
  return lines.join("\n");
}

async function handleEvent(event: LineEvent, userAgent: string) {
  const replyToken = event.replyToken ?? "";
  if (!replyToken) return;
  if (event.type === "follow" || event.type === "join") return await reply(replyToken, HELP);
  if (event.type !== "message") return;
  if (event.message?.type !== "text") return await reply(replyToken, HELP);
  const adrs = event.message.text?.trim() ?? "";
  if (!adrs) return await reply(replyToken, HELP);
  // Limit per LINE sender rather than per IP: every event arrives from LINE's
  // own servers, so an IP bucket would put all users in one bucket.
  const sender = event.source?.userId ?? event.source?.groupId ?? event.source?.roomId ?? "unknown";
  if (!takeToken(windows, sender, LIMIT_PER_WINDOW)) {
    return await reply(replyToken, "查詢太頻繁，請稍後再試。");
  }
  const startedAt = Date.now();
  const outcome = await lookupZipcode(adrs);
  await logCall({ ip: "line", adrs, userAgent }, outcome, Date.now() - startedAt);
  await reply(replyToken, replyText(adrs, outcome));
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("只支援 POST", { status: 405 });
  const body = await request.text();
  if (!await signatureMatches(body, request.headers.get("x-line-signature") ?? "")) {
    return new Response("bad signature", { status: 401 });
  }
  let events: LineEvent[] = [];
  try {
    events = JSON.parse(body).events ?? [];
  } catch (_) {
    events = [];
  }
  const userAgent = request.headers.get("user-agent") ?? "";
  // One failed event must not sink the others, and the response body is never
  // read by LINE: the console's Verify button posts an empty events array and
  // only wants a 200 back.
  await Promise.all(events.map((event) =>
    handleEvent(event, userAgent).catch((error) => console.error("event failed", error))
  ));
  return new Response("ok", { status: 200 });
});
