// Public, key-free 3+3 lookup API.  The parsing and querying live in
// _shared/zipcode.ts, shared with the LINE webhook; what is left here is the
// HTTP shell: CORS, method, rate limit and the call log.
import { logCall, lookupZipcode, takeToken, type Outcome } from "../_shared/zipcode.ts";

const windows = new Map<string, { startedAt: number; count: number }>();
const LIMIT_PER_WINDOW = 30;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "public, max-age=300",
};

function callerIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

async function handle(request: Request, adrs: string): Promise<Outcome> {
  if (request.method !== "GET") return { status: 405, body: { error: "只支援 GET" } };
  if (!takeToken(windows, callerIp(request) || "unknown", LIMIT_PER_WINDOW)) {
    return { status: 429, body: { error: "查詢太頻繁，請稍後再試。" } };
  }
  if (!adrs) return { status: 400, body: { error: "請提供 adrs 參數。" } };
  return await lookupZipcode(adrs);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const startedAt = Date.now();
  const adrs = new URL(request.url).searchParams.get("adrs")?.trim() ?? "";
  const outcome = await handle(request, adrs);
  await logCall(
    { ip: callerIp(request), adrs, userAgent: request.headers.get("user-agent") ?? "" },
    outcome,
    Date.now() - startedAt,
  );
  return json(outcome.body, outcome.status);
});
