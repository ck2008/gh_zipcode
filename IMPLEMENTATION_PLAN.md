# gh_zipcode：郵遞區號查詢搬遷實作規劃

## 0. 目標與範圍

建立獨立 GitHub Pages 專案 **gh_zipcode**，將既有 ASPX + MSSQL 的台灣地址郵遞區號查詢搬至 Supabase 專案 **ckdb**。公開入口為：

```text
https://ck2008.github.io/gh_zipcode/prog1?qry_addr=<URL-encoded 地址>
```

（若最後確定要部署到既有 `ckweb` repository，僅調整 GitHub Pages base path；功能與資料庫設計不變。）

需求：

- 首頁版面依參考圖：3+3 標誌、地址輸入、查詢按鈕、原輸入地址、3+2、3+3，以及縣市捷徑。
- 結果頁／帶參數的 `prog1` 顯示 **所有** 合格候選結果，不只顯示第一筆。
- 前端以 Supabase URL 與 anon key 直接呼叫查詢；不可放 service-role key。
- 來源為 MSSQL `stdkw_adbook_unicode.dbo.post_street` 與既有「通訊錄郵遞區號產生原始檔」工具所產出的資料。
- 產出可重複執行的 PostgreSQL/Supabase SQL 更新包，取代 MSSQL T-SQL 格式的更新檔。

非範圍：登入、地址資料編輯介面、寫入公開 API。

## 1. 現況分析與必做驗證

### 可確認的舊服務協定

舊頁面呼叫 `query_zipcode.aspx`，以 XML POST 傳送：

```xml
<REQUEST action="郵遞區號"><地址>台北市大安區羅斯福路2段105號9樓</地址></REQUEST>
```

成功時回傳 XML，包含 `RETURN`、`DATA_NUM`，及多個 `IT` 節點。每個 `IT` 至少有 `ZIP_CODE`、`CITY_NAME`、`DISTRICT_NAME`、`STREET_NAME`、`SECTOR`、`SOURCE_DETAIL`。這表示舊服務本來就可能回傳多個門牌範圍候選，不能以單一 zip code 假設設計新介面。

截圖可確認的 `post_street` 欄位為：`id`、`zip_code`、`district_id`、`city_name`、`district_name`、`street_name`、`sector`、`neighborhood`、`neighborhood_from`、`neighborhood_end`、`lane`、`lane_from`、`lane_end`、`alley`、`alley_from`、`alley_end`、`house_number`、`house_number_sub`、`floor`、`house_number_from`、`house_number_from_sub`、`house_number_end`、`house_number_end_sub`、`floor_end`、`scope`、`number_type`、`record_type`、`source_detail`。

### 已完成的 ASPX／JScript 分析

已讀取正確路徑 `L:\eic_server\eic_server_stdkw\adbook_kws\zipcode\asp\query_zipcode.aspx`、其 include 的 `sjs/query_zipcode.js`，及舊的測試頁 `zipcode/zipcode.htm`。ASPX 本身只負責讀取 XML、依 `action="郵遞區號"` 取得 `<地址>`、建立 ADO connection 並輸出 XML；核心邏輯在 JScript。

新實作必須複製下列可觀察行為：

1. 將全形 ASCII（包含數字及空白）轉半形，移除半形／全形空白。
2. 以 regex 擷取縣市、行政區（鄉／鎮／市／區）、村里、鄰、路／街／大道／段、段數、巷、弄、號、之號與樓層；段數接受阿拉伯、全形與中文大寫／小寫數字。
3. 由門牌奇偶數產生 `number_type`：奇數為 1、偶數為 2、未帶號碼為 0；傳給資料庫。
4. 由 `city_appellation.xml` 將別名轉成正式縣市（如「台／臺」名稱的別名）；找不到正式縣市時，會將已解析的值當作行政區處理。
5. 呼叫 `post_query_zipcode`，參數依序為 `city_name`、`district_name`、`street_name`、`sector`、`neighborhood`、`lane`、`alley`、`house_number`、`house_number_sub`、`number_type`、`record_type`、`floor`。
6. 首次無資料時，依序放寬：忽略樓層（`record_type=0`）→ 忽略門牌並以弄的奇偶搜尋（`record_type=3`）→ 忽略弄並以巷的奇偶搜尋（`record_type=2`）→ 忽略巷、以道路層級搜尋（`record_type=1`）→ 忽略鄰。每一階段只在前一階段零筆結果時執行，因此只要找到一筆就停止並回傳該次的全部候選。

