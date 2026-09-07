(() => {
  const config = window.POSTAL_CONFIG;
  const signIn = document.querySelector("#sign-in");
  const signOut = document.querySelector("#sign-out");
  const who = document.querySelector("#who");
  const status = document.querySelector("#admin-status");
  const panel = document.querySelector("#admin-panel");
  const rows = document.querySelector("#admin-rows");
  const count = document.querySelector("#admin-count");
  const apiPanel = document.querySelector("#api-panel");
  const apiStats = document.querySelector("#api-stats");
  const apiRows = document.querySelector("#api-rows");
  const apiCount = document.querySelector("#api-count");
  // The session lives in localStorage so it survives a browser restart; the
  // "already tried" flag is per tab-session so a failed silent sign-in cannot
  // turn into a redirect loop, and so signing out actually stays signed out.
  const STORE = "guestbook_admin_session";
  const TRIED = "guestbook_admin_auto_tried";
  const redirectTo = location.href.split("#")[0].split("?")[0];
  const now = () => Math.floor(Date.now() / 1000);

  function readSession() {
    try { return JSON.parse(localStorage.getItem(STORE) || "null"); } catch { return null; }
  }
  function writeSession(session) {
    try { localStorage.setItem(STORE, JSON.stringify(session)); } catch { /* private mode */ }
  }
  function clearSession() {
    try { localStorage.removeItem(STORE); } catch { /* private mode */ }
  }

  function accessToken() { return readSession()?.access_token ?? ""; }
  // 30s of slack so a request never goes out with a token that expires mid-flight.
  function usable() {
    const session = readSession();
    return Boolean(session?.access_token) && Number(session.expires_at || 0) - 30 > now();
  }

  // The implicit flow hands the session back in the URL fragment.  Keep the
  // refresh token this time -- without it every new browser session would need
  // another round trip through GitHub.  Then strip the fragment so the tokens
  // are not left sitting in the address bar or in browser history.
  function claimSessionFromHash() {
    if (!location.hash.includes("access_token=")) return;
    const hash = new URLSearchParams(location.hash.slice(1));
    const access = hash.get("access_token");
    if (access) {
      writeSession({
        access_token: access,
        refresh_token: hash.get("refresh_token") ?? "",
        expires_at: Number(hash.get("expires_at")) || now() + Number(hash.get("expires_in") || 3600),
      });
      sessionStorage.removeItem(TRIED);
    }
    history.replaceState(null, "", redirectTo);
  }

  async function refreshSession() {
    const session = readSession();
    if (!session?.refresh_token) return false;
    try {
      const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { "apikey": config.supabaseAnonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      });
      if (!response.ok) { clearSession(); return false; }
      const body = await response.json();
      if (!body.access_token) { clearSession(); return false; }
      writeSession({
        access_token: body.access_token,
        refresh_token: body.refresh_token ?? session.refresh_token,
        expires_at: now() + Number(body.expires_in || 3600),
      });
      return true;
    } catch {
      return false;
    }
  }

  async function rpc(name, body, allowRetry = true) {
    const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { "apikey": config.supabaseAnonKey, "Authorization": `Bearer ${accessToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    // A 401 usually just means the access token aged out mid-session; renew
    // once from the refresh token before bothering the reader about it.
    if (response.status === 401 && allowRetry && await refreshSession()) return rpc(name, body, false);
    if (response.status === 401) { clearSession(); throw new Error("登入已過期，請重新登入。"); }
    if (response.status === 403) throw new Error("這個 GitHub 帳號沒有審核權限。");
    if (!response.ok) throw new Error(`操作失敗（${response.status}）`);
    return response.json();
  }

  function addCell(row, value) {
    const cell = document.createElement("td");
    cell.textContent = value ?? "";
    row.append(cell);
    return cell;
  }

  function actionButton(label, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", async () => {
      button.disabled = true;
      try { await handler(); await load(); }
      catch (error) { status.textContent = error.message; button.disabled = false; }
    });
    return button;
  }

  function render(list) {
    rows.replaceChildren();
    count.textContent = String(list.length);
    for (const item of list) {
      const tr = document.createElement("tr");
      addCell(tr, item.id);
      addCell(tr, item.is_approved ? "已核准" : "待審核");
      addCell(tr, item.author);
      addCell(tr, item.body);
      addCell(tr, new Date(item.created_at).toLocaleString("zh-TW"));
      const actions = addCell(tr, "");
      actions.append(actionButton(item.is_approved ? "取消核准" : "核准", () =>
        rpc("guestbook_admin_set_approved", { p_id: item.id, p_approved: !item.is_approved })));
      actions.append(actionButton("刪除", () => {
        if (!confirm(`確定刪除 #${item.id}？此操作無法復原。`)) return Promise.resolve();
        return rpc("guestbook_admin_delete", { p_id: item.id });
      }));
      rows.append(tr);
    }
  }

  function renderApi(stats, calls) {
    apiStats.replaceChildren();
    for (const s of stats) {
      const tr = document.createElement("tr");
      addCell(tr, s.bucket);
      addCell(tr, s.calls);
      addCell(tr, s.ips);
      addCell(tr, s.errors);
      apiStats.append(tr);
    }
    apiRows.replaceChildren();
    apiCount.textContent = String(calls.length);
    for (const c of calls) {
      const tr = document.createElement("tr");
      addCell(tr, new Date(c.at).toLocaleString("zh-TW"));
      addCell(tr, c.ip);
      addCell(tr, c.adrs);
      addCell(tr, c.status);
      addCell(tr, c.zipcode6);
      addCell(tr, c.result_count);
      addCell(tr, c.duration_ms);
      if (c.status >= 400) tr.classList.add("row-error");
      apiRows.append(tr);
    }
  }

  async function loadApi() {
    const [stats, calls] = await Promise.all([
      rpc("admin_api_stats", {}),
      rpc("admin_api_log", { p_limit: 100 }),
    ]);
    renderApi(stats, calls);
    apiPanel.hidden = false;
  }

  async function load() {
    status.textContent = "載入中…";
    try {
      render(await rpc("guestbook_admin_list", { p_limit: 200 }));
      status.textContent = "";
      panel.hidden = false;
      await loadApi();
    } catch (error) {
      panel.hidden = true;
      apiPanel.hidden = true;
      status.textContent = error.message;
      if (!accessToken()) showSignedOut();
    }
  }

  function showSignedIn() {
    signIn.hidden = true;
    signOut.hidden = false;
    who.textContent = "已登入";
  }

  function showSignedOut() {
    signIn.hidden = false;
    signOut.hidden = true;
    who.textContent = "";
    panel.hidden = true;
    apiPanel.hidden = true;
  }

  function goSignIn() {
    location.assign(`${config.supabaseUrl}/auth/v1/authorize?provider=github&redirect_to=${encodeURIComponent(redirectTo)}`);
  }

  signIn.addEventListener("click", () => {
    sessionStorage.removeItem(TRIED);
    goSignIn();
  });
  signOut.addEventListener("click", () => {
    clearSession();
    // Without this the boot logic would silently sign straight back in.
    sessionStorage.setItem(TRIED, "1");
    showSignedOut();
    status.textContent = "已登出。";
  });

  async function boot() {
    claimSessionFromHash();

    if (usable()) { showSignedIn(); return load(); }
    if (accessToken() && await refreshSession()) { showSignedIn(); return load(); }

    // No usable session.  One hop through Supabase is invisible when the OAuth
    // app is already authorised and the GitHub session is live, which is what
    // makes this an automatic sign-in rather than a click.  The per-tab flag
    // means a visitor who is not signed in to GitHub only ever bounces once.
    if (!sessionStorage.getItem(TRIED)) {
      sessionStorage.setItem(TRIED, "1");
      status.textContent = "正在以 GitHub 登入…";
      goSignIn();
      return;
    }

    showSignedOut();
    status.textContent = "請以 GitHub 登入後檢視待審留言。";
  }

  boot();
})();
