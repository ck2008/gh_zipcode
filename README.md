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