舊碼存在幾個不可默默複製的疑點：預設 `alley=24`、道路層級 fallback 把 retry counter 傳給 `getNumberType()`、`house_number_sub` 移除字串時誤用樓層 regex。首版應以「與既有輸出相同」為最高優先，但每一個疑點都要寫進 `docs/legacy-parity.md`；若 golden test 證實是 bug，須取得確認後才修正，不能在移植時自行改變結果。

已取得 `dbo.post_query_zipcode` 定義；仍須盤點它引用的 objects 與資料實際分布。它才是 `scope`、門牌起訖、單雙號和 `record_type` 的最終比對規則；不可只依 ASPX 重寫 SQL WHERE 條件。

必須以至少 30 筆既有系統的實際輸入／輸出建立 golden test fixture，含圖中 `台北市大安區羅斯福路2段105號9樓`，並分別涵蓋完整地址、缺樓層、含之號、奇偶號、巷弄、鄉鎮、市名別稱與無結果。

### 已取得的 `dbo.post_query_zipcode` 規則

已取得 stored procedure 定義。它從 `post_street` 回傳 `zip_code`、縣市、行政區、路名、段與 `source_detail`，並以 `zip_code` 遞增排序。Supabase RPC 的 SQL 條件必須逐條等價移植：

| 條件 | 舊程序行為 |
| --- | --- |
| 樓層 | 未提供樓層（`-1`）不限制；否則匹配相同樓層或落在 `floor_from` 至 `floor_end`。 |
| 門牌 | 未提供門牌時不限制；否則匹配確切號碼／附號，或落在 `house_number_from` 至 `house_number_end`。範圍命中時，`number_type=0` 可通過，否則必須同時符合奇偶與 `record_type`。 |
| 弄全／巷全 | `scope=1` 的特殊列，分別以 `record_type=@record_type+3` 或 `+2` 參與；奇偶號為 0 或相同才通過。 |
| 縣市、行政區、路名 | 空字串不限制，否則精確等於來源欄位。 |
| 段 | 空段或資料列段為 `0` 可通過；否則精確匹配。 |
| 鄰、巷、弄 | `-1` 不限制；否則先精確匹配，再依起訖範圍匹配，範圍匹配仍套用奇偶與 `record_type`。弄另有 `scope=1` 的 `record_type=@record_type-1` 特例。 |

**舊程序相容性注意事項：**

- `@lane_int` 宣告為 `-1` 後從未被賦值，故「巷起訖範圍」分支實際上只會拿 `-1` 比對；移植首版必須先以 golden tests 決定要保留此既有行為，或修正成解析後的整數巷號。不可不經比對直接修正。
- `@lane` 是 `varchar(200)`，但 `post_street.lane`／`lane_from`／`lane_end` 在截圖中是整數；PostgreSQL 不會接受 SQL Server 的隱式文字／數字比較。RPC 必須明確把輸入解析成 `p_lane integer`（或在相容模式下保留 `-1`），並避免 cast 失敗。
- procedure 的 `AND`／`OR` 優先序是結果相容性的核心。移植時每個 OR 群組都要保留明確括號；不得為了「可讀性」重排條件。
- procedure 沒有 `TOP` 或分頁；前端要求完整候選時，RPC 不應任意截斷舊系統可回傳的結果。若日後加上安全上限，必須以另一個狀態欄位明確告知前端，並經確認。

## 2. Repository 與前端架構

### Repository

