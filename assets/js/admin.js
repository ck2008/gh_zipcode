(() => {
  const config = window.POSTAL_CONFIG;
  const signIn = document.querySelector("#sign-in");
  const signOut = document.querySelector("#sign-out");
  const who = document.querySelector("#who");
  const status = document.querySelector("#admin-status");
  const panel = document.querySelector("#admin-panel");
  const rows = document.querySelector("#admin-rows");
  const count = document.querySelector("#admin-count");
  const STORE = "guestbook_admin_token";
  const redirectTo = location.href.split("#")[0].split("?")[0];

  // The implicit flow hands the session back in the URL fragment.  Read it,
  // then strip it so the token is not left sitting in the address bar or in
  // whatever the browser records as the visited URL.
  function claimTokenFromHash() {
    if (!location.hash.includes("access_token=")) return;
    const hash = new URLSearchParams(location.hash.slice(1));
    const token = hash.get("access_token");
    if (token) sessionStorage.setItem(STORE, token);
    history.replaceState(null, "", redirectTo);
  }

  function token() { return sessionStorage.getItem(STORE); }

  async function rpc(name, body) {
    const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { "apikey": config.supabaseAnonKey, "Authorization": `Bearer ${token()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (response.status === 401) { sessionStorage.removeItem(STORE); throw new Error("登入已過期，請重新登入。"); }
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

  async function load() {
    status.textContent = "載入中…";
    try {
      render(await rpc("guestbook_admin_list", { p_limit: 200 }));
      status.textContent = "";
      panel.hidden = false;
    } catch (error) {
      panel.hidden = true;
      status.textContent = error.message;
      if (!token()) showSignedOut();
    }
  }

  function showSignedOut() {
    signIn.hidden = false;
    signOut.hidden = true;
    who.textContent = "";
    panel.hidden = true;
  }

  signIn.addEventListener("click", () => {
    location.assign(`${config.supabaseUrl}/auth/v1/authorize?provider=github&redirect_to=${encodeURIComponent(redirectTo)}`);
  });
  signOut.addEventListener("click", () => {
    sessionStorage.removeItem(STORE);
    showSignedOut();
    status.textContent = "已登出。";
  });

  claimTokenFromHash();
  if (!token()) {
    showSignedOut();
    status.textContent = "請以 GitHub 登入後檢視待審留言。";
  } else {
    signIn.hidden = true;
    signOut.hidden = false;
    load();
  }
})();
