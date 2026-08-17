# DSE 溫習日誌 — 後端部署指南（Google Apps Script + Google Sheet）

> 本文件供**沒有寫過程式**的老師照做，一步一步建立後端。全程只需要一個 Google 帳戶，
> 不需要安裝任何軟件。請由上而下按順序完成，不要跳步。
>
> 完成後，`runSelfTest()` 會顯示「✔ 自測全部通過」，即代表後端已經可以使用。

---

## 目錄

1. [建立試算表](#1-建立試算表)
2. [建立分頁與表頭](#2-建立分頁與表頭)
3. [`date` 欄位必須設為純文字](#3-date-欄位必須設為純文字)
4. [填入種子資料](#4-填入種子資料)
5. [檢查分享設定（不設任何分享）](#5-檢查分享設定不設任何分享)
6. [部署為網頁應用程式](#6-部署為網頁應用程式)
7. [複製 `/exec` 網址](#7-複製-exec-網址)
8. [執行 `runSelfTest()`](#8-執行-runselftest)
9. [系統如何處理並行寫入](#9-系統如何處理並行寫入)
   - 9.1 [資訊性附註：`batchUpdate` 的原子性——設計已不依賴](#91-資訊性附註batchUpdate-的原子性設計已不依賴不需要驗證)
   - 9.2 [已查明的平台行為：同執行內容過期](#92-已查明的平台行為同一次執行內spreadsheetapp-讀不到剛透過-rest-寫入的內容)
10. [疑難排解](#10-疑難排解)

---

## 1. 建立試算表

1. 前往 [sheets.google.com](https://sheets.google.com)，用你的 Google 帳戶登入。
2. 按左上角「＋ 空白」，建立一個新的試算表。
3. 按左上角試算表名稱（預設是「未命名試算表」），改名為：

   ```
   DSE 溫習日誌資料
   ```

> 這個試算表就是整個系統唯一的資料庫。之後所有學生登入、記錄溫習時數，
> 全部都寫入這個試算表。

---

## 2. 建立分頁與表頭

新試算表預設有一個叫「工作表1」的分頁。你需要建立以下 **7 個分頁**（其中
`records_2026`、`days_2026` 是「2026 屆」專屬的分頁；日後有新一屆學生，
按同一格式多建一對 `records_<年份>`、`days_<年份>` 即可，詳見本節末的說明）。

**建立分頁的方法**：按試算表左下角的「＋」新增分頁，雙擊分頁名稱可以改名。

**貼上表頭的方法**：每個分頁建立後，先點選該分頁的 **A1 儲存格**，然後把下面
對應的一整行文字複製，直接貼上（`Ctrl+V`）。因為文字之間是用 Tab 分隔，
Google 試算表會自動把它們分開放進 A1、B1、C1……，不需要逐格輸入。

### 2.1 `students`（學生名冊）

A1 貼上：

```
student_id	name_zh	name_en	class	cohort	password	my_subjects	lang	theme	session_token	token_expiry	status
```

| 欄位 | 說明 |
| :--- | :--- |
| `student_id` | 學號，登入用，**不可與任何 `teacher_id` 重複** |
| `name_zh` / `name_en` | 中文／英文姓名 |
| `class` | 班別，只作顯示 |
| `cohort` | 屆別，例如 `2026`；決定此學生的記錄寫入 `records_2026`、`days_2026` |
| `password` | **明文密碼**，見第 5 節的分享警告 |
| `my_subjects` | 學生自選科目的 `code`，以英文逗號分隔，例如 `MATH,M2,PHY`；剛建立學生時可留空，開學後由學生自行在「設定」選取 |
| `lang` | `zh` 或 `en` |
| `theme` | `light` 或 `dark` |
| `session_token` / `token_expiry` | 留空，登入時系統自動填入，不要手動填寫 |
| `status` | `active`（可登入）或 `inactive`（停用） |

### 2.2 `teachers`（老師名冊）

A1 貼上：

```
teacher_id	name	password	role	lang	theme	session_token	token_expiry	status
```

| 欄位 | 說明 |
| :--- | :--- |
| `teacher_id` | 教師編號，登入用，**不可與任何 `student_id` 重複** |
| `name` | 顯示名稱 |
| `password` | **明文密碼** |
| `role` | `teacher` 或 `admin`（Phase 1 兩者權限相同，`admin` 純作標記） |
| `lang` / `theme` | 同學生 |
| `session_token` / `token_expiry` | 留空，登入時自動填入 |
| `status` | `active` 或 `inactive` |

### 2.3 `subjects`（全校科目表）

A1 貼上：

```
code	name_zh	name_en	sort	active
```

| 欄位 | 說明 |
| :--- | :--- |
| `code` | 科目代號，**不可重複**，例如 `MATH`、`M2`、`PHY` |
| `name_zh` / `name_en` | 中文／英文科目名 |
| `sort` | 顯示次序（數字，愈細愈前） |
| `active` | `TRUE`（學生可選）或 `FALSE`（停用，舊記錄仍正常顯示） |

科目表內容見 [第 4.3 節](#43-subjects-科目表)。

### 2.4 `teacher_comments`（老師評語）

A1 貼上：

```
student_id	cohort	period	comment	teacher_id	updated_at
```

此分頁一開始留空，由系統在老師撰寫評語時自動寫入，毋須手動填資料。

### 2.5 `config`（系統設定）

A1 貼上：

```
key	value
```

內容見 [第 4.2 節](#42-config-系統設定)。

### 2.6 `records_2026`（2026 屆溫習記錄）

A1 貼上：

```
id	student_id	date	subject_code	hours	content	updated_at
```

此分頁一開始留空，由學生使用 app 記錄時自動寫入，毋須手動填資料。
**分頁名稱必須完全是 `records_2026`**（底線、無空格），因為系統是靠這個
名稱配對屆別。

### 2.7 `days_2026`（2026 屆每日反思）

A1 貼上：

```
student_id	date	mood	reflection	updated_at
```

同樣一開始留空，分頁名稱必須完全是 `days_2026`。

> **日後開新一屆點做？** 假設 2027 年開始有新一屆學生，只需要：
> 1. 多建兩個分頁，名叫 `records_2027`、`days_2027`，表頭與上面完全相同
> 2. 新學生的 `students.cohort` 填 `2027`
> 3. 老師如需把「全班總覽」的預設檢視換到新一屆，把 `config` 的
>    `current_cohort` 改成 `2027`
>
> 舊一屆（`records_2026`／`days_2026`）保留不動，舊學生仍可用自己的
> `cohort` 存取自己那一屆的記錄。

> **重要**：所有分頁名稱、欄位名稱（表頭文字）必須跟上面**一字不差**，
> 包括大小寫與底線。系統是直接用這些名稱讀寫資料，改壞了系統會讀不到
> 資料，或者 `runSelfTest()` 會報錯（見第 9 節）。

---

## 3. `date` 欄位必須設為純文字

`records_2026` 與 `days_2026` 的 `date` 欄位（即 C 欄與 B 欄）儲存的日期
格式是文字 `2026-07-29`，**不是**試算表的「日期」型別。如果不特別設定，
Google 試算表會在你或系統寫入 `2026-07-29` 時，自動把它轉換成日期物件，
令系統之後用文字比對日期（例如判斷「是否屬於 2026-07 月」）全部失敗。

**設定方法（兩個分頁都要做一次）**：

1. 打開 `records_2026`，點選 `date` 欄位的**整欄**（點欄頂的字母，例如 `C`）
2. 選單：**格式 → 數字 → 純文字**
3. 打開 `days_2026`，對 `date` 欄位（欄 `B`）重複同樣步驟

> 這一步很容易漏，但漏了的後果是資料悄悄地錯，不會立即看到錯誤訊息。
> 務必現在就做，不要留到之後。

---

## 4. 填入種子資料

以下三組資料，複製後直接貼在對應分頁的 **A2** 儲存格（即表頭下面一行）。

### 4.1 `teachers` 的第一個帳戶

在 `teachers` 分頁 A2 貼上：

```
admin	老師姓名	steam-4821	admin	zh	light			active
```

**貼完之後請手動修改**：
- `admin` → 改成你想用的教師編號（例如你的英文名縮寫）
- `老師姓名` → 改成你的顯示名稱
- `steam-4821` → 改成你自己的密碼（建議用「詞語+數字」的系統風格密碼，
  不要用你在其他網站也用開的密碼，因為這裡是明文儲存，見第 5 節）

`session_token`、`token_expiry` 兩欄留空（貼上的內容中間本來就是空白）。

### 4.2 `config` 系統設定

在 `config` 分頁 A2 開始，逐行貼上（或一次過選 A2 貼上整段，7 行會自動
往下排開）：

```
current_cohort	2026
dse_start_date	2026-04-09
exam_dates	{"2026-04-09":"中文","2026-04-11":"英文","2026-04-14":"數學","2026-04-16":"通識教育"}
quotes_zh	["溫故而知新，可以為師矣。","一分耕耘，一分收穫。","水滴石穿，繩鋸木斷。","今日事，今日畢。"]
quotes_en	["Small steps every day add up to big results.","Discipline beats motivation.","Success is the sum of small efforts, repeated."]
app_name_zh	DSE 溫習日誌
app_name_en	DSE Study Log
```

**貼完之後請手動修改**：
- `dse_start_date` → 改成你學校/你屆學生實際的 DSE 開考日
- `exam_dates` → 改成實際的考試日期表。**格式必須是合法 JSON**：
  大括號包住、每組是 `"日期":"科目名"`、中間用逗號分隔、日期與科目名都要有
  引號。改錯格式會令 `runSelfTest()` 報錯（見第 9 節）
- `quotes_zh` / `quotes_en` → 可自行替換成你喜歡的語錄，格式是 JSON 陣列
  （方括號包住、每句用引號、中間逗號分隔）
- `app_name_zh` / `app_name_en` → 可自行改成你想要的 app 名稱

> `app_name_zh`、`app_name_en` 不是 `runSelfTest()` 會檢查的項目，但前端
> （Task 11 之後）會讀取它們作為畫面標題，所以現在一併填好，之後不用回頭補。

> ⚠️ **這 6 個 key（`dse_start_date`／`exam_dates`／`quotes_zh`／
> `quotes_en`／`app_name_zh`／`app_name_en`）會經 `getPublicConfig` 這個
> 免登入的 action 公開讀取**——登入畫面要喺使用者輸入帳密之前顯示
> DSE 倒數與語錄，所以任何知道 Web App 網址的人都讀得到這 6 個 key
> 目前的值。`current_cohort` **不在**這個名單內，不會被公開。
>
> **日後在 `config` 分頁加新 key 時要留意**：新 key 預設**不會**自動公開，
> 只有寫死在 `Code.gs` 的 `handleGetPublicConfig()` 白名單裡的 key 才會
> 經 `getPublicConfig` 流出。如果新 key 屬於任何敏感內容（例如外部服務
> 的 API 金鑰、只給自己看的備註），**什麼都不用做**，它自動保持私有；
> 只有你確定某個新 key 想像 `dse_start_date` 一樣公開展示，才需要請人
> 手動把它加進那份白名單。

### 4.3 `subjects` 科目表

在 `subjects` 分頁 A2 開始貼上：

```
CHIN	中國語文	Chinese Language	1	TRUE
ENG	英國語文	English Language	2	TRUE
MATH	數學（必修部分）	Mathematics (Compulsory Part)	3	TRUE
M1	數學延伸部分單元一	Extended Module 1 (Calculus and Statistics)	4	TRUE
M2	數學延伸部分單元二	Extended Module 2 (Algebra and Calculus)	5	TRUE
LS	公民與社會發展	Citizenship and Social Development	6	TRUE
PHY	物理	Physics	7	TRUE
CHEM	化學	Chemistry	8	TRUE
BIO	生物	Biology	9	TRUE
ECON	經濟	Economics	10	TRUE
BAFS	企業、會計與財務概論	Business, Accounting and Financial Studies	11	TRUE
GEOG	地理	Geography	12	TRUE
HIST	歷史	History	13	TRUE
CHIST	中國歷史	Chinese History	14	TRUE
ICT	資訊及通訊科技	Information and Communication Technology	15	TRUE
```

> 以上是常見的 15 科 HKDSE 科目，作為起步的建議清單。請對照你學校實際
> 開設的科目，刪去用不到的、或加多學校特有的科目（例如某些學校的第二
> 外語科）。`code` 欄位是系統內部代號，改動時要連同學生的 `my_subjects`
> 一併更新，否則會出現「有記錄但對不上科目名」的情況。

### 4.4 加一個測試學生（部署驗證用，之後可刪除）

在 `students` 分頁 A2 貼上：

```
TEST001	測試學生	Test Student	6A	2026	test-1234						active
```

這是第 8 節驗證登入用的假帳戶，確認一切正常後可以刪除整行，或者把
`status` 改成 `inactive`。

---

## 5. 檢查分享設定（不設任何分享）

按右上角「共用」按鈕，確認：

- **沒有加入任何協作者**（除了你自己這個擁有者帳戶）
- 「一般access權限」設定為「限制」（即「知道連結的使用者」**不能**存取）

**原因只有一句話**：密碼是明文存放在這個試算表內，任何能開啟試算表的人
都能看到全部學生的密碼；而 Web App 是以**擁有者身分**執行讀寫（見第 6
節「執行身分＝我」），所以學生和老師用 app 時完全不需要對這個試算表有
任何權限——他們只是透過網址呼叫 Web App，Web App 代替他們去讀寫試算表。

---

## 6. 部署為網頁應用程式

1. 回到試算表，選單：**擴充功能 → Apps Script**。會開啟一個新分頁，
   顯示一個空白的程式碼編輯器。
2. 把編輯器內預設的內容（通常是 `function myFunction() {}`）全部刪除。
3. 打開本專案的 `gas/Code.gs`，全選、複製，貼進 Apps Script 編輯器。
4. **加入「Google Sheets API」進階服務（必要，不可省略）**：
   1. 按編輯器左側「服務」旁邊的 **＋**
   2. 在清單中找到 **Google Sheets API**，按 **加入**
   3. 這一步不需要另外到 Google Cloud Console 啟用任何東西——預設的
      Google Cloud 專案下，加入這個服務就會自動啟用對應的 API
   > 這一步是保護學生密碼安全的關鍵：後端寫入試算表時（例如存密碼、
   > 存反思、存評語）改用這個進階服務、而不是一般的儲存格寫入，理由
   > 是要防止有人在反思或評語裡打一句以 `=` 開頭的公式（例如
   > `=IMPORTXML(...)`），讓試算表在背景把整份資料（包括所有學生的
   > 明文密碼）外洩出去。**漏掉這一步，後端的每一次寫入操作（登入、
   > 存記錄、改設定、存評語）都會直接失敗**，`runSelfTest()` 或任何
   > 操作都會清楚提示「尚未啟用『Google Sheets API』進階服務」並附上
   > 補救步驟——如果看到這則訊息，回來檢查這一步有沒有做。這個失敗是
   > 安全的：後端在動用試算表資料之前就會先確認這項服務存在，不會因為
   > 漏做這一步而弄壞既有資料。
5. 按上方 **儲存**（磁碟圖示，或 `Ctrl+S`）。專案第一次儲存時會要求改
   專案名稱，隨便改成「DSE 溫習日誌後端」之類即可。
6. 按右上角藍色的 **部署 → 新增部署作業**。
7. 按「選取類型」旁邊的齒輪圖示，選 **網頁應用程式**。
8. 填寫：
   - **說明**：隨便填，例如「v1」
   - **執行身分**：選 **我**（你自己的帳戶）—— 這一步決定了 Web App
     用你的身分去讀寫試算表，學生不需要有試算表權限
   - **存取權**：選 **任何人** —— 這樣學生和老師的裝置不用登入 Google
     帳戶也能呼叫這個網址
9. 按 **部署**。

### 第一次部署會出現「未經驗證的應用程式」警告

因為這個 Apps Script 專案是你自己寫的（雖然程式碼是複製回來的），沒有
經過 Google 官方審核，所以第一次部署／授權時會跳出類似以下的畫面：

1. 彈出視窗要求「授權存取權限」，選你自己的 Google 帳戶
2. 出現「Google 尚未驗證這個應用程式」的警告畫面
3. 按畫面左下角的 **進階**（Advanced）
4. 按最下面的 **前往「DSE 溫習日誌後端」（不安全）**
   （英文介面會顯示 "Go to DSE 溫習日誌後端 (unsafe)"）
5. 再按 **允許**，授權它讀寫你的試算表

這是**正常現象**，因為這是你自己建立、只有你自己使用的工具，不是來歷
不明的第三方程式。如果看到這個畫面就卡住不敢繼續，是大部分非工程師
第一次部署 Apps Script 時都會停住的地方——放心點進階、點繼續即可。

---

## 7. 複製 `/exec` 網址

部署完成後，畫面會顯示一個網址，格式類似：

```
https://script.google.com/macros/s/AKfycb.../exec
```

**複製這整個網址**，貼到你自己的記事本暫存——目前 `js/api.js` 這個檔案
**還未建立**（要到 Task 11 才會建立），所以現在還沒有地方可以貼。等
`js/api.js` 出現後，打開它，找到類似這樣的一行：

```js
const GAS_URL = '';
```

把網址貼進單引號之間即可，例如：

```js
const GAS_URL = 'https://script.google.com/macros/s/AKfycb.../exec';
```

> 之後如果重新部署（例如改了 `Code.gs` 之後要更新），選「部署 → 管理
> 部署作業 → 編輯（鉛筆圖示）→ 版本選『新版本』→ 部署」，網址通常
> **不會變**；但如果是「新增部署作業」（而不是編輯現有的），會拿到一個
> **新網址**，記得也要更新 `GAS_URL`。
>
> ⚠️ **每次貼入新版 `Code.gs` 並重新部署前，請先確認「Google Sheets
> API」這個進階服務已經加入**（第 6 節第 4 步：Apps Script 編輯器左側
> 「服務」旁按「＋」→ 加入 Google Sheets API）。這一項不是選擇性的效能
> 優化，而是本後端寫入資料時用來防止公式注入攻擊的必要機制；若尚未
> 加入就重新部署並開始使用，第 8 節的 `runSelfTest()` 或任何寫入操作
> （登入、存記錄、改設定、存評語）都會直接失敗，且**沒有資料損毀
> 風險**——`writeRowsFor_()`（Task 22：以列為單位的精準寫入，取代舊版
> 整表覆寫的 `writeRows()`）已設計成在確認這項服務存在之前，不會觸碰
> 任何既有資料。真正需要提醒的重點是：確認這項服務存在，是讓後端能夠
> 正常運作的前提，不是事後才需要處理的細節。

---

## 8. 執行 `runSelfTest()`

> ⚠️ **執行前請先確認「Google Sheets API」進階服務已加入**（見第 6
> 節第 4 步、第 7 節的提醒）。若尚未加入，`runSelfTest()` 會安全地
> 在結果裡列出一則清楚指出這個缺漏、並附上補救步驟的問題訊息，**不會**
> 嘗試寫入或清空任何真實資料——這是刻意的設計：`runSelfTest()` 是老師
> 每次重新部署後用來確認系統安全的工具，必須本身在任何情況下都是安全
> 可執行的，不會因為忘記做前置設定而弄壞既有資料。

1. 回到 Apps Script 編輯器（`擴充功能 → Apps Script`）
2. 在編輯器上方，函式下拉選單（預設顯示 `doPost`）改選 **`runSelfTest`**
3. 按 **執行**（三角形圖示）
4. 第一次執行可能會再跳一次授權畫面，跟第 6 節一樣按「進階 → 前往…
   （不安全）→ 允許」
5. 執行完畢後，按選單 **執行項目 → 執行記錄**（或畫面下方的「執行記錄」
   分頁），查看輸出

**執行通過的樣子**：執行記錄顯示一行

```
✔ 自測全部通過
```

**沒通過的樣子**：執行記錄顯示

```
✘ 問題：
students 缺少欄位：cohort
config 缺少 key：exam_dates
...
```

每一行都是一個具體問題，對照第 9 節逐一修正，改完再執行一次
`runSelfTest()`，直到顯示「✔ 自測全部通過」為止。

### 手動驗證登入（建議一併做）

`runSelfTest()` 通過後，建議用第 4.4 節建立的 `TEST001` 測試一次真實登入。
待 `js/api.js` 完成（Task 11）後，前端會自動處理這件事；在此之前，
可以在瀏覽器任意分頁按 F12 開開發者工具，在 Console 貼上（記得把
`GAS_URL` 換成你第 7 節複製到的網址）：

```js
fetch('你的GAS_URL', {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify({ action: 'login', payload: { id: 'TEST001', password: 'test-1234' } })
}).then(r => r.json()).then(console.log);
```

**預期結果**：`success: true`，且回傳的物件裡有 `data.token`、
`data.actor`、`data.subjects`、`data.config`。

用錯誤密碼再試一次（例如把 `test-1234` 改成 `wrong`）：

**預期結果**：`success: false`，`error.code` 是 `"BAD_CREDENTIALS"`。

兩者都對，即代表後端已經可以正常運作，Task 7 完成。

### 手動驗證 `getPublicConfig`（T11 fix round 1，建議一併做）

同一個 Console，這次**不帶 `token`**（模擬使用者連登入畫面都未輸入帳密
就打開 app 的情況）：

```js
fetch('你的GAS_URL', {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify({ action: 'getPublicConfig', payload: {} })
}).then(r => r.json()).then(console.log);
```

**預期結果**：`success: true`，`data` 裡**只有**這 6 個 key：
`dse_start_date`、`exam_dates`、`quotes_zh`、`quotes_en`、`app_name_zh`、
`app_name_en`。**確認 `data` 裡沒有 `current_cohort`**，也沒有你在
`config` 分頁裡填過的任何其他 key——這是白名單真正生效的證據，不是巧合。

> **給日後維護的人（老師可以略過這段）**：`gas/test-local.mjs` 是一個選用
> 的開發者工具，用來在本機（不需要部署、不需要 Google 帳戶）快速檢查
> `Code.gs` 的 handler 邏輯是否正確，跑法是 `node gas/test-local.mjs`
> （純 Node 內建模組，不需要安裝任何東西）。**老師不需要、也不必執行
> 這個檔案**，它跟部署與驗收流程完全無關，只是給改 `Code.gs` 的人用來
> 及早抓出邏輯錯誤。

---

## 9. 系統如何處理並行寫入

全班學生幾乎在同一分鐘內登入，是完全正常且會實際發生的情況。後端在每一次
「讀出分頁資料 → 在記憶體判斷要改哪幾列 → 寫回」的操作（例如登入時寫入
`session_token`）前後都會取用同一把系統鎖，令這些操作逐一排隊執行，
確保後寫入的一方不會用自己讀到的舊資料，悄悄覆蓋另一位使用者剛寫入的
變更。

**Task 22（`writeRowsFor_`）之後，波及範圍已從「整個分頁」縮小到「這個
使用者自己那幾列」**：例如學生登入只會就地覆寫 `students` 裡自己那一
列，不再連帶整批覆寫全班的密碼；`saveDay` 也只動該學生該日對應的
1–5 列。鎖仍然存在，但理由要分兩種 handler 分開講，不能一概而論：

- **`saveDay`／`clearDay`（一次可能動用多列、可能觸及 `blanks`）**：
  即使兩位學生編輯的是完全不同的列，兩人的請求仍然可能同時讀到同一份
  「哪些列是空白、可以重用」的判斷結果，若不排隊，可能出現兩個人都以為
  自己拿到了同一個空位、其中一人的資料被另一人蓋掉。
- **`handleLogin`／`handleLogout`／`handleUpdateSettings`（每次一定只動
  1 列，`keyPredicate` 只會命中呼叫者自己那一列，從來不會走到 `blanks`
  那條路，兩個不同帳號的請求本來就不會碰到同一列）**：這幾個 handler
  的鎖不是為了防空位搶占，而是傳統的**遺失更新（lost update）**——寫回
  的那一列內容，是鎖外某一刻讀到的整列快照加上這次要改的欄位拼出來的；
  若鎖只包住 `writeRowsFor_` 本身，這份快照跟寫回之間若有另一個並發
  請求改了同一列的其他欄位（例如同一帳號幾乎同時觸發 `updateSettings`
  改密碼、又觸發 `login` 寫入新的 `session_token`），較晚寫回的一方會用
  自己那份舊快照把對方剛寫入的欄位悄悄蓋掉。

兩種理由都要記住：**不要因為某個 handler「從來不會用到空位」，就以為它
的鎖可以拿掉**——它可能是靠鎖擋遺失更新，不是靠鎖擋空位搶占。鎖把「讀
→判斷／組列→寫」整段序列化，持鎖時間也因為每次只處理少數幾列而變得
更短。

一般情況下，這個排隊只會延遲以毫秒計，使用者不會察覺。唯一會被
察覺的情況，是短時間內排隊的請求多到某一個請求等了 10 秒仍拿不到鎖：
此時該次請求會直接失敗，回應 `error.code` 為 `"LOCKED"`、訊息為
「系統繁忙，請稍後再試」，前端應提示使用者稍後重試（而不是回報登入
失敗或資料遺失）。這是刻意設計的行為，避免請求無限期卡住直到觸發 Apps
Script 本身的執行時間上限。

---

## 9.1 資訊性附註：`batchUpdate` 的原子性——設計已不依賴，不需要驗證

早期版本（Task 22 fix round 1）曾經把 `writeRowsFor_` 的覆寫、清空、
追加合併成單一 `Sheets.Spreadsheets.Values.batchUpdate()` 呼叫，安全性
靠著「這個呼叫要嘛整批套用、要嘛整批不生效」這個**假設**撐著——但
Google 對 `spreadsheets.batchUpdate`（結構性請求）的原子性保證，跟本
專案用的 `spreadsheets.values.batchUpdate`（純粹寫值）是不同方法，
官方文件沒有講後者在多個 range 之間能不能部分套用。

曾經想過設計一個 live 測試去驗證：送一筆合法 range + 一筆故意超出格線
的 range，看合法那筆有沒有被套用。這個測試方法**被推翻了**，原因不是
懶得跑，而是它證明不了它想證明的事——超出格線的 range 是 Google 在
**送出請求階段**就會擋下來的經典案例，測出「合法那筆也沒套用」時，
分不清是因為「真的原子」還是因為「整個請求根本沒被受理」；它只能在
測出「合法那筆有套用」時證明「不是原子」，測不出「原子」。找一個
「通過驗證、卻在套用階段失敗」的輸入，是在對一個內部行為未公開的 API
做研究，沒有保證會有答案。

**現行設計（fix round 2 起）已經不需要知道答案**：`writeRowsFor_` 把
「寫入真實內容」（覆寫／空位重用／追加）跟「清空多餘 matched 列」拆成
兩次獨立的 `batchUpdate` 呼叫，先寫、確認成功後才清。不管
`values.batchUpdate` 是不是原子、也不管同一次呼叫內 `data[]` 的多個
range 會不會按陣列順序套用，最壞情況都只會是「該清的沒清乾淨」（多餘、
看得見、下次存檔會自動清掉），不會是「內容還沒寫、對應的舊列卻已經被
清空」。細節與失敗矩陣見 `Code.gs` 的 `writeRowsFor_` 文件註解「兩次
呼叫、不依賴原子性」一節。

⚠️ **這一節保留純粹是為了紀錄脈絡，不是待辦事項**：不需要為了這個問題
另外安排 live 測試；也請不要因為「少一次 HTTP round-trip」而把這兩次
呼叫「優化」合併回一次——那樣做等於把安全性重新綁回一個沒有證據、也
不打算去驗證的平台行為假設。

---

## 9.2 已查明的平台行為：同一次執行內，`SpreadsheetApp` 讀不到剛透過 REST 寫入的內容

> Task 22 fix round 3–5 的完整診斷過程（DIAG1–DIAG5 各階段的假設、
> 程式碼、live 輸出、逐輪推翻與收斂）記錄在 task-22-report.md，這裡
> 只保留結論——機制、證據、修法、以及為什麼不能用 `flush()`。診斷用的
> 暫時性函式已經跑完階段性任務，不再保留在這份文件裡。

### 現象

老師重新部署後，用公開 API 手動測試（`saveDay` 存 2 筆 → `getMonth`
讀到 2 筆 → 改存 1 筆 → `getMonth` 讀到 1 筆 → `clearDay` → `getMonth`
讀到 0 筆）完全正確；但 `runSelfTest()` 曾經回報「saveDay 未寫入預期
列數」「saveDay 未整批覆寫舊列」。

### 已確立的機制（live 證據，不是假設）

**同一次 Apps Script 執行內，經 Sheets 進階服務（REST）寫入過的分頁，
`SpreadsheetApp` 讀不到那次寫入的內容——但格線的維度（列數）讀得到。**

- 對一次單純的 REST 寫入（純追加，沒有空位重用），四種讀法（沿用寫入前
  就存在的 `SpreadsheetApp` handle、`openById()` 重新開的全新 handle、
  直接用 REST 讀回、`flush()` 之後用原本 handle 讀）全部立刻看到內容——
  這個情況下沒有問題。
- 對一次「混合空位重用與追加」的 REST 寫入（同一批 `data[]` 裡，一個
  range 覆寫既有列、一個 range 追加新列），沿用寫入前就存在的
  `SpreadsheetApp` handle 讀到的內容是空的（0 列），但 REST 讀回、
  `flush()` 之後讀、`openById()` 重新開的 handle 讀，全部正確看到 2
  列——**維度（列數）三種讀法都一致，只有內容過期**。
- 這個「維度新鮮、內容過期」的組合正是最容易忽略的地方：讀到的陣列
  長度是對的（看起來確實涵蓋了新寫入的列），內容卻是空字串，讓
  `writeRowsFor_`／`readSheet()` 判斷「第一欄空白＝已刪除」的邏輯把
  剛寫入的合法列誤判成空位。這正是 `runSelfTest()` 偽陽性、以及
  `writeRowsFor_` 在同一次執行內被呼叫第二次時清空操作「沒有效果」的
  根本原因——`matched` 從一開始就是空的，清空只是下游症狀。
- 這個機制**不是**「空位重用本身有 bug」：直接攔截 `writeRowsFor_`
  本尊實際送出的 `data[]`，range／values 都正確，Google 的 API 回應
  也正常（`totalUpdatedCells` 對得上、REST 立刻讀得到）；問題完全在
  「後續同一次執行內，用 `SpreadsheetApp` 讀」這一步。

### ⚠️ 已明確排除的修法：`SpreadsheetApp.flush()`

`flush()` 之後讀取曾經顯示「新鮮」，但那次觀察有 confound：`flush()`
生效／前一步的 REST 讀取本身順手刷新了快取／單純時間經過，三者無法
區分（那次觀察裡，`flush()` 是接在一次 REST 讀取之後才呼叫的，不能排除
是那次 REST 讀取本身順手刷新了快取，或純粹是時間經過）。`flush()` 官方
文件講的是「套用所有待處理的 Spreadsheet 變更」，指的是 `SpreadsheetApp`
自己發起、尚未送出的寫入，不是「重新整理其他來源（REST）造成的外部
變更」——語意上就不是同一件事。**不要因為省一次 HTTP round-trip 就把
讀取改回 `flush()`**：那等於把正確性重新綁在一個沒有證據的平台行為
假設上，跟 fix round 2 放棄 `batchUpdate` 原子性假設是同一個原則。

### 修法

`writeRowsFor_` 判斷 matched／blanks 前的那次讀取，以及 `runSelfTest()`
的整批覆寫往返驗證，全部改用直接透過 REST（`Sheets.Spreadsheets.
Values.get`）讀取，不經過 `SpreadsheetApp`——見 `Code.gs` 的
`getDataRangeViaRest_()`／`readSheetFresh_()`，以及 `readSheet()`
上方那則完整的不變式說明。`sh.getMaxRows()`／`sh.insertRowsAfter()`
（格線維度操作）維持用 `SpreadsheetApp`，因為 live 證據顯示維度是
新鮮的，只有內容過期，沒有理由連這兩個也換掉。

**跨執行的一般讀取不受影響、不需要改**：`handleGetMonth`／
`handleGetWeeklyReport`／`handleGetClassOverview` 等每一次都發生在
全新的一次 `doPost()` 執行，那個時間點的 `SpreadsheetApp` 本來就沒有
任何過期的內容快取，繼續用 `readSheet()` 完全沒有問題。生產稽核（見
task-22-report.md「Fix round 3」）確認過：六個正式 handler 沒有一個
會在同一次執行內、寫過某個分頁之後又讀回同一個分頁——`handleSaveDay`／
`handleClearDay` 寫 `records_<cohort>` 跟 `days_<cohort>` 兩個不同
分頁，`days_<cohort>` 在那次執行裡是第一次被碰到，不是「重讀」，不
構成這個風險。唯一命中這個模式的地方是 `runSelfTest()` 自己（連續呼叫
兩次 `handleSaveDay`、中間穿插驗證讀），已經修好。

---

## 10. 疑難排解

| 徵狀 | 原因 | 解法 |
| :--- | :--- | :--- |
| 任何操作（登入、`runSelfTest()`、存記錄……）失敗，錯誤訊息提到「尚未啟用『Google Sheets API』進階服務」 | 忘記加入「Google Sheets API」進階服務（第 6 節第 4 步） | 回到 Apps Script 編輯器，左側「服務」旁按「＋」，加入 **Google Sheets API**，存檔後重新部署（部署 → 管理部署作業 → 編輯 → 新版本 → 部署）。這個失敗不會弄壞既有資料，看到這則訊息不需要擔心資料損毀，補做這一步、重新部署即可 |
| `runSelfTest()` 顯示「缺少分頁：xxx」 | 分頁名稱打錯字，或漏建了一個分頁 | 對照第 2 節，分頁名稱必須一字不差（含大小寫、底線） |
| `runSelfTest()` 顯示「xxx 缺少欄位：yyy」 | 表頭文字打錯、多了空格、或漏了一欄 | 打開該分頁，比對第 2 節的表頭，逐字檢查（尤其容易漏打底線 `_`） |
| `runSelfTest()` 顯示「config 缺少 key：xxx」 | `config` 分頁少了一行，或 `key` 欄打錯字 | 對照第 4.2 節，`key` 欄必須完全是 `current_cohort`、`dse_start_date` 等字，不可有多餘空格 |
| `runSelfTest()` 顯示「學號與教師編號重複：xxx」 | 同一個 ID 同時出現在 `students.student_id` 和 `teachers.teacher_id` | 改其中一個，令兩邊沒有重複值 |
| `runSelfTest()` 顯示「students 有重複的 student_id」、「teachers 有重複的 teacher_id」或「subjects 有重複的 code」 | 同一分頁內有兩行用了同一個 ID／代號 | 檢查該分頁，刪除或修正重複的一行；`teachers` 出現重複尤其需要留意：`findRowIndex_` 只會找到第一筆相符的列，被排在後面的那位老師會一直無法登入，而在加入這項檢查之前，`runSelfTest()` 完全不會提示這個問題 |
| 執行 `runSelfTest()` 時彈出「授權存取」或「未經驗證的應用程式」畫面 | 第一次執行任何函式都需要授權 | 跟第 6 節做法一樣：進階 → 前往「…」（不安全）→ 允許 |
| 登入永遠回傳 `BAD_CREDENTIALS`，明明密碼打對 | 常見原因：`students`／`teachers` 的 `status` 欄不是 `active`（例如打成 `Active` 大寫開頭、或留空） | 檢查 `status` 欄必須是小寫的 `active` |
| 登入後不久又要重新登入 | `token_expiry` 判斷用的是伺服器現在時間，如果 `dse_start_date` 等日期欄本身沒問題，通常是巧合過了 30 天 | 正常現象（Token 30 日到期），重新登入一次即可 |
| 儲存記錄後，之後讀月曆看不到剛存的資料 | 最常見原因：`date` 欄沒有設為「純文字」，Google 把日期自動轉成日期物件，令系統的文字比對對不上 | 回到第 3 節重做一次「格式 → 數字 → 純文字」；**注意**：如果在設定純文字之前已經寫入了會被自動轉換的資料，要先把那些格開的日期資料刪除重新以文字方式輸入 |
| 新增一行學生／科目後，系統好像看不到這行 | 該行第一欄留空（例如 `students` 的 `student_id` 沒填），系統會把第一欄空白的列當成空白列略過 | 確認每一行資料的第一欄（key 欄）都有填值：`students` 是 `student_id`，`teachers` 是 `teacher_id`，`subjects` 是 `code` |
| `exam_dates` / `quotes_zh` / `quotes_en` 相關功能顯示錯誤或空白 | `config` 內對應的 `value` 不是合法 JSON（漏引號、漏逗號、用了中文全形引號「」代替英文引號 `"`） | 對照第 4.2 節的範例格式重新輸入，特別注意引號必須是半形英文 `"`，不能用中文輸入法打出來的全形引號 |
| 部署後 `/exec` 網址打開顯示「Google Apps Script」空白頁或錯誤 | 屬正常：`/exec` 是給前端 `fetch POST` 呼叫的，用瀏覽器直接打開（等於 `GET`）不會有正常畫面 | 不用理會，改用第 8 節的 `fetch` 方式測試，或直接等前端（Task 11 之後）完成後用 app 測試 |
| 改完 `Code.gs` 後，行為好像沒有變 | 用「新增部署作業」建立過新版本，但前端仍在用舊網址；或者忘記部署新版本 | 選「部署 → 管理部署作業 → 編輯 → 版本選『新版本』→ 部署」；若網址有變，記得更新 `js/api.js` 的 `GAS_URL` |
| 回應的 `error.code` 是 `"LOCKED"`，訊息「系統繁忙，請稍後再試」 | 短時間內有太多讀-改-寫的請求（例如全班同一分鐘登入）在排隊，該次請求等了 10 秒仍未輪到，見第 9 節 | 屬正常保護機制，不是資料損壞；請使用者稍後重試一次即可。若經常出現，代表使用人數已超出單一 Google Sheet 後端在尖峰時段能負荷的範圍，屬 Phase 2 才需處理的規模問題 |

---

## 完成之後

以上全部步驟做完、`runSelfTest()` 顯示「✔ 自測全部通過」、手動登入測試
也成功，Task 7 的部署部分即告完成。之後的 Task 8、Task 9 會在
`Code.gs` 加入更多功能（記錄讀寫、週報、老師總覽），每次更新完 `Code.gs`
內容後，記得重新貼上並「部署 → 管理部署作業 → 編輯 → 新版本 → 部署」。