目前 `E:\GitHub\ck2008\gh_zipcode` 是 `ck2008` repository 底下的目錄，不是獨立 Git repository。建立時應：

1. 在 GitHub 建立 `ck2008/gh_zipcode` repository。
2. 將此目錄初始化為獨立 repository、設定 remote 為新 repo，避免推送至現有 `ck2008/ck2008`。
3. 啟用 GitHub Pages（GitHub Actions 或 Pages from branch，二擇一並固定）。
4. 設定 `base`/資產路徑為 `/gh_zipcode/`，驗證深連結 `/prog1?qry_addr=...` 重新整理後仍可用。

建議採無建置依賴的靜態網站，降低 GitHub Pages 複雜度：

```text
gh_zipcode/
  index.html                 # 首頁；地址輸入與縣市捷徑
  prog1/index.html           # URL query 查詢結果頁
  assets/css/app.css
  assets/js/config.example.js
  assets/js/supabase-client.js
  assets/js/address.js       # 正規化、URL 讀寫、輸出轉義
  assets/js/home.js
  assets/js/prog1.js
  supabase/migrations/0001_postal_schema.sql
  supabase/migrations/0002_postal_rpc.sql
  supabase/tests/postal_lookup.sql
  tools/README.md
  docs/legacy-parity.md
  README.md
```

`config.js`（實際 URL 與 anon key）不可提交；由 `config.example.js` 複製建立。anon key 可公開，但只配合最小化的 RLS/RPC 權限使用。

### UI 與行為

- `index.html`：視覺依參考圖 2，使用語意化 `<label>`、`<form>`、`button` 與鍵盤送出；送出後導向 `prog1/?qry_addr=${encodeURIComponent(address)}`。
- `prog1/index.html`：載入 `qry_addr`；空值顯示輸入提示，不送 RPC。輸入框保留可編輯，按 Enter／查詢重新導向本頁。
- 顯示「原輸入地址」、3+2 結果區、3+3 結果區。每區以清單或表格列出全部候選：郵遞區號、完整可讀地址、門牌／樓層範圍、資料說明；候選筆數顯示在標題。
- 圖 3 的單筆外觀可保留為第一筆，但不得隱藏其餘候選。無結果、地址格式不足、網路錯誤均要有不同且可理解的提示。
- 縣市捷徑先實作為 `prog1/?city=台北市` 等；RPC 回傳該縣市的行政區與郵遞區號清單／可用地址條件。若舊頁實際連至其他功能，於舊碼分析後改成相容行為。
- 所有從資料庫回傳的文字以 `textContent` 寫入 DOM，禁止以 `innerHTML` 直接插入。

## 3. Supabase 資料庫設計

### 資料表

建立 schema `postal`（或既有 ckdb 規範要求的 `public`，二者擇一且全案一致）。主表 `postal.post_street` 保留 MSSQL 原始欄位，並增加：

- `legacy_id bigint not null unique`：來源 MSSQL `id`，做為穩定 upsert key。
- `zip_3_3 text`、`zip_3_2 text`：**由來源／舊邏輯明確產出**，不可以字串切割猜測。
- `normalized_city`、`normalized_district`、`normalized_street`：去空白、全半形統一後的比對欄位。
- `address_display text`：供結果直接呈現；仍保留 `source_detail` 作追溯。
- `source_version text`、`source_updated_at timestamptz`、`imported_at timestamptz default now()`。

範圍欄位改為 PostgreSQL `integer`，文字名稱改為 `text`。將原始數值中的 0／NULL 含義記錄於 `docs/legacy-parity.md`，在尚未確認前不進行語意轉換。

建立索引：

```sql
create index post_street_city_district_street_idx
  on postal.post_street (normalized_city, normalized_district, normalized_street);
create index post_street_zip_32_idx on postal.post_street (zip_3_2);
create index post_street_zip_33_idx on postal.post_street (zip_3_3);
```

資料量與實測查詢若顯示需要，再加 `pg_trgm` 的 `normalized_street` GIN 索引；不可在未量測時讓前端以整表模糊下載處理。

