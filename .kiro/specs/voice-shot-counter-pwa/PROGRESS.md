# voice-shot-counter-pwa 進捗・申し送り

## 進捗

- **実装タスク 98 件すべて完了**（tasks.md のチェックボックスが正。未チェックは 0 件）。
- チェックポイント 9（純粋関数コアの検証）／13（メイン画面での計測成立）／22（最終）を通過。
- テスト: **106 件すべて通過**（Correctness Property 17 件 + 単体・DOM 検証）。
  - `node test/run-node.js` … 84 passed / 0 failed（spec-dom.js を除く）
  - `test/tests.html`（file://、ヘッドレス Chrome）… 84 passed / 0 failed、未捕捉例外なし
  - `test/tests.html`（`node test/serve.js` 経由）… **106 passed / 0 failed**（spec-dom.js の 22 件を含む）
  - シード 3 / 101 / 55555 / 987654 / 986462863 などで再実行して安定を確認

## 成果物（7 ファイル）

| ファイル | 内容 |
|---|---|
| `index.html` | 3 パネル（メイン / 履歴 / メニュー編集）の DOM、インライン CSS（13 節構成・CSS カスタムプロパティ駆動・縦/横/低解像度の 3 分岐）、PWA メタ情報、id 契約コメント |
| `app.js` | 全ロジック（約 7,000 行の単一 IIFE。うち約半分が設計・要件との対応を示すコメント）。外部オリジン参照ゼロ、`import` / `export` なし |
| `manifest.json` | name / short_name / start_url / scope / display / orientation / colors / 192・512 アイコン |
| `sw.js` | precache（7 ファイル）+ ナビゲーション network-first（3 秒）+ 同一オリジン cache-first |
| `icon-192.png` / `icon-512.png` / `apple-touch-icon-180.png` | 実 PNG バイナリ |

`app.js` の構成:

- 節 1 定数 … `DRILL_MENU` / `LIMITS` / `COMMAND_TABLE` / `EXCLUSION_WORDS` / `THEME` / `SCHEMA_VERSION` / `LAYOUT_PORTRAIT_LONG_MIN` / `createDefaultMenu` / `nextDrillId`
- 節 2 純粋関数（Property 1〜17 の検証対象）
  - 2-1 `normalizeText` / `buildExclusionMask` / `selectCommand` / `restartDelay`
  - 2-2 `applyCount` / `undoCount` / `successRate` / `totals`
  - 2-3 `cursorReducer` / `reindexAfterMenuChange` / `reorderDrills` / `removeDrill` / `addDrill` / `purgeDrillCounts` / `addDrillCounts` / `reorderCounts`
  - 2-4 `serializeSession` / `deserializeSession`（+ `initialSessionState` / `reconcileWithMenu` / `SESSION_FIELDS`）
  - 2-5 `serializeMenus` / `deserializeMenus` / `validateMenu` / `deriveTargetTotal`
  - 2-6 `elapsedFrom` / `formatElapsed` / `progressRatio` / `aggregateBySection` / `formatRate` / `sortHistoryIndex` / `layoutModeFor` / `buildHistoryRecord` / `formatEndedAt` / `isoLocalFrom`
- 節 3 副作用シェル … `createStorageAdapter` / `createPersistenceCoordinator` / `createCountManager` / `createCursorManager` / `createMenuManager` / `createMenuEditorView` / `createCommandDispatcher` / `createSpeechRecognizer` / `createWakeLockManager` / `createThemeManager` / `createSessionTimer` / `createRenderer` / `createDisplayPanel` / `createHistoryView` / `registerServiceWorker`
- 節 4 `window.__VSC_TEST__`（純粋関数 43 個 + 読み取り専用定数）
- 節 5 `bootstrap()`（テーマ → メニュー復元 → セッション復元 → 初回描画 → SW 登録）

## テストファイル（配布対象外）

`test/` は成果物 7 ファイルに含まれず、`sw.js` の `PRECACHE` にも列挙しない。

