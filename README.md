# gh_zipcode

台灣地址 3+3 郵遞區號查詢，部署至 GitHub Pages，資料由 Supabase `ckdb` 提供。

## 首次設定

1. 在 Supabase SQL Editor 依序執行 `supabase/migrations/0001_postal_schema.sql`、`0002_lookup_rpc.sql`。
2. `assets/js/config.js` 只包含 Supabase public anon key，可安全隨 GitHub Pages 發佈；不可加入 service-role key。
3. 執行 `tools/export-post-street.ps1` 匯出 MSSQL `dbo.post_street`，再於 Supabase Table Editor 的 `postal.post_street` 選擇 **Import data from CSV** 匯入 `out/post_street.csv`。
4. 開啟 `prog1/?qry_addr=台北市大安區羅斯福路2段105號9樓` 驗證。

## 定期更新

```powershell
.\tools\export-post-street.ps1 -ConnectionString '<MSSQL connection string>'
.\tools\new-post-street-update.ps1
```

第二個指令在 `out\update` 產生每批 1,000 筆的 PostgreSQL upsert SQL 與驗證 SQL，格式可直接在 Supabase SQL Editor 依檔名順序執行。

首版僅提供 3+3；3+2 資料尚未匯入。

## 使用者留言

首頁下方的留言區以 `supabase/migrations/0007_guestbook.sql` 建立，資料表在 `guestbook` schema，anon 只能透過三個 `security definer` 包裝函式存取：

- `public.guestbook_new_captcha()`：發一組驗證碼，回傳 `token` 與 SVG。答案只留在 `guestbook.captcha`，不會傳到瀏覽器。
- `public.guestbook_post_comment(token, answer, author, body)`：驗證後寫入留言，回傳 `pending`、`captcha_wrong`、`captcha_expired`、`empty` 或 `too_long`。
- `public.guestbook_list_comments(limit)`：只回傳已核准的留言。

驗證碼為 5 位數字（2-9），以 `<path>` 筆畫繪製而非 `<text>`，所以答案不會出現在 SVG 原始碼裡。每個 token 只能猜一次，答錯即失效。

### 審核留言

留言預設 `is_approved = false`，不會顯示在頁面上。到 Supabase Table Editor 的 `guestbook.comment` 把要公開的那筆改成 `is_approved = true`（或在 SQL Editor 執行 `update guestbook.comment set is_approved = true where id = <id>;`）。刪除留言直接刪該列即可。

每分鐘每個來源 IP 的上限：發驗證碼 20 次、送出留言 10 次（`0009_guestbook_rate_limit.sql`）。上限由 `guestbook.take_token()` 以固定一分鐘視窗計數，來源 IP 取自 PostgREST 傳給 SQL 的 `current_setting('request.headers')`——所以不需要在前面再擺一個 Edge Function。若該 header 哪天取不到，`client_key()` 會回傳 `unknown`，所有人共用一個桶而被一起限流（刻意不 fail-open）。`guestbook_list_comments` 不限流：它只讀已公開的資料，也不會產生任何列。

### 審核介面

`admin/` 是審核頁，資料只有 GitHub 帳號 `ck2008`（numeric id `11531735`）看得到。

首次啟用需要三個手動步驟（含 client secret，必須自己填）：

1. GitHub → Settings → Developer settings → **OAuth Apps** → New OAuth App。Homepage 填 `https://ck2008.github.io/gh_zipcode/`，Authorization callback URL 填 `https://skubqoeizqgbixaaxfeq.supabase.co/auth/v1/callback`。
2. Supabase → Authentication → Providers → **GitHub**，開啟並填入 Client ID 與 Client Secret。
3. Supabase → Authentication → URL Configuration → **Redirect URLs** 加入 `https://ck2008.github.io/gh_zipcode/admin/`。

權限檢查在 `guestbook.is_admin()`，比對 `auth.identities.provider_id`，**不是** JWT 裡的 `user_metadata.user_name`——後者使用者可以自行改寫，用它把關等於沒把關。要換帳號就改 `0008_guestbook_admin.sql` 裡的 numeric id 重跑。

三個 RPC（`guestbook_admin_list`、`guestbook_admin_set_approved`、`guestbook_admin_delete`）只授權給 `authenticated`，anon 直接被 Postgres 擋在 `permission denied`；登入後再由 `is_admin()` 收斂到單一帳號。

注意：`admin/index.html` 與 `admin.js` 本身是 GitHub Pages 上的靜態檔案，任何人都能下載原始碼。受保護的是**留言資料與核准／刪除動作**，由資料庫端強制，不是靠藏頁面。

