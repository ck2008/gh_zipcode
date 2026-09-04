import { Converter } from "npm:opencc-js@1.0.5";
import { createClient } from "jsr:@supabase/supabase-js@2";

type ParsedAddress = {
  input: string;
  city: string;
  district: string;
  street: string;
  streetFallback: string;
  sector: string;
  neighborhood: number;
  lane: string;
  alley: number;
  house: number;
  houseSub: number;
  floor: number;
  numberType: number;
};

const toTraditional = Converter({ from: "cn", to: "tw" });
const windows = new Map<string, { startedAt: number; count: number }>();
const WINDOW_MS = 60_000;
const LIMIT_PER_WINDOW = 30;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "public, max-age=300",
};

const cityAliases: Record<string, string> = {
  "台北市": "臺北市", "北市": "臺北市", "台中市": "臺中市", "中市": "臺中市",
  "台南市": "臺南市", "南市": "臺南市", "台東縣": "臺東縣", "台東": "臺東縣",
};
const digitMap: Record<string, number> = {
  "零": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9,
  "壹": 1, "貳": 2, "參": 3, "肆": 4, "伍": 5, "陸": 6, "柒": 7, "捌": 8, "玖": 9,
};

function intValue(value: string | undefined) {
  return value === undefined ? -1 : Number(value);
}

function normalize(value: string) {
  return toTraditional(value).normalize("NFKC").replace(/[　\s]+/g, "").replace(/臺/g, "台");
}

function parseAddress(raw: string): ParsedAddress {
  const input = normalize(raw).replace(/^\d{3,6}(?=[^\d])/, "");
  const cityMatch = input.match(/^(.*?[縣市])/);
  let city = cityMatch?.[1] ?? "";
  let rest = city ? input.slice(city.length) : input;
  city = cityAliases[city] ?? city.replace(/台/g, "臺");
  const districtMatch = rest.match(/^(.*?(?:鄉|鎮|市|區))/);
  const district = districtMatch?.[1] ?? "";
  rest = district ? rest.slice(district.length) : rest;
  const villageMatch = rest.match(/^[^路街道]*?[村里裡]/);
  const streetFallback = villageMatch ? rest.slice(villageMatch[0].length).match(/^(.*(?:大道|路|街|道))/)?.[1] ?? "" : "";
  rest = rest.replace(/^\d+鄰/, "");
  const streetMatch = rest.match(/^(.*(?:大道|路|街|道))/);
  const street = streetMatch?.[1] ?? "";
  rest = street ? rest.slice(street.length) : rest;
  const sectorMatch = rest.match(/^([0-9０-９零一二三四五六七八九壹貳參肆伍陸柒捌玖]+)段/);
  const sectorValue = sectorMatch?.[1];
  const sector = sectorValue ? String(digitMap[sectorValue] ?? Number(sectorValue)) : "";
  rest = sectorMatch ? rest.slice(sectorMatch[0].length) : rest;
  const neighborhood = intValue(rest.match(/(\d+)鄰/)?.[1]);
  const lane = rest.match(/([^弄號樓]+)巷/)?.[1] ?? "-1";
  const alley = intValue(rest.match(/(\d+)弄/)?.[1]);
  const house = intValue(rest.match(/(\d+)號/)?.[1] ?? rest.match(/(\d+)之/)?.[1]);
  const houseSub = intValue(rest.match(/之(\d+)/)?.[1]);
  const floor = intValue(rest.match(/(\d+)樓/)?.[1]);
  return { input, city, district, street, streetFallback, sector, neighborhood, lane, alley, house, houseSub, floor, numberType: house === -1 ? 0 : house % 2 === 0 ? 2 : 1 };
}