### 查詢 RPC 與安全性

前端直接以 anon key 呼叫：

```text
supabase.rpc('postal_lookup', { p_address: '...' })
```

RPC 回傳 JSON/recordset，固定欄位：`postal_type`（`3+2` / `3+3`）、`zip_code`、`city_name`、`district_name`、`street_name`、`sector`、`source_detail`、`address_display`、`match_rank`、`match_reason`。

`postal_lookup(p_address text)` 的實作順序：

1. 限制長度、移除首尾／全形空白並正規化「臺/台」等可確認的等價字。
2. 解析或比對縣市、區、路街、段、巷、弄、號、之、樓；解析規則必須以 ASPX golden tests 驗證。
3. 先精確匹配縣市＋區＋路街＋段，再依門牌區間、單雙號、之號、樓層、`scope` 與 legacy 規則篩選。
4. 同時產出 3+2 與 3+3 候選、移除相同結果、按精確度與舊系統優先順序排序。
5. 設最大回傳筆數（例如 100）；達上限時回傳 `truncated` 狀態，提示使用者補足地址。

權限：啟用 RLS，禁止 anon 對原始主表 `select`，僅 `grant execute on function postal.postal_lookup(text) to anon`。RPC 使用受控 `search_path` 的 `security definer`，只回傳公開且必要欄位。此作法仍符合「前端以 anon key 直接查詢」，但不會開放整份地址資料的任意下載。

另提供 `postal_cities()` 與 `postal_city_summary(p_city text)` RPC 給縣市捷徑；同樣僅授予 anon execute。

## 4. MSSQL → Supabase 初始遷移

1. **盤點**：匯出 MSSQL schema、筆數、NULL 比例、各 `record_type`／`number_type`／`scope` 分布，以及 3+2／3+3 實際來源。
2. **抽取**：以 UTF-8 CSV/JSON 匯出；保留 `legacy_id` 與原始字串，不將中文經 Excel 中轉。
3. **轉換**：用可版本控制的轉換程式，欄位型別、0/NULL、zip mapping 與正規化規則全部記錄在 transformation report。
4. **載入 staging**：先載入 `postal.post_street_stage`，驗證筆數、`legacy_id` 唯一性、郵遞區號格式、必填縣市／路名與抽樣地址。
5. **發布**：在 transaction 中 upsert 至正式表、重建必要索引、更新 `postal.dataset_version`，最後才讓 RPC 使用新資料版本。
6. **比對**：golden tests 的結果需與舊 ASPX 完全相同，或將每一個刻意差異登錄在 `docs/legacy-parity.md` 並取得確認。

禁止把 MSSQL 的 T-SQL `IDENTITY_INSERT`、`GO`、方括號欄位名或 SQL Server 專屬語法直接送到 Supabase。

## 5. 定期 SQL 更新包（沿用既有產檔）

既有工具目前會產出多個 `03post_street*.sql` 和 `update_source_detail.sql`。新流程保留「定期產檔、人工覆核後匯入」模式，但產生 **PostgreSQL** 相容格式：

```text
out/<YYYYMMDD-HHMMSS>/
  manifest.json
  01_post_street_0001.sql
  ...
  01_post_street_NNNN.sql
  02_post_street_reconcile.sql
  03_post_street_validate.sql
  README.md
```

- 每個分批檔只做 parameter-safe `insert ... on conflict (legacy_id) do update` 至 staging 或正式表；分批大小依檔案上限調整。
- `02_post_street_reconcile.sql` 以本次 `source_version` 標記資料，再安全地停用／刪除已不在完整來源快照中的舊資料；禁止無來源版本條件的全表刪除。
- `03_post_street_validate.sql` 輸出筆數、重複 key、無效 zip、空行政區／路名、各縣市筆數與資料版本，任何異常以非零／明確 error 結束。
- `manifest.json` 記錄來源版本、產出時間、資料列數、每一檔 SHA-256、預期執行順序與 old/new checksum。
- `update_source_detail.sql` 的舊行為必須由原始產檔工具與 ASPX 資料依賴分析後移植；若它只是補寫描述，改成更新 `source_detail` 和 `address_display` 的 staging 轉換步驟。
- 匯入前先在 ckdb staging 專案／schema 演練，驗證成功後再套用 production；保留最近一次成功更新包與 rollback SQL。