- `pbt.js` … 自作 PBT ハーネス（生成器・縮小器・固定シード）
- `assert.js` … `deepEqual` / `ok` / `throwsNot`
- `tests.html` … ランナー（`?seed=<整数>` でシード固定）
- `spec-count.js` / `spec-serializer.js` / `spec-cursor.js` / `spec-timer.js` / `spec-command.js` / `spec-display.js` … Property 1〜17
- `spec-unit.js` … 例示・境界値テスト（44 件）
- `spec-dom.js` … DOM 層の検証（静的サーバー必須）
- `run-node.js` … Node 用ランナー（開発用）
- `serve.js` … 最小の静的サーバー（開発用）

## 実行方法

```
node test/run-node.js                      # spec-dom.js 以外の全件
node test/run-node.js spec-serializer.js   # 個別実行
VSC_SEED=12345 node test/run-node.js       # シード固定

node test/serve.js                         # 静的サーバー（既定 8731）
#   → http://127.0.0.1:8731/test/tests.html  で spec-dom.js を含む全件
#   → http://127.0.0.1:8731/index.html       でアプリ本体（Service Worker 有効）
```

アプリ本体は `file://` でも動作する（Service Worker のみ無効になり、その旨を表示する）。

## 申し送り（設計・要件に対する解釈と既知の判断）

1. **`window.__VSC_TEST__` の公開内容は設計の一覧より広い**。追加分はいずれも 2 節の純粋関数または読み取り専用定数であり、公開方針（ファクトリ関数・DOM 参照・localStorage ラッパを公開しない）には反しない。
   - `reorderDrills` / `removeDrill` / `addDrill` / `purgeDrillCounts` / `addDrillCounts` / `reorderCounts`（Property 11 の対象）
   - `layoutModeFor` / `buildHistoryRecord` / `makeHistoryId` / `formatEndedAt` / `isoLocalFrom`（タスク 12.7 / 18.4 / 19.3 の対象）
   - `createDefaultMenu` / `DRILL_MENU` / `THEME` / `SCHEMA_VERSION` / `SESSION_FIELDS`
2. **副作用シェルのファクトリは `__VSC_TEST__.shell` に、テストランナー配下でのみ公開する**。判定は `window.__VSC_LOAD_CONTEXT__` の存在（tests.html / run-node.js が app.js より前に設定する変数）で行うため、**index.html 経由の本番起動では `shell` は一切代入されない**。タスク 10.5 / 11.5 / 11.6 / 14.3 / 15.2 / 17.3 / 18.4 / 19.3 / 12.8 はこの入口を使う。
3. **`Storage_Adapter` の 2 つのシグネチャは設計と異なる**。
   - `loadSession(menu)` … 選択中メニューを引数に取り、`{state, issues}` か `null` を返す（reconcile に種目 id 集合が必要。要件 1-10 / 6-10 / 6-11）
   - `listMenus()` … `{menus, issues}` を返す（要件 13-14 のメッセージ表示に除外の事実が必要）
