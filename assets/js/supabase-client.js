window.PostalApi = (() => {
  function requireConfig() {
    const config = window.POSTAL_CONFIG;
    if (!config?.supabaseUrl || !config?.supabaseAnonKey || config.supabaseAnonKey.startsWith("PASTE_")) {
      throw new Error("尚未設定 Supabase anon key。請依 README 建立 assets/js/config.js。");
    }
    return config;
  }
  async function rpc(name, body, label = "查詢") {
    const config = requireConfig();
    const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { "apikey": config.supabaseAnonKey, "Authorization": `Bearer ${config.supabaseAnonKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      // Rate limiting and other guard rails raise with a message meant for the
      // reader, so prefer it over a bare status code.
      const detail = await response.json().catch(() => null);
      throw new Error(detail?.message ?? `${label}失敗（${response.status}）`);
    }
    return response.json();
  }
  function lookup(values) {
    return rpc("lookup_zipcode_33", { p_city: values.city, p_district: values.district, p_street: values.street, p_sector: values.sector, p_neighborhood: values.neighborhood, p_lane: values.lane, p_alley: values.alley, p_house_number: values.house, p_house_number_sub: values.houseSub, p_number_type: values.numberType, p_record_type: values.recordType, p_floor: values.floor });
  }
  function lookupStreet(values) {
    return rpc("lookup_zipcode_street", { p_city: values.city, p_district: values.district, p_street: values.street, p_sector: values.sector });
  }
  async function lookupWithFallback(address) {
    const parsed = PostalAddress.parse(address);
    if (!parsed.city && !parsed.district && !parsed.street) return { parsed, rows: [] };
    if (parsed.house === -1 && parsed.city && parsed.district && parsed.street) {
      const rows = await lookupStreet(parsed);
      if (rows.length || !parsed.streetFallback || parsed.streetFallback === parsed.street) return { parsed, rows };
      return { parsed, rows: await lookupStreet({ ...parsed, street: parsed.streetFallback }) };
    }
    for (const attempt of PostalAddress.attempts(parsed)) {
      const rows = await lookup(attempt);
      if (rows.length) return { parsed, rows };
    }
    return { parsed, rows: [] };
  }
  return { lookupWithFallback, rpc };
})();
