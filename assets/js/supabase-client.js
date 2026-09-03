window.PostalApi = (() => {
  function requireConfig() {
    const config = window.POSTAL_CONFIG;
    if (!config?.supabaseUrl || !config?.supabaseAnonKey || config.supabaseAnonKey.startsWith("PASTE_")) {
      throw new Error("尚未設定 Supabase anon key。請依 README 建立 assets/js/config.js。");
    }
    return config;
  }
  async function lookup(values) {
    const config = requireConfig();
    const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/lookup_zipcode_33`, {
      method: "POST",
      headers: { "apikey": config.supabaseAnonKey, "Authorization": `Bearer ${config.supabaseAnonKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_city: values.city, p_district: values.district, p_street: values.street, p_sector: values.sector, p_neighborhood: values.neighborhood, p_lane: values.lane, p_alley: values.alley, p_house_number: values.house, p_house_number_sub: values.houseSub, p_number_type: values.numberType, p_record_type: values.recordType, p_floor: values.floor })
    });
    if (!response.ok) throw new Error(`查詢失敗（${response.status}）`);
    return response.json();
  }
  async function lookupWithFallback(address) {
    const parsed = PostalAddress.parse(address);
    if (!parsed.city && !parsed.district && !parsed.street) return { parsed, rows: [] };
    for (const attempt of PostalAddress.attempts(parsed)) {
      const rows = await lookup(attempt);
      if (rows.length) return { parsed, rows };
    }
    return { parsed, rows: [] };
  }
  return { lookupWithFallback };
})();