function attempts(parsed: ParsedAddress) {
  const baseline = { ...parsed, recordType: 0 };
  const candidates = [
    baseline,
    { ...baseline, floor: -1 },
    { ...baseline, floor: -1, house: -1, numberType: parsed.alley === -1 ? 0 : parsed.alley % 2 === 0 ? 2 : 1, recordType: 3 },
    { ...baseline, floor: -1, house: -1, alley: -1, numberType: !/^\d+$/.test(parsed.lane) ? 0 : Number(parsed.lane) % 2 === 0 ? 2 : 1, recordType: 2 },
    { ...baseline, floor: -1, house: -1, alley: -1, lane: "-1", numberType: 2, recordType: 1 },
    { ...baseline, floor: -1, house: -1, alley: -1, lane: "-1", neighborhood: -1, numberType: 2, recordType: 1 },
  ];
  return parsed.streetFallback && parsed.streetFallback !== parsed.street ? [...candidates, ...candidates.map((candidate) => ({ ...candidate, street: parsed.streetFallback }))] : candidates;
}

function allow(request: Request) {
  const key = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const now = Date.now();
  const current = windows.get(key);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    windows.set(key, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= LIMIT_PER_WINDOW;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

type Outcome = { status: number; body: Record<string, unknown> };

async function handle(request: Request, adrs: string): Promise<Outcome> {
  if (request.method !== "GET") return { status: 405, body: { error: "只支援 GET" } };
  if (!allow(request)) return { status: 429, body: { error: "查詢太頻繁，請稍後再試。" } };
  if (!adrs) return { status: 400, body: { error: "請提供 adrs 參數。" } };
  if (adrs.length > 200) return { status: 400, body: { error: "adrs 最長 200 個字元。" } };

  const parsed = parseAddress(adrs);
  if (!parsed.city && !parsed.district && !parsed.street) return { status: 400, body: { error: "無法辨識地址。" } };
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let rows: Array<Record<string, string>> = [];
  for (const attempt of attempts(parsed)) {
    const { data, error } = await client.rpc("lookup_zipcode_33", {
      p_city: attempt.city, p_district: attempt.district, p_street: attempt.street, p_sector: attempt.sector,
      p_neighborhood: attempt.neighborhood, p_lane: attempt.lane, p_alley: attempt.alley,
      p_house_number: attempt.house, p_house_number_sub: attempt.houseSub, p_number_type: attempt.numberType,
      p_record_type: attempt.recordType, p_floor: attempt.floor,
    });
    if (error) return { status: 500, body: { error: "資料庫查詢失敗。" } };
    if (data?.length) { rows = data; break; }
  }
  if (!rows.length && parsed.city && parsed.district && parsed.street) {
    const { data, error } = await client.rpc("lookup_zipcode_street", {
      p_city: parsed.city, p_district: parsed.district, p_street: parsed.street, p_sector: parsed.sector,
    });
    if (error) return { status: 500, body: { error: "資料庫查詢失敗。" } };
    rows = data ?? [];
  }
  const first = rows[0];
  return {
    status: 200,
    body: { adrs, zipcode6: first?.zip_code ?? "", dataver6: "post_street", results: rows },
  };
}

// Logging must never change what the caller gets back, so every failure here
// is swallowed -- a broken log is not a reason to fail a lookup.
async function logCall(request: Request, adrs: string, outcome: Outcome, ms: number) {
  try {
    const results = outcome.body.results;
    await createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)
      .rpc("api_log_write", {
        p_ip: request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "",
        p_adrs: adrs,
        p_status: outcome.status,
        p_zipcode6: typeof outcome.body.zipcode6 === "string" ? outcome.body.zipcode6 : "",
        p_result_count: Array.isArray(results) ? results.length : 0,
        p_duration_ms: ms,
        p_user_agent: request.headers.get("user-agent") ?? "",
      });
  } catch (_) {
    // ignored on purpose
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const startedAt = Date.now();
  const adrs = new URL(request.url).searchParams.get("adrs")?.trim() ?? "";
  const outcome = await handle(request, adrs);
  await logCall(request, adrs, outcome, Date.now() - startedAt);
  return json(outcome.body, outcome.status);
});
