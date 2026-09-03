(() => {
  const form = document.querySelector("#address-form");
  const input = document.querySelector("#qry_addr");
  const original = document.querySelector("#original-address");
  const status = document.querySelector("#status");
  const result = document.querySelector("#zip33-results");
  const count = document.querySelector("#zip33-count");
  const queryAddress = new URLSearchParams(location.search).get("qry_addr") ?? "";
  function redirect(value) {
    const target = location.pathname.includes("/prog1/") ? "./?" : "./prog1/?";
    location.assign(`${target}qry_addr=${encodeURIComponent(value.trim())}`);
  }
  function addCell(row, value) { const cell = document.createElement("td"); cell.textContent = value ?? ""; row.append(cell); }
  function render(rows) {
    result.replaceChildren(); count.textContent = String(rows.length);
    for (const item of rows) {
      const tr = document.createElement("tr");
      addCell(tr, item.zip_code); addCell(tr, item.city_name); addCell(tr, item.district_name);
      addCell(tr, `${item.street_name ?? ""}${item.sector && item.sector !== "0" ? `${item.sector}段` : ""}`);
      addCell(tr, item.source_detail); result.append(tr);
    }
  }
  form?.addEventListener("submit", (event) => { event.preventDefault(); if (input.value.trim()) redirect(input.value); });
  if (!queryAddress) return;
  input.value = queryAddress; original.textContent = queryAddress; status.textContent = "查詢中…";
  PostalApi.lookupWithFallback(queryAddress).then(({ rows }) => {
    render(rows); status.textContent = rows.length ? "" : "查無符合的 3+3 郵遞區號，請補足縣市、行政區、路名或門牌。";
  }).catch((error) => { status.textContent = error.message; });
})();