4. **`guarded` の 1000ms 締切は `setTimer` / `clearTimer` を注入して検証する**。`localStorage` は同期 API なので実運用では締切に到達しないが、要件 12-2 の保証は将来の `fetch` 差し替えでそのまま効く必要がある。
5. **レンダラは rAF に加えて保険のタイマー（既定 100ms / 省電力時は描画バジェット）を張る**。ヘッドレスブラウザや非可視タブでは `requestAnimationFrame` が間引かれて描画を取りこぼすため。トークン判定で二重描画は起きず、省電力時の「毎秒 5 回以下」（要件 10-4）も維持される。
6. **`addDrill` の `reservedIds` は「セッション中に一度でも使った種目 id の高水位」**。`Count_Manager.getReservedIdHigh()` が保持し、`Menu_Editor_View` が追加時に渡す。これがないと最大 id の種目を削除した直後の追加で削除済み id を再利用する（Property 11 が検出した）。
7. **要件書に 13 種目の具体名が無い**。requirements.md 要件 1 は集約制約（13 種目 / セクション別 20・40・30・35 / 総計 125 / id 1〜13）のみを規定しており、種目名は `app.js` の `DRILL_MENU` が唯一の正。タスク 2.2 の単体テストはこの集約制約を全列挙で検証している。
8. **`sw.js` は意図的に `skipWaiting()` / `clients.claim()` を呼ばない**。練習セッション中に app.js とキャッシュ資産のバージョンが混在するのを避けるため。
9. **確定させた解釈**（コード内コメントにも記載）:
   - 正規化の切り詰めはコードポイント単位かつ UTF-16 長も 200 以下
   - 除外語マスクは 1 文字でも重なる出現を選択しない
   - `counts` の正規形は `{id, make, attempt}` の配列（id 索引は `getCounts()` の射影）
   - 操作履歴 20 件超過で除去された操作は以後取り消せない
   - `Session_State.startedAt` は「未開始」を `null` で表す
   - 旧版スキーマでも**存在するフィールドは値域検証の対象**（Property 7 の「常に妥当な状態」と矛盾させないため）
   - 値域違反は初期状態へ落とす（要件 13-10）が、メニュー id 集合との不整合は `reconcileWithMenu` が修復して `issues` に記録するだけ（要件 1-10 / 6-10 / 6-11）
   - メニュー / 種目の「文字数」はコードポイント単位（絵文字 1 個 = 1 文字）
   - `deserializeMenus` は 21 件目以降を `MENU_COUNT_RANGE` として除外し先頭 20 件を採る
   - `sortHistoryIndex` の `endedAt` は数値（epoch ms）と ISO 8601 文字列の両方を受け付け `Date.parse` で数値化する
   - `deriveTargetTotal` は `validateMenu` が依存するため 2-5 に置く（2-6 で再定義しない）
   - 初回起動（保存データなし）で既定メニューを生成するのは正常動作なので `issues` に積まない（要件 18-5）
   - 振動（要件 4-10）の判定は「直前 < targetMake かつ 今回 ≥ targetMake」。省電力バジェットで描画がまとまり Make が目標を飛び越えても 1 回だけ鳴る
   - 要件 8-9 / 8-10 / 8-11 の「スクロールなし表示」対象は 6 項目・メニュー名・全体進捗テキスト・全体進捗バー・5 個の操作ボタン。全カウント初期化ボタンとフィードバック領域は列挙に含まれない

## 実機フィードバックによる変更

### 「イン」が聞き取られない（2026-09-25 報告）

「アウト」は安定して認識されるが「イン」が拾えない、という実機報告への対応。

**原因**: 純粋関数層（`normalizeText` → `selectCommand`）は「イン」「いん」「ｲﾝ」を正しく MAKE と判定する
（検証済み）。問題は認識エンジンの出力側にある。
「イン」は 2 モーラしかないため、日本語の言語モデルが「印」「員」「陰」「ポイント」「サイン」といった
より一般的な語へ寄せてしまう。正規化は漢字を読みへ変換しないので「印」は命令にならず、
「ポイント」「サイン」は除外語（要件 3-10）でマスクされるため、どちらの経路でも命令にならない。
一方「アウト」は 3 モーラで同音語が少ないため寄せられにくい。

**対応**:

1. **`maxAlternatives` を 1 → 5 にし、確定結果の全候補を上位から順にコマンド判定する**
   （`MAX_ALTERNATIVES`）。第 1 候補が「印」でも第 2 候補に素直な「イン」が入っていれば拾える。
   語彙を触らないため誤検出リスクがゼロの対策であり、これが本質的な改善。
   表示は第 1 候補を出しつつ、命中した候補が異なる場合は `matched` として併記する
   （「印（イン と解釈）」）。
2. **MAKE の語彙に 4 語を追加**: `はいった` / `ナイス` / `成功` / `決まった`。
   - `はいった` は「入った」のひらがな表記。要件 3-2 の「外れた / はずれた」、
     要件 3-5 の「やり直し / やりなおし」と同じ「漢字表記とひらがな表記を対で登録する」方針に沿う
     （要件 3-1 だけがこの対を欠いていた）。
   - `ナイス` / `成功` / `決まった` は 3 モーラ以上で誤認識しにくい言い換え。
   - いずれも既存の除外語と衝突せず、**除外語の追加を要さない**。要件 3-10 が除外語の上限を
     32 語と定めており現在 31 語なので、除外語を必要とする語（「印」「員」などの同音漢字や
     ASCII の `in`）は**追加しない**という判断をした。`印` を語彙に入れると
     「会員」「印象」「矢印」などの除外語が必要になり上限に収まらない。

