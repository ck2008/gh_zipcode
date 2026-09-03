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