## 公開 API（免 key）

```
GET https://skubqoeizqgbixaaxfeq.supabase.co/functions/v1/zipcode?adrs=<UTF-8 地址>
```

回傳四個欄位：`adrs`（原輸入地址）、`zipcode6`（第一筆命中的 3+3 郵遞區號）、`dataver6`（資料版本）與 `results`（全部命中範圍）。API 每個來源每分鐘最多 30 次；請勿將它作為大量批次查詢介面。

### 三層限流

| 層級 | 上限 | 記在哪 |
|---|---|---|
| 每個來源 IP（API） | 30 次/分 | Edge Function 記憶體 |
| 每個 LINE sender（bot） | 20 次/分 | Edge Function 記憶體 |
| 全站總量（API + bot） | 120 次/分 | Postgres，`0012_api_rate_limit.sql` |

前兩層在 Edge Function 的記憶體裡，所以實際是「每個實例」各算一份，而且同一個人換 IP 就繞過了。真正封住同時間大量查詢的是第三層：`public.api_take_token()` 用 `apilog.rate_hit` 一分鐘一列，所有請求都會在那一列上排隊，跨實例算得準。額度用完回 429 `全站查詢量已達上限，請稍後再試。`，bot 則把同一句話回給使用者。

限流點在 `lookupZipcode()` 裡、地址解析之後——認不出來的輸入會先拿 400，不會吃掉全站額度。上限數字是 `_shared/zipcode.ts` 的 `GLOBAL_LIMIT_PER_MINUTE`，改完重新部署兩個 function 即可；`api_take_token` 只授權給 `service_role`，anon 拿不到，所以沒辦法從瀏覽器塞一個大的 `p_limit` 進去。

若 `0012` 還沒執行，function 會記一筆 `api_take_token is missing` 到日誌並照常查詢：沒跑的 migration 應該是「上限沒生效」，不是把整個 API 打掛。

## LINE bot

LINE channel `zipcode`（`@435xgkgm`）的 webhook 也是同一個 Supabase 專案裡的 Edge Function：

```
POST https://skubqoeizqgbixaaxfeq.supabase.co/functions/v1/linebot
```

地址解析與查詢放在 `supabase/functions/_shared/zipcode.ts`，`zipcode`（HTTP API）與 `linebot`（LINE webhook）共用同一份，所以兩邊不可能對同一個地址給出不同答案。bot 不會繞回去打自己的公開 API——那樣所有 LINE 使用者會共用 Edge Function 的出口 IP，一起撞 30 次/分的上限。

### 啟用

1. 在 LINE Developers Console 的 Messaging API 分頁取得 Channel secret 與 Channel access token，設成 secret 後部署：

```powershell
supabase secrets set LINE_CHANNEL_SECRET=<channel secret> LINE_CHANNEL_ACCESS_TOKEN=<channel access token>
supabase functions deploy linebot
supabase functions deploy zipcode
```

`zipcode` 也要重新部署：它的解析邏輯已經搬到 `_shared/`。

2. Console → Messaging API → Webhook settings：Webhook URL 換成上面那個 function URL，打開 **Use webhook**，按 **Verify** 應回 Success（Verify 送的是空 `events` 陣列，function 一樣回 200）。
3. LINE Official Account Manager → 回應設定：關掉**自動回覆訊息**，否則官方罐頭訊息會壓過 bot 的回覆。

ngrok 不再需要，function URL 是固定的，本機關機也不影響。

### 行為

- 文字訊息當地址查詢；貼圖、圖片與 `follow`、`join` 事件回使用說明。
- 只命中一組就直接回那組郵遞區號；命中多組時列出前 5 組與門牌範圍讓使用者自己對。這是刻意的：RPC 是按郵遞區號排序而非精確度，`台北市信義路五段7號` 會同時命中「單 17號以下」（110014）與「7號」（110615），挑第一筆等於瞎猜。超過 5 組會附上網頁查詢連結。
- 每個 LINE 使用者或群組每分鐘 20 次，按 sender 計而不是按 IP——所有 webhook 都來自 LINE 的伺服器，用 IP 分桶等於全部人共用一桶。
- 簽章用 channel secret 對 **raw body** 做 HMAC-SHA256，與 `x-line-signature` 常數時間比對，不符回 401。所以這個 function 雖然 `verify_jwt = false`，實際上只有 LINE 打得進來。
- 查詢一樣寫進 `apilog.call`，但 `ip` 欄位填字串 `line`，在審核頁的呼叫紀錄裡分得出哪些是 bot 來的。