建議以 Windows Task Scheduler 或 CI workflow 在既有產檔主機上排程「產生與驗證」，但**不自動套用 production**；使用者審核 manifest 後再由 Supabase CLI／SQL Editor 執行。日後若要全自動，另加保護與通知，不與首版混在一起。

## 6. 實作順序與驗收

### Phase A — 基礎設施

1. 建立獨立 GitHub repository 與 Pages pipeline。
2. 建立 ckdb migration、RLS、RPC 及 test schema。
3. 交付 `.env`／`config.js` 設定說明；確認 service-role key 沒有出現在 repository 或 GitHub Pages 輸出。

**驗收**：空白網站可部署，匿名使用者只能 execute 指定 RPC，不能讀／寫原始表。

### Phase B — 資料與舊邏輯相容

1. 讀取 ASPX 及其相依 SQL，完成 `legacy-parity.md`。
2. 匯入 staging、資料品質報告、首次正式資料集。
3. 建立 golden tests，逐筆比對舊／新 3+2 與 3+3 所有候選結果及排序。

**驗收**：資料筆數可追溯；30+ 測試例 100% 通過，或所有差異均有明確簽核。

### Phase C — 前端

1. 完成首頁、`prog1` URL 查詢、結果清單、縣市捷徑與 RWD/accessibility。
2. 使用網址範例驗證可直接開啟、重新整理與中文 URL decode。
3. 對 RPC 逾時、無資料、地址不足與結果過多提供明確提示。

**驗收**：圖中範例地址能顯示所有 3+2／3+3 候選；沒有瀏覽器 console error；手機寬度可用；輸入內容不造成 XSS。

### Phase D — 定期更新

1. 將既有產檔格式改為 PostgreSQL 更新包。
2. 執行一次 dry-run，檢驗 checksum、row count 與結果抽樣。
3. 撰寫操作手冊與 rollback 程序。

**驗收**：新版本資料可重複匯入而不產生重複列；失敗時正式資料集仍維持上一個已發布版本。

## 7. Claude Code 執行指令

將以下需求直接交給 Claude Code，並要求它每一 Phase 完成後先回報測試證據再進下一階段：

> 在此 workspace 建立獨立 GitHub Pages 專案 `gh_zipcode`，依 `IMPLEMENTATION_PLAN.md` 實作。已分析舊 ASPX：`L:\\eic_server\\eic_server_stdkw\\adbook_kws\\zipcode\\asp\\query_zipcode.aspx`、`sjs/query_zipcode.js` 與 `dbo.post_query_zipcode`；將規則、疑點與相依 objects 寫入 `docs/legacy-parity.md`，並以舊系統輸入輸出建立 golden tests。SQL 的 AND/OR 括號、逐級 fallback、`scope` 特例與目前 `@lane_int` 未賦值的行為都必須先以測試驗證，才能決定是否修正。使用 Supabase `ckdb`：建立 `postal.post_street` schema、RLS、最小權限 anon RPC；前端只以 anon key 呼叫 RPC，絕不使用 service-role key。保留 MSSQL 欄位與 stable `legacy_id`，3+2 與 3+3 必須以來源／舊規則取得，禁止截字猜測。首頁照參考圖製作，`prog1/?qry_addr=` 顯示所有候選。將既有郵遞區號產檔流程改產生可驗證、可重複執行、分批 PostgreSQL SQL 更新包。不得在未確認本機資料、Supabase schema 或舊邏輯前刪除、truncate、覆寫任何 production 資料；每個 Phase 必須提供 migration、測試與驗收結果。