**要件との関係**: 要件 3-1〜3-5 は「これらの語を含むときコマンドを発行する」という形であり、
語彙の追加はいずれの SHALL にも反しない。単体テストには「要件が名指しする語がすべて語彙に含まれる
（追加は許容、欠落は不可）」という検証を追加した。

**残る注意**: 連続で決めたときに早口で「イン、イン」と言うと、要件 3-7 の同一種別 800ms 抑止により
1 回しか数えない。これは要件どおりの動作であり、README に「1 本ずつ間を置いて言う」と明記した。

---

### 目標本数の到達で次の種目へ自動遷移（2026-09-25 要望）

「ゴール下セットシュートが完了したら自動的にショートミドルに遷移してほしい。スマホを一度も
触らずに記録できるように」という要望への対応。**要件 6-9 の変更を伴う**。

**要件変更**: 旧 6-9 は「targetMake 到達はアクティブ種目を変更する事象ではない」と明記していた。
これを「到達で次種目へ自動遷移する」へ改め、6-9-a（最終種目では留まる）と
6-9-b（targetMake を超える加算では遷移しない）を追加した。requirements.md 冒頭に Change Log を新設。

**実装場所**: `Command_Dispatcher`（節 3-5）。
到達の判定には「カウント」と「種目定義（targetMake）」の両方が必要で、両方を同時に知るのは
ディスパッチャだけである。Cursor_Manager はカウントを参照しない設計を保ったまま、
「次へ」コマンドと同じ `next()` を呼ばれる形にした（自動遷移と手動遷移で規則が分岐しない）。

**判定条件**: `command === 'MAKE'` かつ `加算前の Make < targetMake` かつ `加算後の Make >= targetMake`。
「到達の瞬間をまたいだか」で判定するので、
- 超過分の加算では遷移しない（要件 4-11 の超過保持と両立）
- 「戻る」で完了済みの種目に戻って加算しても遷移しない（加算前が既に targetMake 以上）
- 最終種目では `next()` が `AT_LAST` を返すが、これは拒否ではないのでメッセージを出さない

**付随**: 遷移先の種目名をフィードバック領域に提示する（`DRILL_COMPLETED`）。
振動（要件 4-10）は従来どおり到達時に 1 回鳴るため、視覚と触覚の両方で切り替わりが分かる。

**無効化**: `createCommandDispatcher({ autoAdvanceOnComplete: false })` で従来動作に戻せる
（テストで両方の分岐を検証している）。UI からの切り替えは用意していない。

**未対応（要判断）**: 取り消し（要件 5-3）は「アクティブ種目を取り消し前の種目として維持する」と
定めているため、自動遷移の直後に「リセット」と言うと、カウントは前の種目に戻るがカーソルは
遷移先に留まる。声だけで「戻る」と言えば復帰できるのでハンズフリーは崩れないが、
「取り消しで、取り消した操作の種目へカーソルを戻す」方が自然という判断もありうる。
要件 5-3 の変更を伴うため未実施。

---

## 残っている確認（実機・手動が必要なため自動テストの対象外）

設計の「実機手動確認が必須な項目」「オフライン・キャッシュ更新の確認手順」に対応する。

1. **実機の音声認識**: iOS Safari / Android Chrome での `SpeechRecognition` の挙動（連続認識の実際の停止頻度、`onend` の発火間隔、マイク許可ダイアログ）。
2. **Wake Lock**: 実機で画面が消灯しないこと、可視復帰で再取得されること。
3. **オフライン起動**: DevTools の Network を offline にしてリロード → 3 秒以内に表示されること（要件 15-5）。
4. **キャッシュ更新**: `app.js` を変更 → リロード → タブを閉じて再度開く、で新バージョンに入れ替わること（`skipWaiting()` を呼ばない設計のため 2 段階になる）。
5. **ホーム画面追加**: iOS / Android で manifest とアイコンが正しく扱われること。
6. **遠距離視認**: 実機を床に置いて立った位置から Make が読めること（文字高の要件は自動検証済みだが体感の確認）。
