(() => {
  const form = document.querySelector("#comment-form");
  if (!form) return;
  const author = document.querySelector("#comment-author");
  const body = document.querySelector("#comment-body");
  const answer = document.querySelector("#comment-captcha");
  const image = document.querySelector("#captcha-image");
  const reload = document.querySelector("#captcha-reload");
  const status = document.querySelector("#comment-status");
  const list = document.querySelector("#comment-list");
  const submit = form.querySelector("button[type=submit]");
  const messages = {
    pending: "留言已送出，待站長審核後顯示。",
    captcha_wrong: "驗證碼不正確。每組驗證碼只能試一次，已換上新的一張，請重新輸入。",
    captcha_expired: "驗證碼已用過或逾時。已換上新的一張，請重新輸入。",
    empty: "暱稱與留言內容都不能空白。",
    too_long: "暱稱最多 40 字、留言最多 1000 字。",
    rate_limited: "留言太頻繁，請稍後再試。",
  };
  let token = "";

  async function refreshCaptcha() {
    token = "";
    answer.value = "";
    image.textContent = "載入中…";
    try {
      const [challenge] = await PostalApi.rpc("guestbook_new_captcha", {}, "驗證碼載入");
      token = challenge.token;
      // The SVG is built by the database, not by user input, so injecting it as
      // markup is safe and keeps the answer off the client entirely.
      image.innerHTML = challenge.svg;
    } catch (error) {
      image.textContent = "";
      status.textContent = error.message;
    }
  }

  function render(rows) {
    list.replaceChildren();
    if (!rows.length) { list.append(Object.assign(document.createElement("li"), { className: "comment-empty", textContent: "目前還沒有留言。" })); return; }
    for (const row of rows) {
      const item = document.createElement("li");
      const head = document.createElement("p");
      head.className = "comment-meta";
      head.append(Object.assign(document.createElement("strong"), { textContent: row.author }));
      head.append(document.createTextNode(` · ${new Date(row.created_at).toLocaleString("zh-TW")}`));
      const text = document.createElement("p");
      text.className = "comment-body";
      text.textContent = row.body;
      item.append(head, text);
      list.append(item);
    }
  }

  async function loadComments() {
    try {
      render(await PostalApi.rpc("guestbook_list_comments", { p_limit: 50 }, "留言載入"));
    } catch (error) {
      status.textContent = error.message;
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!token) { status.textContent = "驗證碼尚未載入，請稍候或按重新產生。"; return; }
    submit.disabled = true;
    status.textContent = "送出中…";
    try {
      const result = await PostalApi.rpc("guestbook_post_comment", { p_token: token, p_answer: answer.value, p_author: author.value, p_body: body.value }, "留言送出");
      status.textContent = messages[result] ?? "留言送出失敗，請稍後再試。";
      if (result === "pending") { author.value = ""; body.value = ""; }
      await refreshCaptcha();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });

  reload.addEventListener("click", refreshCaptcha);
  refreshCaptcha();
  loadComments();
})();
