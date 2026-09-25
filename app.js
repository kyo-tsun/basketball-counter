/*
 * Voice_Counter_App — app.js
 *
 * 全アプリケーションロジックを収める単一のクラシックスクリプト。
 * 要件 16-2: `import` / `export` を含めず、`<script src="./app.js">`（type 属性なし）
 * から読み込まれる前提で記述する。ビルド工程・トランスパイル・バンドルを経ない
 * （要件 16-4）ため、ブラウザがそのまま解釈できる構文のみを用いる。
 *
 * ファイル全体を 1 個の IIFE で包み、グローバルスコープを汚染しない。
 * 例外は `window.__VSC_TEST__` の 1 個のみで、その内容は純粋関数の参照と
 * 読み取り専用定数に限定する（ファクトリ関数・DOM 参照・localStorage ラッパは公開しない）。
 *
 * === 本ファイルの構成（各節は対応するタスクで充填される） ===
 *   1. 定数領域                 … タスク 2.1
 *   2. 純粋関数領域             … タスク 4.1 / 5.1 / 6.1 / 7.1 / 7.2 / 8.1
 *   3. 副作用レイヤ領域         … タスク 10.x / 11.x / 12.x / 14.x / 15.x / 16.1 / 17.1 / 18.x / 19.x / 20.4
 *   4. テスト公開フック         … タスク 21.1（本タスクでは空の器のみ宣言）
 *   5. bootstrap()              … タスク 21.1
 *
 * === DOM 要素 ID に関する前提 ===
 * 本タスク（1.2）は DOM を一切参照しない。DOM 参照の取得はタスク 12.x 以降が
 * 担当し、index.html（タスク 1.1）が定義する要素 ID を唯一の正とする。
 * 本ファイルは現時点で index.html の具体的な ID に依存していないため、
 * 骨格の読み込み順や ID 命名の変更によって壊れることはない。
 */

(function () {
  'use strict';

  /* ==========================================================================
   * 1. 定数領域
   * --------------------------------------------------------------------------
   * この節の値はすべて読み取り専用（deepFreeze 済み）であり、実行中に変更されない。
   * 唯一の例外は createDefaultMenu() の戻り値で、これは編集対象になる
   * Menu_Record を新規に組み立てて返す（DRILL_MENU 自体は複製元として不変）。
   *
   * 注意: 目標合計は常に選択中メニューの targetMake の総和として算出し、
   *       リテラル 125 を算出経路に埋め込まない（前提 7 / 要件 17 / 要件 18）。
   *       本節が持つ 125 はメニュー名「朝練125本IN」の文字列内のみであり、
   *       これは表示用の名称であって算出には一切用いない。
   * ========================================================================== */

  /**
   * オブジェクト / 配列を再帰的に凍結する。
   * 読み取り専用定数（要件 1-1）を実行時に保証するために用いる。
   */
  function deepFreeze(value) {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
      return value;
    }
    var keys = Object.keys(value);
    for (var i = 0; i < keys.length; i++) {
      deepFreeze(value[keys[i]]);
    }
    return Object.freeze(value);
  }

  /* ---- 1-1. 現行スキーマバージョン（要件 13-3）--------------------------- */

  var SCHEMA_VERSION = 1;

  /* ---- 1-2. LIMITS: 値域と上限（要件 1-2, 4-3, 5-1, 11-9, 14-5, 17-4, 18-3）
   * すべて「その値自体が許容される」閉区間の端点として定義する。
   * ここに集約する理由は、同じ数値が検証（7.2）・カウント遷移（5.1）・
   * 正規化（4.1）・履歴退避（11.2）の各所に散らないようにするため。
   * ---------------------------------------------------------------------- */

  var LIMITS = deepFreeze({
    // カウント（要件 4-3, 4-4, 4-13）
    COUNT_MIN: 0,
    COUNT_MAX: 999,

    // 操作履歴（要件 5-1, 5-6, 13-3）
    OPERATION_HISTORY_MAX: 20,

    // 種目数 N（要件 17-4, 13-13）
    DRILL_COUNT_MIN: 1,
    DRILL_COUNT_MAX: 50,

    // 種目の属性（要件 1-2, 17-4）
    DRILL_NAME_MIN: 1,
    DRILL_NAME_MAX: 40,
    DRILL_SECTION_MIN: 0,
    DRILL_SECTION_MAX: 20,
    TARGET_MAKE_MIN: 1,
    TARGET_MAKE_MAX: 99,

    // 目標合計（派生値。要件 17-4, 13-13）
    TARGET_TOTAL_MIN: 1,
    TARGET_TOTAL_MAX: 9999,

    // メニュー（要件 18-3, 13-13）
    MENU_COUNT_MIN: 1,
    MENU_COUNT_MAX: 20,
    MENU_NAME_MIN: 1,
    MENU_NAME_MAX: 30,

    // 履歴レコード（要件 14-5, 14-6）
    HISTORY_MAX: 100,

    // 経過時間（要件 11-9, 13-3）
    ELAPSED_SEC_MIN: 0,
    ELAPSED_SEC_MAX: 86399,

    // 照合対象テキストの切り詰め長（要件 3-9）
    NORMALIZED_TEXT_MAX: 200
  });

  /**
   * 縦向きで「規定要素をスクロールなし表示する」ことを保証できる長辺の下限
   * （要件 8-9 / 8-10 の 568 CSS ピクセル）。これを下回る縦向きでは種目一覧を
   * section 単位の集約表示に切り替える。
   */
  var LAYOUT_PORTRAIT_LONG_MIN = 568;

  /* ---- 1-3. DRILL_MENU: 既定メニューの初期内容（要件 1-1〜1-6）-----------
   * 制約:
   *   - 13 種目、id は 1〜13（重複・欠番なし）、配列順 = id 昇順（要件 1-6）
   *   - section は「近距離」「エルボー」「ネイル」「アウトサイド」の 4 種類、
   *     各種目はそのうち 1 種類にのみ属する（要件 1-3）
   *   - セクション別 targetMake 合計 = 近距離 20 / エルボー 40 / ネイル 30 /
   *     アウトサイド 35、総計 125（要件 1-4, 1-5）
   * この配列は既定メニューの初期内容の定義としてのみ使用し、
   * アプリ全体の不変条件としては扱わない（前提 1）。
   * ---------------------------------------------------------------------- */

  var DRILL_MENU = deepFreeze([
    // 近距離: 10 + 10 = 20
    { id: 1, section: '近距離', name: 'ゴール下 セットシュート', targetMake: 10 },
    { id: 2, section: '近距離', name: 'ショートミドル セットシュート', targetMake: 10 },

    // エルボー: 10 + 10 + 10 + 10 = 40
    { id: 3, section: 'エルボー', name: '2回ジャンプ ＋ 3回目シュート', targetMake: 10 },
    { id: 4, section: 'エルボー', name: 'ボール接地 ＋ シュート', targetMake: 10 },
    { id: 5, section: 'エルボー', name: 'ネイル移動 ＋ キャッチ ＋ ムービング', targetMake: 10 },
    { id: 6, section: 'エルボー', name: 'ネイル移動 ＋ キャッチ ＋ ジャブステップ', targetMake: 10 },

    // ネイル: 10 + 10 + 10 = 30
    { id: 7, section: 'ネイル', name: '左右ワンドリブル ＋ サイドステップ', targetMake: 10 },
    { id: 8, section: 'ネイル', name: '左右ワンドリブル ＋ クロスステップ', targetMake: 10 },
    { id: 9, section: 'ネイル', name: '左右レッグスルー ＋ プルアップ', targetMake: 10 },

    // アウトサイド: 10 + 5 + 10 + 10 = 35
    { id: 10, section: 'アウトサイド', name: '3P キャッチ & シュート', targetMake: 10 },
    { id: 11, section: 'アウトサイド', name: '3P ポンプフェイク ＋ リセットドリブル', targetMake: 5 },
    { id: 12, section: 'アウトサイド', name: '3P ポンプフェイク ＋ サイドステップ', targetMake: 10 },
    { id: 13, section: 'アウトサイド', name: 'フリースロー', targetMake: 10 }
  ]);

  /* ---- 1-4. 既定メニューの識別子と名称（要件 18-5、Glossary）------------- */

  var DEFAULT_MENU_ID = 'm-default';
  // 「125」は表示用の名称の一部にすぎず、目標合計の算出には用いない（前提 7）。
  var DEFAULT_MENU_NAME = '朝練125本IN';

  /* ---- 1-5. COMMAND_TABLE: 5 種別のコマンド語（要件 3-1〜3-5）------------
   * 配列順が既定優先順（成功 → 失敗 → 次種目 → 前種目 → 取り消し。要件 3-6）
   * であり、`priority` にも同じ順序を明示して持たせる。selectCommand
   * （タスク 4.1）は「開始位置最小 → 文字数最大 → priority 昇順」で 1 個を選ぶ。
   *
   * 注意: ここに置くのは**未正規化**の語である。照合時は照合対象テキストと
   *       同一の正規化を語側にも適用した値を用いる（要件 3-9）。正規化は
   *       タスク 4.1 の normalizeText が担い、本節では文字種を変換しない。
   * ---------------------------------------------------------------------- */

  var COMMAND_TABLE = deepFreeze([
    { type: 'MAKE', priority: 0, words: ['イン', '入った', 'マル', 'まる', '○'] },
    { type: 'MISS', priority: 1, words: ['アウト', '外れた', 'はずれた', 'バツ', 'ばつ', '×'] },
    { type: 'NEXT', priority: 2, words: ['次', 'つぎ'] },
    { type: 'PREV', priority: 3, words: ['戻る', 'もどる', '前'] },
    { type: 'UNDO', priority: 4, words: ['リセット', 'やり直し', 'やりなおし'] }
  ]);

  /* ---- 1-6. EXCLUSION_WORDS: 除外語一覧（要件 3-10）----------------------
   * コマンド語を部分文字列として含む非コマンド語。照合対象テキスト中の
   * 出現範囲をマスクし、その範囲の文字をコマンド語照合の対象から外す
   * （buildExclusionMask: タスク 4.1）。上限 32 語。
   *
   * 要件 3-10 が明示的に要求する 7 語（「ライン」「インサイド」「インステップ」
   * 「サイン」「アウトサイド」「前半」「手前」）を先頭に置く。
   *
   * 選定方針: より短い除外語に包含されて既にマスクされる語は登録しない
   * （例: 「エンドライン」は「ライン」で覆われるため不要、「スリーポイント」は
   * 「ポイント」で覆われるため不要）。逆に「インサイドアウト」は末尾の
   * 「アウト」が「インサイド」では覆われないため独立して登録する。
   * 正規化後はカタカナがひらがなへ畳まれるため（要件 3-9）、「ポイント」は
   * 「イン」を含む点に注意する。漢字は正規化で読みに変換されないため、
   * 「前」「次」「入った」を含む語は表記のまま登録する。
   * ---------------------------------------------------------------------- */

  var EXCLUSION_WORDS = deepFreeze([
    // 要件 3-10 が名指しする 7 語
    'ライン',
    'インサイド',
    'インステップ',
    'サイン',
    'アウトサイド',
    '前半',
    '手前',
    // 「イン」を含む語
    'ポイント',
    'インサイドアウト',
    'インターバル',
    'インパクト',
    'メイン',
    'デザイン',
    'コイン',
    // 「アウト」を含む語
    'タイムアウト',
    'ノックアウト',
    'アウトナンバー',
    'アウトレット',
    'フェイドアウト',
    // 「前」を含む語
    '前回',
    '前後',
    '名前',
    '以前',
    '事前',
    // 「次」を含む語
    '次回',
    '目次',
    '次第',
    // 「まる」を含む語
    '決まる',
    '始まる',
    'まるで',
    // 「入った」を含む語
    '気に入った'
  ]);

  /* ---- 1-7. THEME: 通常 / 省電力の配色トークン（要件 10-2, 10-6, 8-12, 7-2）
   *
   * index.html との関係（重要）:
   *   描画に実際に使われる配色の**正は index.html の CSS カスタムプロパティ**
   *   （`:root` と `:root[data-theme="power"]`）であり、app.js は個々の要素へ
   *   色を直接書き込まない。Theme_Manager（タスク 16.1）が行うのは
   *   `document.documentElement` の `data-theme` 属性の付け外しのみで、
   *   配色の切り替えは CSS 側のトークン上書きによって成立する。
   *
   *   本定数が保持する `tokens` は、その CSS トークンの**機械可読な写し**である。
   *   目的は 2 点:
   *     (a) コントラスト比の自動検証（タスク 2.2）が CSS を解析せずに
   *         全ペアを全列挙できるようにする
   *     (b) CSS 以外の経路（meta theme-color など）から同じ色を参照できるようにする
   *
   *   キー名は CSS カスタムプロパティ名から接頭辞 `--c-` を取り除いた形と
   *   1 対 1 に対応する（`cssVarPrefix + key` が対応する CSS 変数名になる）。
   *   値を変更するときは index.html の同名トークンと必ず同時に更新する。
   *   省電力側の値はタスク 16.2 が最終確定させるため、その際も両方を揃える。
   *
   *   両テーマの `tokens` は**カスケード後の実効値**を全キー分持つ。
   *   CSS 側の `:root[data-theme="power"]` は変化するトークンのみを上書きし、
   *   上書きしないトークン（現時点では `--c-focus`）は `:root` の値を継承する。
   *   コントラスト比の検証は実効値に対して行う必要があるため、`power.tokens`
   *   には継承分も明記し、`normal.tokens` と同一のキー集合を保つ。
   *
   * `renderBudgetMs` は配色と同じテーマ単位の属性であるため同居させる
   * （通常 0 / 省電力 200ms。要件 10-4、タスク 16.1 の getRenderBudgetMs）。
   * ---------------------------------------------------------------------- */

  var THEME = deepFreeze({
    cssVarPrefix: '--c-',
    cssAttribute: 'data-theme',

    normal: {
      id: 'normal',
      // 通常モードでは data-theme 属性を付与しない（:root の既定値を使う）
      cssAttributeValue: null,
      renderBudgetMs: 0,
      tokens: {
        'bg': '#101418',
        'surface': '#1b2127',
        'surface-2': '#232b32',
        'border': '#3a454e',
        'text': '#f2f5f7',
        'text-dim': '#c3ccd4',
        'row-bg': '#1b2127',
        'row-active-bg': '#e8edf2',
        'row-active-text': '#0b0f12',
        'btn-bg': '#2b353d',
        'btn-text': '#ffffff',
        'btn-make-bg': '#14532d',
        'btn-miss-bg': '#7f1d1d',
        'btn-danger-bg': '#5b1717',
        'bar-track': '#2b353d',
        'bar-fill': '#e8edf2',
        'info': '#dce6ee',
        'warn': '#f6e3b5',
        'error': '#f7c9c9',
        'on-indicator': '#cfe8d6',
        'off-indicator': '#9aa6ae',
        'focus': '#ffffff'
      }
    },

    power: {
      id: 'power',
      cssAttributeValue: 'power',
      renderBudgetMs: 200,
      tokens: {
        // 要件 10-2: 背景 #000000、前景は無彩色系
        'bg': '#000000',
        'surface': '#000000',
        'surface-2': '#0d0d0d',
        'border': '#4d4d4d',
        'text': '#e6e6e6',
        'text-dim': '#bdbdbd',
        'row-bg': '#000000',
        'row-active-bg': '#d9d9d9',
        'row-active-text': '#000000',
        'btn-bg': '#1a1a1a',
        'btn-text': '#e6e6e6',
        'btn-make-bg': '#1a1a1a',
        'btn-miss-bg': '#1a1a1a',
        'btn-danger-bg': '#262626',
        'bar-track': '#262626',
        'bar-fill': '#d9d9d9',
        'info': '#e6e6e6',
        'warn': '#e6e6e6',
        'error': '#e6e6e6',
        'on-indicator': '#e6e6e6',
        'off-indicator': '#8c8c8c',
        // :root[data-theme="power"] では上書きされず :root から継承する実効値
        'focus': '#ffffff'
      }
    },

    /* 検証すべき前景 / 背景ペアとその下限比（タスク 2.2 が全列挙して算出する）。
     * kind: 'text' は文字色と背景色の組、'surface' は背景同士の識別の組。
     * minRatio は「通常 / 省電力の**両テーマで**満たすべき下限」である。 */
    contrastPairs: deepFreeze([
      // 要件 8-12 後段 / 10-6: Make・種目名・全体進捗・種目一覧は 7:1 以上
      { fg: 'text', bg: 'bg', minRatio: 7, kind: 'text', requirement: '8-12, 10-6' },
      { fg: 'text', bg: 'surface', minRatio: 7, kind: 'text', requirement: '8-12, 10-6' },
      { fg: 'text', bg: 'row-bg', minRatio: 7, kind: 'text', requirement: '8-12, 10-6' },
      { fg: 'row-active-text', bg: 'row-active-bg', minRatio: 7, kind: 'text', requirement: '8-12, 10-6' },
      // 要件 8-12 前段: その他の表示状態は 4.5:1 以上
      { fg: 'text-dim', bg: 'bg', minRatio: 4.5, kind: 'text', requirement: '8-12' },
      { fg: 'text-dim', bg: 'surface', minRatio: 4.5, kind: 'text', requirement: '8-12' },
      { fg: 'text-dim', bg: 'surface-2', minRatio: 4.5, kind: 'text', requirement: '8-12' },
      { fg: 'off-indicator', bg: 'bg', minRatio: 4.5, kind: 'text', requirement: '8-12' },
      { fg: 'on-indicator', bg: 'bg', minRatio: 4.5, kind: 'text', requirement: '8-12' },
      // 要件 7-2: 操作ボタンのラベルと当該ボタンの背景は 4.5:1 以上
      { fg: 'btn-text', bg: 'btn-bg', minRatio: 4.5, kind: 'text', requirement: '7-2' },
      { fg: 'btn-text', bg: 'btn-make-bg', minRatio: 4.5, kind: 'text', requirement: '7-2' },
      { fg: 'btn-text', bg: 'btn-miss-bg', minRatio: 4.5, kind: 'text', requirement: '7-2' },
      { fg: 'btn-text', bg: 'btn-danger-bg', minRatio: 4.5, kind: 'text', requirement: '7-2' },
      // 要件 10-6: メッセージ 3 種は省電力時も 7:1 以上
      { fg: 'info', bg: 'surface', minRatio: 7, kind: 'text', requirement: '10-6' },
      { fg: 'warn', bg: 'surface', minRatio: 7, kind: 'text', requirement: '10-6' },
      { fg: 'error', bg: 'surface', minRatio: 7, kind: 'text', requirement: '10-6' },
      // 要件 8-8: アクティブ行 / 非アクティブ行の背景は 3:1 以上
      { fg: 'row-active-bg', bg: 'row-bg', minRatio: 3, kind: 'surface', requirement: '8-8' },
      // 全体進捗バーの充填部と軌道部の識別（要件 8-5 の表示が判別できること）
      { fg: 'bar-fill', bg: 'bar-track', minRatio: 3, kind: 'surface', requirement: '8-5' }
    ])
  });

  /* ---- 1-8. 既定メニューの生成と種目 id の払い出し ----------------------- */

  /**
   * DRILL_MENU の各種目を新しいオブジェクトへ複製する。
   * DRILL_MENU 自身は凍結されているため、編集対象のメニューには必ず複製を渡す。
   */
  function cloneDrills(drills) {
    var out = [];
    for (var i = 0; i < drills.length; i++) {
      out.push({
        id: drills[i].id,
        section: drills[i].section,
        name: drills[i].name,
        targetMake: drills[i].targetMake
      });
    }
    return out;
  }

  /**
   * 既定メニュー（Default_Menu）を生成する。
   * Menu_Record は id / name / drills の 3 フィールドのみを持ち、
   * targetTotal は保持しない（deriveTargetTotal で算出する派生値）。
   * 戻り値は凍結しない: 選択中メニューとして編集される対象である（要件 17-1）。
   *
   * @returns {{id: string, name: string, drills: Array}}
   */
  function createDefaultMenu() {
    return {
      id: DEFAULT_MENU_ID,
      name: DEFAULT_MENU_NAME,
      drills: cloneDrills(DRILL_MENU)
    };
  }

  /**
   * 次に払い出す種目 id を返す（設計: nextDrillId(menu) = 1 + max(0, ...ids)）。
   * 既存 id を一切参照して書き換えないため、並べ替えおよび他種目の削除の
   * 前後で既存種目の id が保存される（要件 17-2）。
   * 不正な menu / drills / id は 0 として扱い、常に 1 以上の整数を返す。
   *
   * @param {{drills: Array}} menu
   * @returns {number} 1 以上の整数
   */
  function nextDrillId(menu) {
    var maxId = 0;
    var drills = (menu && Object.prototype.toString.call(menu.drills) === '[object Array]')
      ? menu.drills
      : [];
    for (var i = 0; i < drills.length; i++) {
      var drill = drills[i];
      if (!drill) { continue; }
      var id = drill.id;
      if (typeof id === 'number' && isFinite(id) && Math.floor(id) === id && id > maxId) {
        maxId = id;
      }
    }
    return maxId + 1;
  }

  /* ==========================================================================
   * 2. 純粋関数領域
   * --------------------------------------------------------------------------
   * 引数と戻り値のみで定義され、DOM / localStorage / ブラウザ API / 現在時刻に
   * 触れない関数のみをこの節に置く。例外を送出しない（Property 7）。
   * 17 個の Correctness Property はすべてこの節の関数のみを検証対象とする。
   *
   *   2-1. テキスト正規化とコマンド判定 … タスク 4.1
   *        normalizeText / buildExclusionMask / selectCommand / restartDelay
   *
   *   2-2. カウント遷移と取り消し … タスク 5.1
   *        applyCount / undoCount / successRate / totals
   *
   *   2-3. カーソル遷移と種目 id 操作 … タスク 6.1
   *        cursorReducer / reindexAfterMenuChange /
   *        reorderDrills / removeDrill / addDrill（純粋版）/
   *        purgeDrillCounts / addDrillCounts（純粋版）
   *
   *   2-4. セッション直列化 … タスク 7.1
   *        serializeSession / deserializeSession（+ reconcile）
   *
   *   2-5. メニュー直列化と検証 … タスク 7.2
   *        serializeMenus / deserializeMenus / validateMenu / deriveTargetTotal
   *
   *   2-6. 経過時間・表示算出・履歴順序 … タスク 8.1
   *        elapsedFrom / formatElapsed / progressRatio /
   *        aggregateBySection / formatRate / sortHistoryIndex
   *        （deriveTargetTotal は validateMenu が依存するため 2-5 に置く）
   * ========================================================================== */

  /* ------------------------------------------------------------------------
   * 2-1. テキスト正規化とコマンド判定 … タスク 4.1
   *      normalizeText / buildExclusionMask / selectCommand / restartDelay
   *
   * 本小節の 4 関数はすべて純粋であり、引数以外の状態を読まず書かない。
   * どの引数（文字列でない値・孤立サロゲート・空文字・巨大文字列）に対しても
   * 例外を送出しない（Property 7 の全域性の方針を純粋関数全体に適用する）。
   *
   * === 単位の取り決め（重要）===
   *   正規化の切り詰めはコードポイント単位で数え、UTF-16 コード単位の長さも
   *   同時に上限（LIMITS.NORMALIZED_TEXT_MAX = 200）以下に収める。
   *   すなわち結果は「200 コードポイント以下 かつ String#length 200 以下」を
   *   同時に満たし、サロゲートペアを分割しない。2 つの上限のどちらかに達した
   *   時点で切り詰めるため、絵文字のみの入力では 100 個で打ち切られる。
   *   （設計 Property 14 が `result.length ≤ 200` を主張する一方、要件 3-9 の
   *     「先頭 200 文字」は人間が数える文字＝コードポイントを指すため、
   *     両方を満たす保守的な定義を採る。）
   *
   *   buildExclusionMask が返す真偽配列と selectCommand が返す `index` /
   *   `length` は、いずれも**正規化済みテキストの UTF-16 コード単位**を単位と
   *   する（mask.length === normalized.length）。コマンド語・除外語はすべて
   *   BMP の文字のみで構成されるため、この単位で indexOf しても
   *   サロゲートペアの内部で一致が始まることはない。
   * ---------------------------------------------------------------------- */

  /* ---- 正規化で除去する文字（要件 3-9）--------------------------------- */

  // 空白文字: 半角空白・全角空白・タブ・改行（CR を含む）
  var NORMALIZE_WHITESPACE = ' \t\n\r\u3000';
  // 区切り記号: 要件 3-9 が列挙する 9 個。「・」は U+30FB。
  var NORMALIZE_SEPARATORS = '、。，．・!?！？';

  var NORMALIZE_REMOVED = (function () {
    var set = Object.create(null);
    var all = NORMALIZE_WHITESPACE + NORMALIZE_SEPARATORS;
    for (var i = 0; i < all.length; i++) { set[all[i]] = true; }
    return set;
  })();

  /* ---- 半角カタカナ → 全角カタカナ（要件 3-9）---------------------------
   * U+FF61〜U+FF9F の 63 文字を 1 対 1 で写す。2 個の文字列は同じ長さでなければ
   * ならない（下の即時関数が短い方に合わせて安全に打ち切る）。
   * 濁点・半濁点（U+FF9E / U+FF9F）は直前の文字と合成してから写す。合成しない
   * 単独の濁点・半濁点は全角の「゛」「゜」（U+309B / U+309C）になる。
   * -------------------------------------------------------------------- */

  var HALFWIDTH_KANA_SRC = '｡｢｣､･ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝﾞﾟ';
  var HALFWIDTH_KANA_DST = '。「」、・ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン゛゜';

  var HALFWIDTH_KANA_MAP = (function () {
    var map = Object.create(null);
    var n = Math.min(HALFWIDTH_KANA_SRC.length, HALFWIDTH_KANA_DST.length);
    for (var i = 0; i < n; i++) { map[HALFWIDTH_KANA_SRC[i]] = HALFWIDTH_KANA_DST[i]; }
    return map;
  })();

  var HALFWIDTH_VOICED_MARK = '\uFF9E';      // ﾞ
  var HALFWIDTH_SEMI_VOICED_MARK = '\uFF9F'; // ﾟ

  var VOICED_MAP = (function () {
    var src = 'ウカキクケコサシスセソタチツテトハヒフヘホワヲ';
    var dst = 'ヴガギグゲゴザジズゼゾダヂヅデドバビブベボヷヺ';
    var map = Object.create(null);
    var n = Math.min(src.length, dst.length);
    for (var i = 0; i < n; i++) { map[src[i]] = dst[i]; }
    return map;
  })();

  var SEMI_VOICED_MAP = (function () {
    var src = 'ハヒフヘホ';
    var dst = 'パピプペポ';
    var map = Object.create(null);
    var n = Math.min(src.length, dst.length);
    for (var i = 0; i < n; i++) { map[src[i]] = dst[i]; }
    return map;
  })();

  /* ---- カタカナ → ひらがな（要件 3-9）----------------------------------
   * U+30A1〜U+30F6（ァ〜ヶ）と U+30FD / U+30FE（ヽヾ）は −0x60 で写る。
   * U+30F7〜U+30FA（ヷヸヹヺ）は対応するひらがなが存在しないため、
   * 「ひらがなの基字 + 合成用濁点 U+3099」へ分解する。
   * U+30A0（゠）・U+30FC（ー）・U+30FF（ヿ）は仮名文字ではない、または
   * 対応するひらがなを持たないため変換しない（U+30FB「・」は区切り記号として
   * 除去される）。
   * -------------------------------------------------------------------- */

  var KATAKANA_DECOMPOSED = {
    '\u30F7': '\u308F\u3099', // ヷ → わ + 濁点
    '\u30F8': '\u3090\u3099', // ヸ → ゐ + 濁点
    '\u30F9': '\u3091\u3099', // ヹ → ゑ + 濁点
    '\u30FA': '\u3092\u3099'  // ヺ → を + 濁点
  };

  /** 1 コードポイント分の文字列をひらがなへ畳む。対象外はそのまま返す。 */
  function foldKatakanaChar(ch) {
    var cp = ch.codePointAt(0);
    if (cp >= 0x30A1 && cp <= 0x30F6) { return String.fromCharCode(cp - 0x60); }
    if (cp === 0x30FD || cp === 0x30FE) { return String.fromCharCode(cp - 0x60); }
    if (cp >= 0x30F7 && cp <= 0x30FA) { return KATAKANA_DECOMPOSED[ch]; }
    return ch;
  }

  /**
   * 半角カタカナを全角カタカナへ写す（濁点・半濁点は合成する）。
   * 全角の基字に半角濁点が続く場合も合成する（「カﾞ」→「ガ」）。
   */
  function foldHalfwidthKana(text) {
    var cps = Array.from(text);
    var out = '';
    for (var i = 0; i < cps.length; i++) {
      var mapped = HALFWIDTH_KANA_MAP[cps[i]];
      var base = (typeof mapped === 'string') ? mapped : cps[i];
      var next = (i + 1 < cps.length) ? cps[i + 1] : '';
      if (next === HALFWIDTH_VOICED_MARK && typeof VOICED_MAP[base] === 'string') {
        out += VOICED_MAP[base];
        i++;
        continue;
      }
      if (next === HALFWIDTH_SEMI_VOICED_MARK && typeof SEMI_VOICED_MAP[base] === 'string') {
        out += SEMI_VOICED_MAP[base];
        i++;
        continue;
      }
      out += base;
    }
    return out;
  }

  /**
   * 照合対象テキストを算出する（要件 3-9）。コマンド語・除外語の側にも
   * 同一の関数を適用した値を用いて照合する。
   *
   * 変換の適用順（この順序でなければ冪等性が崩れる）:
   *   1. 半角カタカナ → 全角カタカナ（濁点・半濁点の合成を含む）
   *      ※ 除去対象になる「。」「、」「・」は半角カナ領域（｡ ､ ･）からも
   *        生じるため、除去より前に写しておく必要がある。
   *   2. 全角英数字（０-９ Ａ-Ｚ ａ-ｚ）→ 半角
   *      ※ 全角の「，．！？」は英数字ではないため写さない。これらは
   *        全角のまま 5. で除去され、ASCII の「,」「.」は保持される
   *        （要件 3-9 の除去対象に ASCII のカンマ・ピリオドは含まれない）。
   *   3. 英字 → 小文字
   *      ※ 2. を先に行うため「Ａ」→「A」→「a」となり、全角小文字（ａ）が
   *        残ることはない。
   *   4. カタカナ → ひらがな
   *   5. 空白文字・区切り記号の除去
   *      ※ 1〜4 のどの変換も空白文字・区切り記号を新たに生まないため、
   *        最後に一度だけ除去すれば再出現しない。
   *   6. 先頭 200 文字（コードポイント）への切り詰め
   *      ※ 除去の後に切り詰めるため、2 回目の適用で更に短くならない。
   *
   * @param {string} raw 確定した認識結果テキスト。文字列以外は '' を返す。
   * @returns {string} 照合対象テキスト。`normalizeText(normalizeText(t))
   *                   === normalizeText(t)`（Property 14）。
   */
  function normalizeText(raw) {
    if (typeof raw !== 'string' || raw === '') { return ''; }

    var folded = foldHalfwidthKana(raw);          // 1.
    var cps = Array.from(folded);
    var max = LIMITS.NORMALIZED_TEXT_MAX;
    var out = '';
    var keptCodePoints = 0;

    for (var i = 0; i < cps.length; i++) {
      var piece = cps[i];
      var cp = piece.codePointAt(0);

      // 2. 全角英数字 → 半角
      if ((cp >= 0xFF10 && cp <= 0xFF19) ||
          (cp >= 0xFF21 && cp <= 0xFF3A) ||
          (cp >= 0xFF41 && cp <= 0xFF5A)) {
        piece = String.fromCharCode(cp - 0xFEE0);
      }

      // 3. 英字 → 小文字（大文字・小文字を持たない文字は不変）
      piece = piece.toLowerCase();

      // 4. カタカナ → ひらがな
      if (piece.length === 1 || Array.from(piece).length === 1) {
        piece = foldKatakanaChar(piece);
      }

      // 5. 空白文字・区切り記号の除去
      if (piece.length === 1 && NORMALIZE_REMOVED[piece]) { continue; }

      // 6. 切り詰め（コードポイント境界で打ち切る）
      var pieceLen = Array.from(piece).length;
      if (keptCodePoints + pieceLen > max || out.length + piece.length > max) { break; }

      out += piece;
      keptCodePoints += pieceLen;
    }

    return out;
  }

  /**
   * 除外語の出現範囲をマスクする（要件 3-10）。
   *
   * 引数 `normalized` は**正規化済み**テキストであることを前提とし、この関数は
   * 再正規化しない（戻り値の添字が引数の添字と一致しなければならないため）。
   * 一方、除外語の側には normalizeText を適用した値を用いる。
   *
   * @param {string} normalized 正規化済みテキスト。文字列以外は空配列を返す。
   * @param {Array<string>} [exclusions] 除外語一覧。既定は EXCLUSION_WORDS。
   * @returns {Array<boolean>} 長さ `normalized.length` の配列。`mask[i] === true`
   *          は「添字 i の文字が除外語の出現範囲に含まれる（コマンド語照合の
   *          対象から外れる）」ことを表す。
   */
  function buildExclusionMask(normalized, exclusions) {
    var text = (typeof normalized === 'string') ? normalized : '';
    var mask = [];
    for (var i = 0; i < text.length; i++) { mask.push(false); }
    if (text === '') { return mask; }

    var list = (Object.prototype.toString.call(exclusions) === '[object Array]')
      ? exclusions
      : EXCLUSION_WORDS;

    for (var w = 0; w < list.length; w++) {
      var word = normalizeText(list[w]);
      if (word === '') { continue; }
      var from = 0;
      while (from <= text.length - word.length) {
        var at = text.indexOf(word, from);
        if (at === -1) { break; }
        for (var j = at; j < at + word.length; j++) { mask[j] = true; }
        from = at + 1; // 重なり合う出現も漏らさず走査する
      }
    }
    return mask;
  }

  /**
   * コマンド語表を「正規化済みの 1 語 = 1 要素」へ展開する。
   * priority は要素の `priority`（有限の数値のとき）を用い、無ければ種別の
   * 配列順を用いる。`order` は完全な決定性のための最終同値解消キーである。
   */
  function expandCommandWords(table) {
    var list = (Object.prototype.toString.call(table) === '[object Array]')
      ? table
      : COMMAND_TABLE;
    var out = [];
    for (var t = 0; t < list.length; t++) {
      var entry = list[t];
      if (!entry) { continue; }
      var priority = (typeof entry.priority === 'number' && isFinite(entry.priority))
        ? entry.priority
        : t;
      var words = (Object.prototype.toString.call(entry.words) === '[object Array]')
        ? entry.words
        : [];
      for (var w = 0; w < words.length; w++) {
        var word = normalizeText(words[w]);
        if (word === '') { continue; }
        out.push({
          type: String(entry.type),
          word: word,
          priority: priority,
          order: t * 1000 + w
        });
      }
    }
    return out;
  }

  /**
   * 出現範囲がマスクに 1 文字でも触れているかを判定する。
   *
   * 要件 3-10 は「当該出現範囲の文字をコマンド語照合の対象から除外する」と
   * 定めるため、**一部でも**マスク範囲と重なる出現は選択しない（完全に含まれる
   * 出現を選択しないという設計 Property 13 の条件はこれに含まれる）。
   */
  function overlapsMask(mask, index, length) {
    for (var i = index; i < index + length; i++) {
      if (mask[i]) { return true; }
    }
    return false;
  }

  /**
   * 照合対象テキストから発行すべきコマンドを 1 個決める（要件 3-1〜3-6, 3-8, 3-10）。
   *
   * 選択規則は「開始位置が最小 → 文字数が最大 → 既定優先順（成功 → 失敗 →
   * 次種目 → 前種目 → 取り消し）が先」であり、それでも同値な場合（同一の語が
   * 同一種別に重複登録されている場合など）はコマンド語表の登録順が先のものを
   * 採る。したがって結果は常に一意である（Property 13）。
   *
   * 第 1 引数には未正規化のテキストを渡してもよい。normalizeText は冪等である
   * ため、正規化済みテキストを渡しても結果は変わらない。
   *
   * @param {string} text 認識テキスト（正規化済みでも未正規化でもよい）
   * @param {Array} [table] コマンド語表。既定は COMMAND_TABLE。
   * @param {Array<string>} [exclusions] 除外語一覧。既定は EXCLUSION_WORDS。
   * @returns {{type: string, word: string, index: number, length: number}|null}
   *          該当なしは null（要件 3-8）。`word` は正規化済みの語、`index` と
   *          `length` は正規化済みテキスト上の UTF-16 コード単位。
   */
  function selectCommand(text, table, exclusions) {
    var normalized = normalizeText(text);
    if (normalized === '') { return null; }

    var words = expandCommandWords(table);
    if (words.length === 0) { return null; }

    var mask = buildExclusionMask(normalized, exclusions);
    var best = null;

    for (var w = 0; w < words.length; w++) {
      var candidate = words[w];
      var len = candidate.word.length;
      var from = 0;
      while (from <= normalized.length - len) {
        var at = normalized.indexOf(candidate.word, from);
        if (at === -1) { break; }
        from = at + 1;
        if (overlapsMask(mask, at, len)) { continue; }
        if (best === null ||
            at < best.index ||
            (at === best.index &&
              (len > best.length ||
                (len === best.length &&
                  (candidate.priority < best.priority ||
                    (candidate.priority === best.priority && candidate.order < best.order)))))) {
          best = {
            type: candidate.type,
            word: candidate.word,
            index: at,
            length: len,
            priority: candidate.priority,
            order: candidate.order
          };
        }
      }
    }

    if (best === null) { return null; }
    return { type: best.type, word: best.word, index: best.index, length: best.length };
  }

  /* ---- 音声認識の自動再開待機（要件 2-6, 2-11）--------------------------
   * 基準値 300ms から始め、認識結果を 1 件も受信せずに終了するたびに待機時間を
   * 倍にし、5000ms で飽和させる。連続 5 回で自動再開そのものを中止する。
   * -------------------------------------------------------------------- */

  var RESTART_DELAY_BASE_MS = 300;
  var RESTART_DELAY_MAX_MS = 5000;
  var RESTART_EMPTY_LIMIT = 5;

  /**
   * 次回の自動再開までの待機時間と、自動再開を続けるか否かを決める。
   *
   * @param {boolean} hadResult 直前の開始から確定結果または暫定結果を
   *        1 件以上受信していたか（要件 2-6 前段）。
   * @param {number} consecutiveEmptyCount 今回の終了を数える**前**までの
   *        「結果を 1 件も受信せずに終了した」連続回数（0 以上の整数）。
   * @param {number} [previousDelayMs] 直前に用いた待機時間（ms）。未指定・
   *        非数・基準値未満のときは基準値 300ms として扱う。
   * @returns {{delayMs: number, stop: boolean, consecutiveEmpty: number}}
   *          `delayMs` は次回再開までの待機時間（`stop` が true のときは 0）。
   *          `stop` が true なら自動再開を中止する（要件 2-11）。
   *          `consecutiveEmpty` は更新後の連続空結果回数（呼び出し側が次回の
   *          引数として持ち回す）。
   */
  function restartDelay(hadResult, consecutiveEmptyCount, previousDelayMs) {
    var previousEmpty = (typeof consecutiveEmptyCount === 'number' &&
        isFinite(consecutiveEmptyCount) && consecutiveEmptyCount > 0)
      ? Math.floor(consecutiveEmptyCount)
      : 0;

    if (hadResult) {
      // 結果を受信していた場合は連続回数を 0 に戻し、基準値で再開する。
      return { delayMs: RESTART_DELAY_BASE_MS, stop: false, consecutiveEmpty: 0 };
    }

    var consecutiveEmpty = previousEmpty + 1;
    if (consecutiveEmpty >= RESTART_EMPTY_LIMIT) {
      return { delayMs: 0, stop: true, consecutiveEmpty: consecutiveEmpty };
    }

    var previous = (typeof previousDelayMs === 'number' && isFinite(previousDelayMs) &&
        previousDelayMs > RESTART_DELAY_BASE_MS)
      ? previousDelayMs
      : RESTART_DELAY_BASE_MS;
    var doubled = previous * 2;
    if (doubled > RESTART_DELAY_MAX_MS) { doubled = RESTART_DELAY_MAX_MS; }
    return { delayMs: doubled, stop: false, consecutiveEmpty: consecutiveEmpty };
  }

  /* ------------------------------------------------------------------------
   * 2-2. カウント遷移と取り消し … タスク 5.1
   *      applyCount / undoCount / successRate / totals
   *
   * === counts の形（唯一の正）=====================================
   * `counts` は **配列** であり、要素は `{id, make, attempt}` の 3 フィールドのみ、
   * 配列順は選択中メニューの `drills` の配列順（= 表示順 = カーソル順）と一致する。
   * これは設計「Data Models / Session_State」の `counts`（長さ N、要素
   * `{id:integer, make:integer 0..999, attempt:integer 0..999}`、`make ≤ attempt`）
   * と同一であり、タスク 7.1 の serializeSession / deserializeSession が
   * そのまま読み書きする形である。Property 5 が「`counts`（要素順と 3 属性）」の
   * 深い等価を要求するため、要素順は意味を持つ。
   *
   * 設計の Count_Manager では `getCounts()` の戻り値を
   * `{ [drillId]: {make, attempt} }` の id 索引と書いているが、これは副作用シェル
   * （タスク 10.1）が描画側へ渡す**射影**であり、純粋関数コアと永続化が扱う
   * 正規形は上記の配列とする。タスク 10.1 は配列を内部状態として保持し、
   * `getCounts()` でその射影を作る（両者を二重に保持しない）。
   * 同様に設計 Property 11 の本文が使う `counts[id].make` という表記も
   * 「id に対応する要素の make」の略記として読む。
   *
   * === 純粋性と全域性 ===============================================
   * - `applyCount` / `undoCount` は引数の `counts` / `history` を**変更しない**。
   *   常に新しい配列と新しい要素オブジェクトを組み立てて返す（浅い共有もしない）。
   * - どの引数に対しても例外を送出しない。不正な引数は下の正規化規則で
   *   妥当な状態へ畳んでから処理する。
   * - **戻り値の `counts` は常に全要素で `0 ≤ make ≤ attempt ≤ 999` の整数**を
   *   満たす（要件 4-3, 4-4）。拒否された場合も入力を正規化した複製を返すため、
   *   呼び出し側は戻り値の `counts` / `history` をそのまま次の状態にできる。
   *
   * 正規化規則（不正入力の畳み込み方）:
   *   - 要素は配列順と要素数を保つ。`id` が整数でない要素は `id: null`
   *     （どの drillId とも一致しない＝操作対象にならない）とする。
   *   - `make` / `attempt` は整数化して 0〜999 に飽和させ、`make > attempt` の
   *     ときは `make` を `attempt` まで**下げる**（試投数を勝手に増やさない）。
   *   - 操作履歴は `{drillId:整数, type:'MAKE'|'MISS'}` の形を満たさない要素を
   *     除去し、20 件を超える場合は新しい 20 件を残す。
   *
   * === 20 件上限と取り消しの相互作用（要件 5-6）=====================
   * 履歴が 20 件の状態で新たな計数操作を受理すると最古 1 件を除去してから追加
   * するため、**除去された 1 件は以後どれだけ取り消しても復元できない**。
   * したがって Property 1（ラウンドトリップ）で `history` が完全に一致するのは
   * 適用前の履歴が 19 件以下のときであり、20 件のときは先頭 1 件が失われた列に
   * 一致する（`counts` は常に一致する）。除去された件は `evicted` として
   * 戻り値に載せ、呼び出し側が「取り消せない操作が発生した」ことを知れるようにする。
   * ---------------------------------------------------------------------- */

  /** 計数操作の種別（要件 4-1, 4-2, 5-2）。取り消しは履歴に積まない。 */
  var COUNT_TYPES = deepFreeze(['MAKE', 'MISS']);

  function isCountType(type) {
    return COUNT_TYPES.indexOf(type) !== -1;
  }

  function isArrayValue(value) {
    return Object.prototype.toString.call(value) === '[object Array]';
  }

  /** 整数のときその値を、それ以外は null を返す。 */
  function toIntegerOrNull(value) {
    if (typeof value !== 'number' || !isFinite(value) || Math.floor(value) !== value) {
      return null;
    }
    return value;
  }

  /** 任意の値を 0〜999 の整数へ畳む（要件 4-3）。 */
  function clampCountValue(value) {
    var n = (typeof value === 'number' && isFinite(value)) ? Math.floor(value) : LIMITS.COUNT_MIN;
    if (n < LIMITS.COUNT_MIN) { return LIMITS.COUNT_MIN; }
    if (n > LIMITS.COUNT_MAX) { return LIMITS.COUNT_MAX; }
    return n;
  }

  /**
   * counts を正規形（新しい配列・新しい要素）へ複製する。
   * 入力が既に妥当なら値は変わらないため、拒否時に返しても「状態は不変」である。
   *
   * @param {Array} counts
   * @returns {Array<{id: (number|null), make: number, attempt: number}>}
   */
  function normalizeCounts(counts) {
    var src = isArrayValue(counts) ? counts : [];
    var out = [];
    for (var i = 0; i < src.length; i++) {
      var el = src[i];
      var hasFields = (el !== null && typeof el === 'object');
      var attempt = clampCountValue(hasFields ? el.attempt : LIMITS.COUNT_MIN);
      var make = clampCountValue(hasFields ? el.make : LIMITS.COUNT_MIN);
      if (make > attempt) { make = attempt; }
      out.push({
        id: hasFields ? toIntegerOrNull(el.id) : null,
        make: make,
        attempt: attempt
      });
    }
    return out;
  }

  /**
   * 操作履歴を正規形（新しい配列・新しい要素）へ複製する。
   * 要素は `{drillId, type}` の 2 フィールドのみで、配列順が実行順（要件 5-1, 5-2）。
   *
   * @param {Array} history
   * @returns {Array<{drillId: number, type: string}>}
   */
  function normalizeOperationHistory(history) {
    var src = isArrayValue(history) ? history : [];
    var out = [];
    for (var i = 0; i < src.length; i++) {
      var el = src[i];
      if (el === null || typeof el !== 'object') { continue; }
      var drillId = toIntegerOrNull(el.drillId);
      if (drillId === null || !isCountType(el.type)) { continue; }
      out.push({ drillId: drillId, type: el.type });
    }
    if (out.length > LIMITS.OPERATION_HISTORY_MAX) {
      out = out.slice(out.length - LIMITS.OPERATION_HISTORY_MAX);
    }
    return out;
  }

  /** 正規化済み counts の中で drillId に一致する要素の添字。無ければ −1。 */
  function indexOfDrillCount(counts, drillId) {
    var id = toIntegerOrNull(drillId);
    if (id === null) { return -1; }
    for (var i = 0; i < counts.length; i++) {
      if (counts[i].id === id) { return i; }
    }
    return -1;
  }

  /**
   * カウント遷移関数の共通の戻り値。
   *
   * `reason` と `rejected` は同一の値を指す別名である（設計の
   * `{counts, history, rejected}` と タスク 5.1 の `{ok:false, reason:'CEILING'}`
   * の双方の記述をそのまま満たすため）。受理時は両方 null。
   */
  function makeCountResult(ok, reason, counts, history, entry, evicted) {
    return {
      ok: ok,
      reason: reason,
      rejected: reason,
      counts: counts,
      history: history,
      entry: entry || null,
      evicted: evicted || null
    };
  }

  /**
   * 計数操作を 1 件適用する（要件 4-1, 4-2, 4-11, 4-13, 5-1, 5-2, 5-6）。
   *
   * 成功は当該種目の Make と Attempt をそれぞれ 1 加算し、失敗は Attempt のみを
   * 1 加算する。いずれの場合も当該種目以外の Make / Attempt は変化しない。
   * `targetMake` を超える加算も拒否しない（要件 4-11）。上限は Attempt 999 のみで、
   * その状態の計数操作は `CEILING` として拒否し、履歴にも追加しない（要件 4-13）。
   *
   * @param {Array} counts 種目ごとのカウント（配列順 = メニュー順）
   * @param {Array} history 操作履歴（配列順 = 実行順、最大 20 件）
   * @param {'MAKE'|'MISS'} type 操作種別
   * @param {number} drillId 対象種目 id（アクティブ種目に限定しない）
   * @returns {{ok: boolean, reason: (string|null), rejected: (string|null),
   *            counts: Array, history: Array,
   *            entry: ({drillId: number, type: string}|null),
   *            evicted: ({drillId: number, type: string}|null)}}
   *          `reason` は `'CEILING'`（Attempt 上限）/ `'UNKNOWN_DRILL'`（該当 id
   *          なし）/ `'INVALID_TYPE'`（計数操作でない）のいずれか。
   */
  function applyCount(counts, history, type, drillId) {
    var baseCounts = normalizeCounts(counts);
    var baseHistory = normalizeOperationHistory(history);

    if (!isCountType(type)) {
      return makeCountResult(false, 'INVALID_TYPE', baseCounts, baseHistory, null, null);
    }

    var idx = indexOfDrillCount(baseCounts, drillId);
    if (idx === -1) {
      return makeCountResult(false, 'UNKNOWN_DRILL', baseCounts, baseHistory, null, null);
    }

    var target = baseCounts[idx];
    if (target.attempt >= LIMITS.COUNT_MAX) {
      // 要件 4-13: 全種目の Make / Attempt を維持し、操作履歴にも追加しない。
      return makeCountResult(false, 'CEILING', baseCounts, baseHistory, null, null);
    }

    var nextCounts = baseCounts.slice();
    nextCounts[idx] = {
      id: target.id,
      make: (type === 'MAKE') ? target.make + 1 : target.make,
      attempt: target.attempt + 1
    };

    var entry = { drillId: target.id, type: type };
    var nextHistory = baseHistory.slice();
    var evicted = null;
    if (nextHistory.length >= LIMITS.OPERATION_HISTORY_MAX) {
      // 要件 5-6: 最古 1 件を除去してから追加する。除去分は以後取り消せない。
      evicted = nextHistory.shift();
    }
    nextHistory.push(entry);

    return makeCountResult(true, null, nextCounts, nextHistory, entry, evicted);
  }

  /**
   * 操作履歴の最新 1 件のみを取り消す（要件 5-3, 5-4, 5-5, 5-9）。
   *
   * 履歴要素に記録された対象種目を戻すため、取り消し時点のアクティブ種目が
   * 別種目に移っていても当該種目の値が戻る（要件 5-3）。アクティブ種目は
   * この関数の対象外であり、呼び出し側も変更しない（カーソルは 2-3 の責務）。
   * Redo は提供しない（要件 5-9）ため、取り消した操作は戻り値に載せるだけで
   * 再適用できる形の履歴は作らない。
   *
   * 履歴要素の drillId が counts に存在しない場合（メニュー編集や reconcile で
   * 破棄された id が履歴に残っていた場合）は、カウントを変えずに当該履歴要素の
   * みを除去して受理する。こうしないと履歴が永久に縮まなくなる。通常経路では
   * 種目削除時に当該 id の履歴要素を除去する（要件 17-12）ため発生しない。
   *
   * @param {Array} counts
   * @param {Array} history
   * @returns {{ok: boolean, reason: (string|null), rejected: (string|null),
   *            counts: Array, history: Array,
   *            entry: ({drillId: number, type: string}|null), evicted: null}}
   *          履歴 0 件では `reason === 'EMPTY_HISTORY'`（要件 5-5）。
   */
  function undoCount(counts, history) {
    var baseCounts = normalizeCounts(counts);
    var baseHistory = normalizeOperationHistory(history);

    if (baseHistory.length === 0) {
      return makeCountResult(false, 'EMPTY_HISTORY', baseCounts, baseHistory, null, null);
    }

    var entry = baseHistory[baseHistory.length - 1];
    var nextHistory = baseHistory.slice(0, baseHistory.length - 1);
    var idx = indexOfDrillCount(baseCounts, entry.drillId);

    if (idx === -1) {
      return makeCountResult(true, null, baseCounts, nextHistory, entry, null);
    }

    var target = baseCounts[idx];
    var attempt = target.attempt > LIMITS.COUNT_MIN ? target.attempt - 1 : LIMITS.COUNT_MIN;
    var make = target.make;
    if (entry.type === 'MAKE' && make > LIMITS.COUNT_MIN) { make = make - 1; }
    // 履歴と counts が整合しない場合（外部由来の不整合）でも不変条件を保つ。
    if (make > attempt) { make = attempt; }

    var nextCounts = baseCounts.slice();
    nextCounts[idx] = { id: target.id, make: make, attempt: attempt };

    return makeCountResult(true, null, nextCounts, nextHistory, entry, null);
  }

  /**
   * 成功率（要件 4-5, 4-6）。
   * `Make ÷ Attempt × 100` を小数第 2 位で四捨五入した小数第 1 位までの値。
   * 未試投（`attempt === 0`）は数値を持たないため `null` を返す。表示文字列
   * 「--%」への変換は `formatRate`（タスク 8.1）の責務であり、ここでは行わない。
   *
   * @param {number} make
   * @param {number} attempt
   * @returns {number|null} 0.0〜100.0（小数第 1 位）または null
   */
  function successRate(make, attempt) {
    var att = clampCountValue(attempt);
    if (att === 0) { return null; }
    var mk = clampCountValue(make);
    if (mk > att) { mk = att; }
    return Math.round(mk / att * 1000) / 10;
  }

  /**
   * 全体成功数と全体試投数（要件 4-7, 4-8）。
   *
   * @param {Array} counts
   * @returns {{make: number, attempt: number}} いずれも 0 以上 N × 999 以下の整数
   */
  function totals(counts) {
    var normalized = normalizeCounts(counts);
    var make = 0;
    var attempt = 0;
    for (var i = 0; i < normalized.length; i++) {
      make += normalized[i].make;
      attempt += normalized[i].attempt;
    }
    return { make: make, attempt: attempt };
  }

  /* ------------------------------------------------------------------------
   * 2-3. カーソル遷移と種目 id 操作 … タスク 6.1
   *      cursorReducer / reindexAfterMenuChange /
   *      reorderDrills / removeDrill / addDrill（メニュー側の純粋版）/
   *      purgeDrillCounts / addDrillCounts / reorderCounts（カウント側の純粋版）
   *
   * === 純粋性と全域性（2-1 / 2-2 と同一方針）=========================
   * - 引数を書き換えない。常に新しい配列・新しい要素オブジェクトを返す。
   * - どの引数に対しても例外を送出しない。不正な引数は下記の既定値へ畳む。
   * - DOM / localStorage / 現在時刻に触れない。
   *
   * === 責務の分割（重要: 何がここに無いか）==========================
   * (a) **カーソルはカウントを引数に取らない**
   *     `cursorReducer(index, N, command)` の引数は「現在の添字」「種目数」
   *     「コマンド」の 3 個のみで、`counts` / `history` を受け取らない。
   *     要件 6-1 / 6-3 / 6-4 / 6-5 / 6-6 / 6-8 はいずれも「アクティブ種目の
   *     変更前後で全 N 種目の Make と Attempt を維持する」ことを要求するが、
   *     カウントを引数に取らない関数はそれを**構造的に**満たす（Property 10 の
   *     「全ステップでカウント状態が深い等価で不変」は、この分離によって
   *     カーソル側からは侵し得ないことをテストで再確認する主張になる）。
   *     逆に 2-2 の applyCount / undoCount はアクティブ種目を引数に取らず
   *     戻り値にも持たない（要件 5-3）。両者は完全に直交する。
   *
   * (b) **種目削除は「メニュー側」「カウント側」を別の純粋関数に分ける**
   *     要件 17-12 は 1 個の利用者操作に対して 3 個の状態変化を要求する。
   *       1. 選択中メニューから当該種目を除去      → `removeDrill(menu, id)`
   *       2. 当該 id の Make / Attempt を破棄      → `purgeDrillCounts(...)`
   *       3. 当該 id を対象とする操作履歴要素を除去 → `purgeDrillCounts(...)`
   *     さらにアクティブ種目の再決定（要件 17-14）が続く
   *                                                → `reindexAfterMenuChange(...)`
   *     ここで 2 と 3 を **1 個の関数にまとめている** 理由は、「カウントだけ
   *     破棄して履歴を残す」状態を呼び出し側が作れないようにするためである。
   *     履歴に削除済み id の要素が残ると、取り消し操作が削除された種目の
   *     カウントを復活させ得る（undoCount は id が counts に無ければ履歴要素を
   *     捨てるだけなので実害はないが、その id が後で再利用されると誤った種目の
   *     値が戻る）。この 2 個を不可分にすることで要件 17-12 の「カウント破棄」と
   *     「履歴除去」が取り違えられない。
   *
   *     一方で 1（メニュー）と 2+3（カウント）を **合成しない** 理由は、
   *     設計の状態層が Menu_Manager / Count_Manager / Cursor_Manager の 3 個に
   *     分かれており、「状態層のマネージャは互いを直接呼ばない。種目定義の変更が
   *     カウントやカーソルに影響する場合もディスパッチャが順序を決めて各
   *     マネージャを呼ぶ」と定めているためである。したがって呼び出し関係は
   *       タスク 10.3 Menu_Manager.removeDrill   → removeDrill（本節）
   *       タスク 10.1 Count_Manager.purgeDrill   → purgeDrillCounts（本節）
   *       タスク 10.2 Cursor_Manager.reindex...  → reindexAfterMenuChange（本節）
   *       タスク 18.2（UI）                      → 上の 3 個をこの順で呼ぶ
   *     となり、本節は 3 個をまとめた「複合操作」を提供しない。
   *     並べ替え・追加も同じ分割に従う（`reorderDrills` + `reorderCounts`、
   *     `addDrill` + `addDrillCounts`）。
   *
   * (c) **値域の検証はここでは行わない（境界は validateMenu）**
   *     本節の関数は「種目集合の構造を変える操作」だけを担い、`name` 1〜40 文字 /
   *     `section` 0〜20 文字 / `targetMake` 1〜99 / 目標合計 1〜9999 /
   *     メニュー名・メニュー数などの値域検証は **タスク 7.2 の `validateMenu`**
   *     が単独で担う（要件 17-4, 17-7）。二重実装も二重のメッセージも作らない。
   *     したがって `addDrill(menu, draft)` は `draft` の `name` / `section` /
   *     `targetMake` を **一切検証せず、値をそのまま**新しい種目に載せる。
   *     呼び出し側（タスク 10.3 / 18.1）は
   *         candidate = addDrill(menu, draft).menu
   *         if (validateMenu(candidate) に違反あり) → 反映せず項目別メッセージ
   *     の順で使う。構造操作の結果が検証を通らないことは正常な経路である。
   *
   *     例外は **種目数の下限 1 のみ**（要件 17-4）。これは「操作そのものが
   *     単独で破れる唯一の構造的制約」であり、`removeDrill` が 1 件しかない
   *     メニューの削除を `LAST_DRILL` で拒否する。0 件のメニューを一度も
   *     組み立てないことで、その後の `cursorReducer`（N ≥ 1 を前提に
   *     `0 ≤ i ≤ N−1` を返す）と整合する。上限 50 は追加操作でも越え得るが、
   *     越えた結果は `validateMenu` が違反として弾けるため本節では見ない
   *     （下限違反は「アクティブ種目が存在しない」という表現不能な状態を
   *     生むので扱いが異なる）。
   *
   * (d) **id の払い出しは nextDrillId のみ**
   *     既存 id を書き換える処理は本節に存在しない。並べ替えは配列の順序だけを
   *     変え、削除は該当要素を除くだけであり、どちらも他種目の `id` に触れない
   *     （要件 17-2）。追加は `nextDrillId(menu)`（= 1 + 既存 id の最大値、
   *     タスク 2.1）で採番するため既存 id と衝突しない。
   *     ただし `nextDrillId` は**現在のメニュー**しか見ないため、最大 id の種目を
   *     削除した直後の追加はその id を再利用し得る。削除済み id が操作履歴や
   *     （reconcile 前の）カウントに残っている場合、再利用された id は
   *     「削除した種目の記録が別種目に移る」誤りを生む。そこで
   *     `addDrill(menu, draft, reservedIds)` の第 3 引数に**避けたい id の列**を
   *     渡せるようにしてある。採番は
   *         max(nextDrillId(menu), 1 + max(reservedIds))
   *     となり、`reservedIds` の要素は整数、または `id` / `drillId` フィールドを
   *     持つオブジェクト（counts / operations の要素をそのまま渡せる）を受け付ける。
   *
   *     呼び出し側の責務（タスク 10.1 / 10.3 / 18.2 への申し送り）:
   *       `reservedIds` には「そのセッションで**一度でも使った id**」を渡す。
   *       具体的には現在の counts と operations に現れる id に加えて、
   *       **削除済みの id**（= セッション中に払い出し済みの id の高水位）を含める。
   *       counts と operations だけでは、削除された種目を参照する履歴要素まで
   *       消えている場合（要件 17-12 の通常経路）に削除済み id が再利用され得る。
   *       純粋関数である本節はセッションの履歴を持てないため、高水位の保持は
   *       状態を持つ層（Count_Manager / Menu_Manager）の責務とする。

   *
   * === 引数の形（唯一の正）==========================================
   *   menu    : {id, name, drills:[{id, section, name, targetMake}, ...]}
   *             Menu_Record は 3 フィールドのみ（`targetTotal` は派生値として
   *             持たない）。本節の戻り値の menu も必ずこの 3 キーを
   *             `id` / `name` / `drills` の順で持つ新しいオブジェクトである。
   *             種目の未知のフィールドは複製時に落とす（4 フィールドに正規化）。
   *             一方で各フィールドの**値は変換しない**（検証は 7.2 の責務であり、
   *             ここで畳むと validateMenu が元の入力を判定できなくなる）。
   *   counts  : [{id, make, attempt}, ...]  配列順 = drills の配列順（2-2 の取り決め）
   *   history : [{drillId, type}, ...]      配列順 = 実行順、最大 20 件（2-2 の取り決め）
   *
   * メニュー操作の戻り値は `{ok, reason, menu, drill, index}` に統一する。
   *   ok     … 操作を反映したか（false なら menu は入力の正規化複製 = 内容不変）
   *   reason … 'UNKNOWN_DRILL' / 'LAST_DRILL' / 'NOT_A_PERMUTATION' / null
   *   drill  … 追加・削除された種目（並べ替えでは null）
   *   index  … その種目の位置（削除前の位置 / 追加後の位置。無ければ −1）
   * タスク 10.3 の `{ok:true, menu} | {ok:false, violations}` は、この戻り値と
   * `validateMenu` の違反一覧を合成して組み立てる（`violations` は検証側が持つ）。
   * ---------------------------------------------------------------------- */

  /* ---- カーソル遷移（要件 6-1〜6-8）------------------------------------- */

  /**
   * 種目数 N を 1 以上の整数へ畳む。
   *
   * 要件 17-4 により実際の N は常に 1 以上 50 以下だが、`cursorReducer` は
   * 全域関数でなければならない（例外を送出しない）ため、N < 1・非整数・非数の
   * ときは **1 として扱う**ことを既定の縮退動作とする。0 件のメニューには
   * 「アクティブ種目」という概念自体が存在せず `0 ≤ i ≤ N−1` を満たす整数も
   * 存在しないため、そこだけは「1 件あるものとみなして添字 0 を返す」以外に
   * 値域を保つ選択肢がない。上限 50 では飽和させない（50 を超えるメニューは
   * validateMenu が弾くべき入力であり、カーソルが黙って切り詰めると
   * 「表示されているのに選べない種目」が生じるため）。
   */
  function normalizeCursorLength(n) {
    if (typeof n !== 'number' || !isFinite(n)) { return LIMITS.DRILL_COUNT_MIN; }
    var v = Math.floor(n);
    return v < LIMITS.DRILL_COUNT_MIN ? LIMITS.DRILL_COUNT_MIN : v;
  }

  /**
   * 現在の添字を `0 ≤ i ≤ n−1` へ畳む。
   * 非整数・非数・範囲外はすべて先頭種目（0）または最終種目（n−1）に寄せる。
   * 要件 6-11 は「保存済みの添字が範囲外なら先頭種目」と定めるが、その分岐は
   * 復元経路（タスク 10.2 の `restore`）がメッセージ提示を伴って行う。
   * ここでの畳み込みは「どの入力でも値域を満たす値を返す」ための保険である。
   */
  function normalizeCursorIndex(index, n) {
    var i = toIntegerOrNull(index);
    if (i === null || i < 0) { return 0; }
    if (i > n - 1) { return n - 1; }
    return i;
  }

  /**
   * カーソルコマンドを `{type, index}` へ正規化する。
   * 受け付ける形は次の 3 通りで、いずれも `SELECT` の引数は `index`（別名 `value`）。
   *   'NEXT' / 'PREV'
   *   {type:'NEXT'} / {type:'PREV'}
   *   {type:'SELECT', index: i}
   */
  function parseCursorCommand(command) {
    if (typeof command === 'string') {
      return { type: command, index: null };
    }
    if (command !== null && typeof command === 'object') {
      var idx = toIntegerOrNull(command.index);
      if (idx === null) { idx = toIntegerOrNull(command.value); }
      return { type: (typeof command.type === 'string') ? command.type : '', index: idx };
    }
    return { type: '', index: null };
  }

  function makeCursorResult(index, ok, reason) {
    return { index: index, ok: ok, reason: reason };
  }

  /**
   * アクティブ種目の添字の遷移関数（`next` / `prev` / `selectIndex` の純粋版）。
   *
   * 循環しない（要件 6-5, 6-6）。戻り値の `index` は常に
   * `Number.isInteger(index) && 0 ≤ index ≤ N−1`（要件 6-7）。
   * **カウントを引数に取らないため、この関数が Make / Attempt を変えることは
   * 原理的にない**（要件 6-1, 6-3, 6-4, 6-8, 6-9）。
   *
   * @param {number} index 現在のアクティブ種目の添字
   * @param {number} N 選択中メニューの種目数
   * @param {('NEXT'|'PREV'|{type: string, index: number})} command
   * @returns {{index: number, ok: boolean, reason: (string|null)}}
   *          `reason` は `'AT_LAST'`（最終種目での NEXT。要件 6-5）/
   *          `'AT_FIRST'`（先頭種目での PREV。要件 6-6）/
   *          `'OUT_OF_RANGE'`（範囲外の SELECT）/ `'UNKNOWN_COMMAND'` のいずれか。
   *          拒否時の `index` は入力を値域へ畳んだ値（= 実質的に不変）。
   *          `AT_LAST` / `AT_FIRST` を受けた呼び出し側は 500ms 以内に
   *          メッセージを出し 3 秒継続させる（要件 6-5, 6-6。タスク 12.5）。
   */
  function cursorReducer(index, N, command) {
    var n = normalizeCursorLength(N);
    var cur = normalizeCursorIndex(index, n);
    var cmd = parseCursorCommand(command);

    if (cmd.type === 'NEXT') {
      // 要件 6-3 / 6-5: N−1 では移動せず AT_LAST。N = 1 では常に AT_LAST。
      if (cur >= n - 1) { return makeCursorResult(cur, false, 'AT_LAST'); }
      return makeCursorResult(cur + 1, true, null);
    }
    if (cmd.type === 'PREV') {
      // 要件 6-4 / 6-6: 0 では移動せず AT_FIRST。N = 1 では常に AT_FIRST。
      if (cur <= 0) { return makeCursorResult(cur, false, 'AT_FIRST'); }
      return makeCursorResult(cur - 1, true, null);
    }
    if (cmd.type === 'SELECT') {
      // 要件 6-8: 範囲内なら（既にアクティブな種目を選んだ場合も）その種目を選ぶ。
      if (cmd.index === null || cmd.index < 0 || cmd.index > n - 1) {
        return makeCursorResult(cur, false, 'OUT_OF_RANGE');
      }
      return makeCursorResult(cmd.index, true, null);
    }
    return makeCursorResult(cur, false, 'UNKNOWN_COMMAND');
  }

  /**
   * 種目数が変化した後のアクティブ種目の添字を決める（要件 17-14）。
   *
   * 規則:
   *   - 削除位置がアクティブ種目より前（`removedIndex < prevIndex`）
   *       → 配列が 1 個詰まるため `prevIndex − 1`（同じ種目が引き続きアクティブ）
   *   - 削除位置がアクティブ種目と一致（`removedIndex === prevIndex`）
   *       → 「変化後の配列における当該位置以降の先頭の種目」= 同じ添字の要素
   *         （削除された種目の次の種目が繰り上がっている）。末尾を超える場合は
   *         最終種目（`newLength − 1`）
   *   - 削除位置がアクティブ種目より後（`removedIndex > prevIndex`）→ `prevIndex`
   *   - 追加（削除位置なし）→ `prevIndex`（要件 17-13 はアクティブ種目を変えない）
   * いずれの経路でも結果を `0 ≤ i ≤ newLength − 1` に収める。
   *
   * @param {number} prevIndex 変化前のアクティブ種目の添字
   * @param {number} prevLength 変化前の種目数
   * @param {number} newLength 変化後の種目数
   * @param {(number|null)} removedIndex 削除された種目の変化前の添字。
   *        追加のみの場合は `null`（`-1` / 非整数も「削除なし」として扱う）。
   * @returns {number} 変化後のアクティブ種目の添字（常に整数）
   */
  function reindexAfterMenuChange(prevIndex, prevLength, newLength, removedIndex) {
    var newLen = toIntegerOrNull(newLength);
    // 変化後に種目が存在しない入力は表現できないため 0 を返す（全域性のための縮退）。
    if (newLen === null || newLen < LIMITS.DRILL_COUNT_MIN) { return 0; }

    var prevLen = toIntegerOrNull(prevLength);
    if (prevLen === null || prevLen < LIMITS.DRILL_COUNT_MIN) { prevLen = newLen; }

    var prev = toIntegerOrNull(prevIndex);
    if (prev === null || prev < 0) { prev = 0; }
    if (prev > prevLen - 1) { prev = prevLen - 1; }

    var removed = toIntegerOrNull(removedIndex);
    var isRemoval = removed !== null && removed >= 0 && removed <= prevLen - 1 && newLen < prevLen;

    var next = prev;
    if (isRemoval && removed < prev) {
      next = prev - 1;
    }
    // removed === prev のときは添字を動かさない（次の種目が繰り上がっている）。
    // removed > prev のときも影響しない。どちらも next = prev のままでよい。

    if (next < 0) { next = 0; }
    if (next > newLen - 1) { next = newLen - 1; }
    return next;
  }

  /* ---- 種目集合の操作（メニュー側。要件 17-2, 17-11〜17-13）-------------- */

  /** menu.drills を配列として取り出す（不正な menu では空配列）。 */
  function menuDrillsOf(menu) {
    if (menu !== null && typeof menu === 'object' && isArrayValue(menu.drills)) {
      return menu.drills;
    }
    return [];
  }

  /**
   * 種目を 4 フィールドの新しいオブジェクトへ複製する。
   * **値は変換しない**（検証は validateMenu の責務。上の (c) を参照）。
   * 未知のフィールドは落とし、Drill の形を `id` / `section` / `name` /
   * `targetMake` の 4 キーに固定する（直列化の決定性にも寄与する）。
   */
  function cloneMenuDrill(drill) {
    var src = (drill !== null && typeof drill === 'object') ? drill : {};
    return { id: src.id, section: src.section, name: src.name, targetMake: src.targetMake };
  }

  function cloneMenuDrills(drills) {
    var out = [];
    for (var i = 0; i < drills.length; i++) { out.push(cloneMenuDrill(drills[i])); }
    return out;
  }

  /** `id` / `name` / `drills` の順にキーを持つ新しい Menu_Record を組み立てる。 */
  function cloneMenuWithDrills(menu, drills) {
    var src = (menu !== null && typeof menu === 'object') ? menu : {};
    return { id: src.id, name: src.name, drills: drills };
  }

  function makeMenuResult(ok, reason, menu, drill, index) {
    return {
      ok: ok,
      reason: reason,
      menu: menu,
      drill: (drill === undefined) ? null : drill,
      index: (typeof index === 'number') ? index : -1
    };
  }

  /** drills の中で id が一致する要素の添字。無ければ −1。 */
  function indexOfDrillId(drills, drillId) {
    var id = toIntegerOrNull(drillId);
    if (id === null) { return -1; }
    for (var i = 0; i < drills.length; i++) {
      var d = drills[i];
      if (d !== null && typeof d === 'object' && toIntegerOrNull(d.id) === id) { return i; }
    }
    return -1;
  }

  /**
   * 種目を並べ替える（要件 17-1, 17-2）。
   *
   * `orderedIds` は **現在の種目 id 全体の置換**でなければならない。欠落・余剰・
   * 重複のいずれかがあれば `NOT_A_PERMUTATION` で拒否し、メニューを変更しない。
   * 「与えられた id だけを並べて残りを落とす」解釈を採らない理由は、並べ替えの
   * UI 操作が id を 1 個落とすだけで**カウントを伴う種目を無言で削除**して
   * しまい、要件 17-11（削除は確認表示を経る）と 17-12（削除時にカウントと履歴を
   * 破棄する）を迂回する経路になるためである。削除は必ず `removeDrill` を通す。
   *
   * 既存 id を書き換えないため、並べ替えの前後で全種目の id が保存される
   * （要件 17-2）。対応するカウントの並べ替えは `reorderCounts` が行う。
   *
   * @param {object} menu
   * @param {Array<number>} orderedIds 並べ替え後の id 列（現 id 集合の置換）
   * @returns {{ok: boolean, reason: (string|null), menu: object,
   *            drill: null, index: number}}
   */
  function reorderDrills(menu, orderedIds) {
    var drills = menuDrillsOf(menu);
    var unchanged = cloneMenuWithDrills(menu, cloneMenuDrills(drills));

    if (!isArrayValue(orderedIds) || orderedIds.length !== drills.length) {
      return makeMenuResult(false, 'NOT_A_PERMUTATION', unchanged, null, -1);
    }

    var used = [];
    for (var u = 0; u < drills.length; u++) { used.push(false); }

    var next = [];
    for (var i = 0; i < orderedIds.length; i++) {
      var id = toIntegerOrNull(orderedIds[i]);
      if (id === null) {
        return makeMenuResult(false, 'NOT_A_PERMUTATION', unchanged, null, -1);
      }
      var found = -1;
      for (var j = 0; j < drills.length; j++) {
        if (used[j]) { continue; }
        var d = drills[j];
        if (d !== null && typeof d === 'object' && toIntegerOrNull(d.id) === id) {
          found = j;
          break;
        }
      }
      // 見つからない = 欠落 / 余剰 / 重複のいずれか（同じ id を 2 回並べた場合、
      // 2 回目は未使用の一致要素が無くなるためここで弾かれる）。
      if (found === -1) {
        return makeMenuResult(false, 'NOT_A_PERMUTATION', unchanged, null, -1);
      }
      used[found] = true;
      next.push(cloneMenuDrill(drills[found]));
    }

    return makeMenuResult(true, null, cloneMenuWithDrills(menu, next), null, -1);
  }

  /**
   * 種目を 1 個削除する（要件 17-11, 17-12）。
   *
   * 当該種目の Make / Attempt と操作履歴要素の破棄は `purgeDrillCounts` が、
   * アクティブ種目の再決定は `reindexAfterMenuChange` が担う（上の (b) を参照）。
   * 削除される種目の**変化前の添字**を `index` として返すのは、呼び出し側が
   * それを `reindexAfterMenuChange` の `removedIndex` にそのまま渡せるようにする
   * ためである。
   *
   * 種目数 1 のメニューからの削除は `LAST_DRILL` で拒否する（要件 17-4 の
   * 下限 1。上の (c) を参照）。
   *
   * @param {object} menu
   * @param {number} drillId
   * @returns {{ok: boolean, reason: (string|null), menu: object,
   *            drill: (object|null), index: number}}
   */
  function removeDrill(menu, drillId) {
    var drills = menuDrillsOf(menu);
    var unchanged = cloneMenuWithDrills(menu, cloneMenuDrills(drills));

    var at = indexOfDrillId(drills, drillId);
    if (at === -1) {
      return makeMenuResult(false, 'UNKNOWN_DRILL', unchanged, null, -1);
    }
    if (drills.length <= LIMITS.DRILL_COUNT_MIN) {
      return makeMenuResult(false, 'LAST_DRILL', unchanged, null, -1);
    }

    var next = [];
    for (var i = 0; i < drills.length; i++) {
      if (i === at) { continue; }
      next.push(cloneMenuDrill(drills[i]));
    }
    return makeMenuResult(true, null, cloneMenuWithDrills(menu, next),
      cloneMenuDrill(drills[at]), at);
  }

  /** 整数 id の列の最大値（該当なしは 0）。addDrill の採番に用いる。 */
  function maxReservedId(reservedIds) {
    var list = isArrayValue(reservedIds) ? reservedIds : [];
    var max = 0;
    for (var i = 0; i < list.length; i++) {
      var raw = list[i];
      var id = toIntegerOrNull(
        (raw !== null && typeof raw === 'object') ? (raw.id !== undefined ? raw.id : raw.drillId) : raw);
      if (id !== null && id > max) { max = id; }
    }
    return max;
  }

  /**
   * 種目を 1 個追加する（要件 17-1, 17-13）。
   *
   * id は `nextDrillId(menu)` で採番し、既存 id と衝突しない（要件 17-2）。
   * `reservedIds` を渡すと「そこに現れる id もすべて避ける」ため、最大 id の
   * 種目を削除した直後の追加でも、そのセッションで既に使った id を再利用しない。
   * 呼び出し側は counts / operations に現れる id **と削除済み id**（払い出し済み
   * id の高水位）を渡す責務を持つ（上の (d) を参照）。`reservedIds` の要素は
   * 整数、または `id` / `drillId` フィールドを持つオブジェクト（counts /
   * operations の要素をそのまま渡せる）を受け付ける。
   *
   * `draft` の `name` / `section` / `targetMake` は **検証も既定値の補完もせず
   * そのまま**載せる（上の (c) を参照）。追加種目のカウントは
   * `addDrillCounts` が 0 / 0 で作る（要件 17-13）。追加は常に末尾に行い、
   * 既存種目の配列順を変えない。
   *
   * @param {object} menu
   * @param {{name: *, section: *, targetMake: *}} draft
   * @param {Array} [reservedIds] 避けたい id の列（counts / operations でもよい）
   * @returns {{ok: boolean, reason: null, menu: object,
   *            drill: object, index: number}} 常に `ok: true`
   */
  function addDrill(menu, draft, reservedIds) {
    var drills = menuDrillsOf(menu);
    var src = (draft !== null && typeof draft === 'object') ? draft : {};

    var fromMenu = nextDrillId({ drills: drills });
    var fromReserved = maxReservedId(reservedIds) + 1;
    var id = (fromReserved > fromMenu) ? fromReserved : fromMenu;

    var drill = { id: id, section: src.section, name: src.name, targetMake: src.targetMake };
    var next = cloneMenuDrills(drills);
    next.push(drill);

    return makeMenuResult(true, null, cloneMenuWithDrills(menu, next),
      cloneMenuDrill(drill), next.length - 1);
  }

  /* ---- 種目集合の操作（カウント側。要件 17-3, 17-12, 17-13）-------------- */

  /**
   * 種目削除に伴い、当該 id の Make / Attempt と操作履歴要素を破棄する
   * （要件 17-12）。他種目の Make / Attempt は変化しない。
   *
   * カウントと履歴を同時に扱うのは、片方だけを処理した状態を作れないようにする
   * ため（上の (b) を参照）。`Count_Manager.purgeDrill`（タスク 10.1）は
   * この関数に委譲し、自身では履歴を触らない。
   *
   * @param {Array} counts
   * @param {Array} history
   * @param {number} drillId
   * @returns {{counts: Array, history: Array,
   *            removed: ({id: number, make: number, attempt: number}|null),
   *            removedOperations: number}}
   */
  function purgeDrillCounts(counts, history, drillId) {
    var baseCounts = normalizeCounts(counts);
    var baseHistory = normalizeOperationHistory(history);
    var id = toIntegerOrNull(drillId);
    if (id === null) {
      return { counts: baseCounts, history: baseHistory, removed: null, removedOperations: 0 };
    }

    var nextCounts = [];
    var removed = null;
    for (var i = 0; i < baseCounts.length; i++) {
      if (baseCounts[i].id === id) {
        // 同一 id が複数あっても（外部由来の不整合）すべて破棄する。
        if (removed === null) { removed = baseCounts[i]; }
        continue;
      }
      nextCounts.push(baseCounts[i]);
    }

    var nextHistory = [];
    for (var h = 0; h < baseHistory.length; h++) {
      if (baseHistory[h].drillId === id) { continue; }
      nextHistory.push(baseHistory[h]);
    }

    return {
      counts: nextCounts,
      history: nextHistory,
      removed: removed,
      removedOperations: baseHistory.length - nextHistory.length
    };
  }

  /**
   * 種目追加に伴い、当該 id のカウントを Make / Attempt 0 で末尾に追加する
   * （要件 17-13）。他種目の Make / Attempt は変化しない。
   * 既に同 id のカウントがある場合は **0 で上書きしない**（記録済みの値を
   * 失わせないため。`added` は null になる）。
   *
   * 追加は常に末尾に行うため、`addDrill` が種目を末尾に追加する限り
   * 「counts の配列順 = drills の配列順」が保たれる。
   *
   * @param {Array} counts
   * @param {number} drillId
   * @returns {{counts: Array, added: (object|null)}}
   */
  function addDrillCounts(counts, drillId) {
    var base = normalizeCounts(counts);
    var id = toIntegerOrNull(drillId);
    if (id === null || indexOfDrillCount(base, id) !== -1) {
      return { counts: base, added: null };
    }
    var added = { id: id, make: LIMITS.COUNT_MIN, attempt: LIMITS.COUNT_MIN };
    base.push(added);
    return { counts: base, added: added };
  }

  /**
   * 種目の並べ替えに伴い、counts の配列順を新しい種目順へ揃える（要件 17-3）。
   *
   * 各要素の `id` / `make` / `attempt` は変化せず、順序だけが変わる。
   * `reorderDrills` と違って**拒否しない**（全域）。`orderedIds` に現れない
   * 要素は元の相対順序のまま末尾に残す。カウントを取り違えて捨てることが
   * 「削除を確認表示なしで行う」のと同じ結果を招くため、この関数は決して
   * 要素を落とさない。id 集合の不一致そのものの解消（余剰の破棄・欠落の 0 補完）は
   * タスク 7.1 の reconcile が選択中メニューを正として行う。
   *
   * @param {Array} counts
   * @param {Array<number>} orderedIds
   * @returns {Array} 並べ替え後の counts（新しい配列・新しい要素）
   */
  function reorderCounts(counts, orderedIds) {
    var base = normalizeCounts(counts);
    if (!isArrayValue(orderedIds)) { return base; }

    var used = [];
    for (var u = 0; u < base.length; u++) { used.push(false); }

    var out = [];
    for (var i = 0; i < orderedIds.length; i++) {
      var id = toIntegerOrNull(orderedIds[i]);
      if (id === null) { continue; }
      for (var j = 0; j < base.length; j++) {
        if (!used[j] && base[j].id === id) {
          used[j] = true;
          out.push(base[j]);
          break;
        }
      }
    }
    for (var k = 0; k < base.length; k++) {
      if (!used[k]) { out.push(base[k]); }
    }
    return out;
  }

  /* ------------------------------------------------------------------------
   * 2-4. セッション直列化 … タスク 7.1
   *      serializeSession / deserializeSession
   *
   * === 保存フィールドは 8 種類のみ（要件 13-3）=======================
   *   schemaVersion / startedAt / elapsedSec / menuId / activeIndex /
   *   counts / operations / ended
   * SESSION_FIELDS がこの 8 個と**キー順**の唯一の定義であり、直列化も復元も
   * この配列の順に明示的に組み立てる。`JSON.stringify` はオブジェクトの
   * キー挿入順で出力するため、入力側のキー順がどうであれ出力は一致する
   * （要件 13-4 の決定性。Property 4 はキー順を入れ替えたコピーとの一致を見る）。
   *
   * === 全域性（Property 7）==========================================
   * `deserializeSession` は例外を送出せず、どの入力に対しても
   * 「選択中メニューに整合する妥当な状態」と `issues` を返す。
   * 「妥当」とは次を同時に満たすことをいう。
   *   - フィールドがちょうど 8 個
   *   - counts の要素数 = menu.drills の要素数、要素の id は menu の id と同一の
   *     集合・同一の並び、`0 ≤ make ≤ attempt ≤ 999`
   *   - `0 ≤ activeIndex ≤ N−1`（N = 0 のときのみ 0）
   *   - `0 ≤ elapsedSec ≤ 86399`
   *   - operations は 0〜20 件で、各要素の drillId は menu に存在する
   *
   * === schemaVersion の 3 分岐（要件 13-8, 13-9, 13-10）==============
   *   欠落 / 非整数 / 現行値より大きい → どのフィールドも復元せず初期状態
   *   現行値より小さい（旧版）        → 欠落フィールドを既定値で補完し、
   *                                     存在するフィールドの値は保持する
   *   現行値                          → 全フィールドを値域検証する
   * 旧版でも「存在するフィールド」は値域検証の対象になる。値域外の値をそのまま
   * 保持すると上の「妥当な状態」を破り、Property 7 と矛盾するためである。
   *
   * === 検証と reconcile の順序 ======================================
   * 値域検証（要件 13-10）は 1 件でも違反があれば初期状態を返す。検証を通った
   * 状態に対してのみ、メニューの種目 id 集合を正とする reconcile を行う
   * （要件 1-10, 6-10, 6-11）。reconcile は「復元できなかった」ではなく
   * 「メニュー定義に合わせて整合させた」ため、初期状態には落とさず `issues` に
   * 記録するだけで、保持できる値は保持する。
   * ---------------------------------------------------------------------- */

  /** 保存される 8 フィールドとそのキー順（要件 13-3, 13-4）。 */
  var SESSION_FIELDS = deepFreeze([
    'schemaVersion',
    'startedAt',
    'elapsedSec',
    'menuId',
    'activeIndex',
    'counts',
    'operations',
    'ended'
  ]);

  /** 配列でも null でもない素のオブジェクトか。 */
  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !isArrayValue(value);
  }

  /** 自身のプロパティとして存在し、値が undefined でないか。 */
  function hasField(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined;
  }

  /**
   * `issues` / `violations` の要素。
   * `code` は機械判定用、`field` は利用者向けメッセージの対象箇所、
   * `message` は日本語の説明文（表示は副作用シェルの showMessage が行う）。
   */
  function makeIssue(code, field, message) {
    return { code: code, field: field, message: message };
  }

  /** menu.id を文字列として取り出す（不正な menu では空文字）。 */
  function menuIdOf(menu) {
    return (menu !== null && typeof menu === 'object' && typeof menu.id === 'string')
      ? menu.id
      : '';
  }

  /**
   * 初期状態のセッション状態（要件 13-7 の定義）。
   * 選択中メニューの N 種目の Make / Attempt がいずれも 0、アクティブ種目
   * インデックス 0、経過時間 0 秒、操作履歴 0 件、セッション終了済みでない。
   *
   * `startedAt` は「まだ計測を開始していない」ことを null で表す。
   * 要件 13-7 は初期状態の startedAt を規定しないため、8 フィールドを保ちつつ
   * 「開始日時なし」を表せる値として null を採る（Session_Timer の start 前）。
   *
   * @param {{id: string, drills: Array}} menu 選択中メニュー
   * @returns {Object} 8 フィールドのセッション状態
   */
  function initialSessionState(menu) {
    var drills = menuDrillsOf(menu);
    var counts = [];
    for (var i = 0; i < drills.length; i++) {
      var drill = drills[i];
      counts.push({
        id: (drill !== null && typeof drill === 'object') ? toIntegerOrNull(drill.id) : null,
        make: LIMITS.COUNT_MIN,
        attempt: LIMITS.COUNT_MIN
      });
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      startedAt: null,
      elapsedSec: LIMITS.ELAPSED_SEC_MIN,
      menuId: menuIdOf(menu),
      activeIndex: 0,
      counts: counts,
      operations: [],
      ended: false
    };
  }

  /** 経過時間を 0〜86399 の整数へ畳む（要件 11-9, 13-3）。 */
  function clampElapsedSec(value) {
    var n = (typeof value === 'number' && isFinite(value))
      ? Math.floor(value)
      : LIMITS.ELAPSED_SEC_MIN;
    if (n < LIMITS.ELAPSED_SEC_MIN) { return LIMITS.ELAPSED_SEC_MIN; }
    if (n > LIMITS.ELAPSED_SEC_MAX) { return LIMITS.ELAPSED_SEC_MAX; }
    return n;
  }

  /**
   * セッション状態を 1 個の JSON 文字列へ変換する（要件 13-1, 13-3, 13-4）。
   *
   * 8 フィールドを SESSION_FIELDS の順に明示的に組み立てるため、入力オブジェクト
   * のキー挿入順や未知のフィールドの有無は出力に影響しない（要件 13-4）。
   * 値は「妥当な状態」の範囲へ畳むだけで、妥当な入力に対しては何も変えない
   * （したがって要件 13-5 のラウンドトリップを壊さない）。
   * `schemaVersion` は常に現行値を書く。
   *
   * @param {Object} state セッション状態
   * @returns {string} JSON 文字列
   */
  function serializeSession(state) {
    var src = isPlainObject(state) ? state : {};

    var counts = normalizeCounts(src.counts);
    var outCounts = [];
    for (var i = 0; i < counts.length; i++) {
      outCounts.push({
        id: counts[i].id,
        make: counts[i].make,
        attempt: counts[i].attempt
      });
    }

    var operations = normalizeOperationHistory(src.operations);
    var outOperations = [];
    for (var j = 0; j < operations.length; j++) {
      outOperations.push({
        drillId: operations[j].drillId,
        type: operations[j].type
      });
    }

    var activeIndex = toIntegerOrNull(src.activeIndex);
    if (activeIndex === null || activeIndex < 0) { activeIndex = 0; }

    // キー順は SESSION_FIELDS と同一（要件 13-4）
    return JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      startedAt: (typeof src.startedAt === 'string') ? src.startedAt : null,
      elapsedSec: clampElapsedSec(src.elapsedSec),
      menuId: (typeof src.menuId === 'string') ? src.menuId : '',
      activeIndex: activeIndex,
      counts: outCounts,
      operations: outOperations,
      ended: src.ended === true
    });
  }

  /**
   * counts / operations をメニューの種目 id 集合に整合させる
   * （要件 1-10, 6-10, 6-11, 17-12, 17-13）。
   *
   *   - メニューに存在する id は menu.drills の並び順で並べ替える
   *   - メニューにあってカウントに無い id は Make / Attempt 0 で補完する
   *   - カウントにあってメニューに無い id（余剰）は破棄する
   *   - 破棄した id を対象とする操作履歴要素も除去する
   *
   * 入力の counts / operations は「値域検証済み」であることを前提とする。
   *
   * @param {Array} counts 検証済みの counts
   * @param {Array} operations 検証済みの operations
   * @param {Array} drills menu.drills
   * @returns {{counts: Array, operations: Array, issues: Array}}
   */
  function reconcileWithMenu(counts, operations, drills) {
    var issues = [];

    var byId = Object.create(null);
    var seen = Object.create(null);
    var i;
    for (i = 0; i < counts.length; i++) {
      var id = counts[i].id;
      if (id === null) { continue; }
      if (byId[id] === undefined) { byId[id] = counts[i]; }
    }

    var outCounts = [];
    var missing = 0;
    for (i = 0; i < drills.length; i++) {
      var drill = drills[i];
      var drillId = (drill !== null && typeof drill === 'object') ? toIntegerOrNull(drill.id) : null;
      var found = (drillId !== null) ? byId[drillId] : undefined;
      if (found === undefined) {
        outCounts.push({ id: drillId, make: LIMITS.COUNT_MIN, attempt: LIMITS.COUNT_MIN });
        missing++;
      } else {
        outCounts.push({ id: drillId, make: found.make, attempt: found.attempt });
      }
      if (drillId !== null) { seen[drillId] = true; }
    }

    var extra = 0;
    for (i = 0; i < counts.length; i++) {
      var cid = counts[i].id;
      if (cid === null || seen[cid] !== true) { extra++; }
    }

    var outOperations = [];
    var dropped = 0;
    for (i = 0; i < operations.length; i++) {
      if (seen[operations[i].drillId] === true) {
        outOperations.push({ drillId: operations[i].drillId, type: operations[i].type });
      } else {
        dropped++;
      }
    }

    if (missing > 0) {
      issues.push(makeIssue(
        'COUNTS_MISSING_ID', 'counts',
        'メニューにあってカウントに無い種目 ' + missing + ' 件を 0 本として補完した。'
      ));
    }
    if (extra > 0) {
      issues.push(makeIssue(
        'COUNTS_EXTRA_ID', 'counts',
        'メニューに存在しない種目 ' + extra + ' 件のカウントを破棄した。'
      ));
    }
    if (dropped > 0) {
      issues.push(makeIssue(
        'OPERATIONS_DROPPED', 'operations',
        'メニューに存在しない種目を対象とする操作履歴 ' + dropped + ' 件を除去した。'
      ));
    }

    return { counts: outCounts, operations: outOperations, issues: issues };
  }

  /**
   * JSON 文字列をセッション状態へ復元する（要件 13-2, 13-6〜13-10）。
   * 例外を送出せず、常に「選択中メニューに整合する妥当な状態」と `issues` を返す。
   * 引数も保存データも変更しない（純粋関数）。
   *
   * @param {string} json 保存データ
   * @param {{id: string, drills: Array}} menu 選択中メニュー
   * @returns {{state: Object, issues: Array}}
   */
  function deserializeSession(json, menu) {
    var drills = menuDrillsOf(menu);
    var n = drills.length;
    var initial = initialSessionState(menu);

    /* --- JSON として解析できるか（要件 13-7）--- */
    if (typeof json !== 'string' || json.length === 0) {
      return {
        state: initial,
        issues: [makeIssue('PARSE_ERROR', '', '保存データが無いため練習状態を復元できなかった。')]
      };
    }
    var raw;
    try {
      raw = JSON.parse(json);
    } catch (e) {
      return {
        state: initial,
        issues: [makeIssue('PARSE_ERROR', '', '保存データを解析できなかったため練習状態を復元できなかった。')]
      };
    }
    if (!isPlainObject(raw)) {
      return {
        state: initial,
        issues: [makeIssue('NOT_OBJECT', '', '保存データの形式が異なるため練習状態を復元できなかった。')]
      };
    }

    /* --- schemaVersion の分岐（要件 13-8, 13-9）--- */
    var version = toIntegerOrNull(raw.schemaVersion);
    if (version === null || version > SCHEMA_VERSION) {
      return {
        state: initial,
        issues: [makeIssue('SCHEMA_UNSUPPORTED', 'schemaVersion',
          '保存データの形式バージョンを解釈できなかったため練習状態を復元できなかった。')]
      };
    }
    var legacy = version < SCHEMA_VERSION;

    var violations = [];

    /* --- startedAt: 文字列または null --- */
    var startedAt = initial.startedAt;
    if (hasField(raw, 'startedAt')) {
      if (raw.startedAt === null || typeof raw.startedAt === 'string') {
        startedAt = raw.startedAt;
      } else {
        violations.push(makeIssue('STARTED_AT_INVALID', 'startedAt',
          '保存データのセッション開始日時が文字列でない。'));
      }
    } else if (!legacy) {
      violations.push(makeIssue('STARTED_AT_INVALID', 'startedAt',
        '保存データにセッション開始日時が無い。'));
    }

    /* --- elapsedSec: 0〜86399 の整数（要件 13-10）--- */
    var elapsedSec = initial.elapsedSec;
    if (hasField(raw, 'elapsedSec') || !legacy) {
      var sec = toIntegerOrNull(raw.elapsedSec);
      if (sec === null || sec < LIMITS.ELAPSED_SEC_MIN || sec > LIMITS.ELAPSED_SEC_MAX) {
        violations.push(makeIssue('ELAPSED_SEC_RANGE', 'elapsedSec',
          '保存データの経過時間が 0 秒以上 ' + LIMITS.ELAPSED_SEC_MAX + ' 秒以下の整数でない。'));
      } else {
        elapsedSec = sec;
      }
    }

    /* --- menuId: 文字列 --- */
    var menuId = initial.menuId;
    if (hasField(raw, 'menuId') || !legacy) {
      if (typeof raw.menuId === 'string') {
        menuId = raw.menuId;
      } else {
        violations.push(makeIssue('MENU_ID_INVALID', 'menuId',
          '保存データの選択中メニュー識別子が文字列でない。'));
      }
    }

    /* --- activeIndex: 0〜N−1 の整数（要件 13-10, 6-7）--- */
    var activeIndex = 0;
    if (hasField(raw, 'activeIndex') || !legacy) {
      var idx = toIntegerOrNull(raw.activeIndex);
      var maxIndex = (n > 0) ? (n - 1) : 0;
      if (idx === null || idx < 0 || idx > maxIndex) {
        violations.push(makeIssue('ACTIVE_INDEX_RANGE', 'activeIndex',
          '保存データのアクティブ種目インデックスが 0 以上 ' + maxIndex + ' 以下の整数でない。'));
      } else {
        activeIndex = idx;
      }
    }

    /* --- counts: 要素数 N、各要素は 0 ≤ make ≤ attempt ≤ 999（要件 13-10）--- */
    var parsedCounts = initial.counts;
    if (hasField(raw, 'counts') || !legacy) {
      if (!isArrayValue(raw.counts) || raw.counts.length !== n) {
        violations.push(makeIssue('COUNTS_LENGTH', 'counts',
          '保存データの種目数が選択中メニューの種目数 ' + n + ' と一致しない。'));
      } else {
        var built = [];
        var countsOk = true;
        for (var ci = 0; ci < raw.counts.length; ci++) {
          var el = raw.counts[ci];
          if (!isPlainObject(el)) {
            violations.push(makeIssue('COUNTS_ELEMENT', 'counts[' + ci + ']',
              '保存データの種目カウントの形式が異なる。'));
            countsOk = false;
            break;
          }
          var elId = toIntegerOrNull(el.id);
          var make = toIntegerOrNull(el.make);
          var attempt = toIntegerOrNull(el.attempt);
          if (elId === null) {
            violations.push(makeIssue('COUNTS_ID_INVALID', 'counts[' + ci + '].id',
              '保存データの種目 id が整数でない。'));
            countsOk = false;
            break;
          }
          if (make === null || make < LIMITS.COUNT_MIN || make > LIMITS.COUNT_MAX ||
              attempt === null || attempt < LIMITS.COUNT_MIN || attempt > LIMITS.COUNT_MAX) {
            violations.push(makeIssue('COUNT_RANGE', 'counts[' + ci + ']',
              '保存データの成功数・試投数が 0 以上 ' + LIMITS.COUNT_MAX + ' 以下の整数でない。'));
            countsOk = false;
            break;
          }
          if (make > attempt) {
            violations.push(makeIssue('MAKE_GT_ATTEMPT', 'counts[' + ci + ']',
              '保存データの成功数が試投数を超えている。'));
            countsOk = false;
            break;
          }
          built.push({ id: elId, make: make, attempt: attempt });
        }
        if (countsOk) { parsedCounts = built; }
      }
    }

    /* --- operations: 0〜20 件、各要素 {drillId, type}（要件 13-10, 5-1）--- */
    var parsedOperations = [];
    if (hasField(raw, 'operations') || !legacy) {
      if (!isArrayValue(raw.operations)) {
        violations.push(makeIssue('OPERATIONS_INVALID', 'operations',
          '保存データの操作履歴が配列でない。'));
      } else if (raw.operations.length > LIMITS.OPERATION_HISTORY_MAX) {
        violations.push(makeIssue('OPERATIONS_LENGTH', 'operations',
          '保存データの操作履歴が ' + LIMITS.OPERATION_HISTORY_MAX + ' 件を超えている。'));
      } else {
        var builtOps = [];
        var opsOk = true;
        for (var oi = 0; oi < raw.operations.length; oi++) {
          var op = raw.operations[oi];
          var drillId = isPlainObject(op) ? toIntegerOrNull(op.drillId) : null;
          if (drillId === null || !isPlainObject(op) || !isCountType(op.type)) {
            violations.push(makeIssue('OPERATIONS_ELEMENT', 'operations[' + oi + ']',
              '保存データの操作履歴の形式が異なる。'));
            opsOk = false;
            break;
          }
          builtOps.push({ drillId: drillId, type: op.type });
        }
        if (opsOk) { parsedOperations = builtOps; }
      }
    }

    /* --- ended: 真偽値 --- */
    var ended = false;
    if (hasField(raw, 'ended') || !legacy) {
      if (typeof raw.ended === 'boolean') {
        ended = raw.ended;
      } else {
        violations.push(makeIssue('ENDED_INVALID', 'ended',
          '保存データのセッション終了区分が真偽値でない。'));
      }
    }

    /* --- 値域違反が 1 件でもあれば初期状態（要件 13-10）--- */
    if (violations.length > 0) {
      return { state: initial, issues: violations };
    }

    /* --- メニューの種目 id 集合を正として整合させる（要件 1-10, 6-10, 6-11）--- */
    var reconciled = reconcileWithMenu(parsedCounts, parsedOperations, drills);

    return {
      state: {
        schemaVersion: SCHEMA_VERSION,
        startedAt: startedAt,
        elapsedSec: elapsedSec,
        menuId: menuId,
        activeIndex: activeIndex,
        counts: reconciled.counts,
        operations: reconciled.operations,
        ended: ended
      },
      issues: reconciled.issues
    };
  }

  /* ------------------------------------------------------------------------
   * 2-5. メニュー直列化と検証 … タスク 7.2
   *      serializeMenus / deserializeMenus / validateMenu（+ deriveTargetTotal）
   *
   * === Menu_Record は 3 フィールドのみ ==============================
   *   id / name / drills
   * `targetTotal` は保持せず、`deriveTargetTotal(menu)` で `targetMake` の総和
   * として算出する派生値である（リテラル 125 を算出経路に持たない）。
   * `deriveTargetTotal` は設計上タスク 8.1 の一覧に載るが、`validateMenu` の
   * 目標合計 1〜9999 の検査が依存するため定義はここ 1 箇所のみに置く
   * （2-6 は再定義しない）。
   *
   * === 文字数の単位 =================================================
   * 「1〜30 文字」「1〜40 文字」「0〜20 文字」はいずれも人間が数える文字数を
   * 指すため、UTF-16 コード単位ではなくコードポイント単位で数える
   * （2-1 の切り詰めと同じ立場。絵文字 1 個は 1 文字）。
   *
   * === validateMenu の責務境界 ======================================
   * 単一メニューの内部制約（メニュー名・種目数・種目 id の一意性・各種目の
   * 値域・目標合計）は引数の menu だけで判定できる。一方、メニュー数 1〜20 と
   * メニュー名の集合内一意は集合の情報を要するため、第 2 引数 `context`
   * （`{menuCount, otherNames}`、いずれも省略可）で渡す。省略されたものは
   * 検査しない。これにより「1 件のメニューを編集して保存する」経路
   * （タスク 10.3 / 18.1）と「集合をまとめて復元する」経路（deserializeMenus）
   * が同一の違反コード表を共有する。
   * ---------------------------------------------------------------------- */

  /** 文字数（コードポイント単位）。文字列でなければ −1 を返す。 */
  function codePointLength(value) {
    if (typeof value !== 'string') { return -1; }
    var count = 0;
    for (var i = 0; i < value.length; i++) {
      var code = value.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF && i + 1 < value.length) {
        var next = value.charCodeAt(i + 1);
        if (next >= 0xDC00 && next <= 0xDFFF) { i++; }
      }
      count++;
    }
    return count;
  }

  /**
   * 目標合計（選択中メニューの targetMake 総和）を算出する（要件 8-4, 17-6）。
   * 整数でない targetMake は 0 として扱う（検証は validateMenu の責務）。
   *
   * @param {{drills: Array}} menu
   * @returns {number} 0 以上の整数
   */
  function deriveTargetTotal(menu) {
    var drills = menuDrillsOf(menu);
    var total = 0;
    for (var i = 0; i < drills.length; i++) {
      var drill = drills[i];
      if (drill === null || typeof drill !== 'object') { continue; }
      var target = toIntegerOrNull(drill.targetMake);
      if (target !== null && target > 0) { total += target; }
    }
    return total;
  }

  /**
   * Menu_Record を検証する（要件 13-13, 17-4, 17-5, 17-7, 18-3, 18-4, 18-6）。
   *
   * @param {Object} menu 検証対象の Menu_Record
   * @param {{menuCount: (number|undefined), otherNames: (Array|undefined)}} [context]
   *   `menuCount` を与えるとメニュー数 1〜20 を検査する。
   *   `otherNames` を与えるとメニュー名の集合内一意を検査する。
   * @returns {{ok: boolean, violations: Array<{code: string, field: string, message: string}>}}
   */
  function validateMenu(menu, context) {
    var ctx = isPlainObject(context) ? context : {};
    var violations = [];

    /* --- 集合レベル: メニュー数 1〜20（要件 18-3, 13-13）--- */
    if (ctx.menuCount !== undefined) {
      var menuCount = toIntegerOrNull(ctx.menuCount);
      if (menuCount === null ||
          menuCount < LIMITS.MENU_COUNT_MIN ||
          menuCount > LIMITS.MENU_COUNT_MAX) {
        violations.push(makeIssue('MENU_COUNT_RANGE', 'menus',
          'メニュー数は ' + LIMITS.MENU_COUNT_MIN + ' 個以上 ' +
          LIMITS.MENU_COUNT_MAX + ' 個以下にする。'));
      }
    }

    if (!isPlainObject(menu)) {
      violations.push(makeIssue('MENU_INVALID', '', 'メニューの形式が異なる。'));
      return { ok: false, violations: violations };
    }

    /* --- id: 1 文字以上の文字列 --- */
    if (typeof menu.id !== 'string' || menu.id.length === 0) {
      violations.push(makeIssue('MENU_ID_INVALID', 'id', 'メニュー識別子が空である。'));
    }

    /* --- name: 1〜30 文字かつ集合内一意（要件 18-3, 18-4, 13-13）--- */
    var nameLength = codePointLength(menu.name);
    if (nameLength < LIMITS.MENU_NAME_MIN || nameLength > LIMITS.MENU_NAME_MAX) {
      violations.push(makeIssue('MENU_NAME_LENGTH', 'name',
        'メニュー名は ' + LIMITS.MENU_NAME_MIN + ' 文字以上 ' +
        LIMITS.MENU_NAME_MAX + ' 文字以下にする。'));
    } else if (isArrayValue(ctx.otherNames)) {
      for (var oi = 0; oi < ctx.otherNames.length; oi++) {
        if (ctx.otherNames[oi] === menu.name) {
          violations.push(makeIssue('MENU_NAME_DUPLICATE', 'name',
            '同じ名前のメニューが既にある。'));
          break;
        }
      }
    }

    /* --- drills: 要素数 1〜50（要件 17-4, 13-13）--- */
    if (!isArrayValue(menu.drills)) {
      violations.push(makeIssue('DRILL_COUNT_RANGE', 'drills',
        '種目数は ' + LIMITS.DRILL_COUNT_MIN + ' 個以上 ' +
        LIMITS.DRILL_COUNT_MAX + ' 個以下にする。'));
      return { ok: violations.length === 0, violations: violations };
    }

    var drills = menu.drills;
    if (drills.length < LIMITS.DRILL_COUNT_MIN || drills.length > LIMITS.DRILL_COUNT_MAX) {
      violations.push(makeIssue('DRILL_COUNT_RANGE', 'drills',
        '種目数は ' + LIMITS.DRILL_COUNT_MIN + ' 個以上 ' +
        LIMITS.DRILL_COUNT_MAX + ' 個以下にする。'));
    }

    /* --- 各種目の値域と id のメニュー内一意（要件 17-2, 17-4, 13-13）--- */
    var seenIds = Object.create(null);
    for (var i = 0; i < drills.length; i++) {
      var drill = drills[i];
      var path = 'drills[' + i + ']';
      if (!isPlainObject(drill)) {
        violations.push(makeIssue('DRILL_INVALID', path, '種目の形式が異なる。'));
        continue;
      }

      var id = toIntegerOrNull(drill.id);
      if (id === null || id < 1) {
        violations.push(makeIssue('DRILL_ID_INVALID', path + '.id',
          '種目 id は 1 以上の整数にする。'));
      } else if (seenIds[id] === true) {
        violations.push(makeIssue('DRILL_ID_DUPLICATE', path + '.id',
          '種目 id ' + id + ' がメニュー内で重複している。'));
      } else {
        seenIds[id] = true;
      }

      var drillNameLength = codePointLength(drill.name);
      if (drillNameLength < LIMITS.DRILL_NAME_MIN || drillNameLength > LIMITS.DRILL_NAME_MAX) {
        violations.push(makeIssue('DRILL_NAME_LENGTH', path + '.name',
          '種目名は ' + LIMITS.DRILL_NAME_MIN + ' 文字以上 ' +
          LIMITS.DRILL_NAME_MAX + ' 文字以下にする。'));
      }

      // section は自由文字列で空文字を許容する（要件 17-5）
      var sectionLength = codePointLength(drill.section);
      if (sectionLength < LIMITS.DRILL_SECTION_MIN || sectionLength > LIMITS.DRILL_SECTION_MAX) {
        violations.push(makeIssue('DRILL_SECTION_LENGTH', path + '.section',
          'セクション名は ' + LIMITS.DRILL_SECTION_MAX + ' 文字以下にする（空欄も可）。'));
      }

      var targetMake = toIntegerOrNull(drill.targetMake);
      if (targetMake === null ||
          targetMake < LIMITS.TARGET_MAKE_MIN ||
          targetMake > LIMITS.TARGET_MAKE_MAX) {
        violations.push(makeIssue('TARGET_MAKE_RANGE', path + '.targetMake',
          '目標成功数は ' + LIMITS.TARGET_MAKE_MIN + ' 以上 ' +
          LIMITS.TARGET_MAKE_MAX + ' 以下の整数にする。'));
      }
    }

    /* --- 目標合計 1〜9999（派生値。要件 17-4, 13-13）--- */
    var targetTotal = deriveTargetTotal(menu);
    if (targetTotal < LIMITS.TARGET_TOTAL_MIN || targetTotal > LIMITS.TARGET_TOTAL_MAX) {
      violations.push(makeIssue('TARGET_TOTAL_RANGE', 'drills',
        '目標合計は ' + LIMITS.TARGET_TOTAL_MIN + ' 以上 ' +
        LIMITS.TARGET_TOTAL_MAX + ' 以下にする。'));
    }

    return { ok: violations.length === 0, violations: violations };
  }

  /**
   * Menu_Record の集合を 1 個の JSON 文字列へ変換する（要件 13-11, 13-12）。
   * キー順は Menu_Record が `id` / `name` / `drills`、Drill が
   * `id` / `section` / `name` / `targetMake` に固定される（決定性）。
   *
   * @param {Array} menus
   * @returns {string} JSON 文字列
   */
  function serializeMenus(menus) {
    var src = isArrayValue(menus) ? menus : [];
    var out = [];
    for (var i = 0; i < src.length; i++) {
      var menu = src[i];
      if (!isPlainObject(menu)) { continue; }
      var drills = menuDrillsOf(menu);
      var outDrills = [];
      for (var j = 0; j < drills.length; j++) {
        var drill = cloneMenuDrill(drills[j]);
        outDrills.push({
          id: (toIntegerOrNull(drill.id) === null) ? null : drill.id,
          section: (typeof drill.section === 'string') ? drill.section : '',
          name: (typeof drill.name === 'string') ? drill.name : '',
          targetMake: (toIntegerOrNull(drill.targetMake) === null) ? null : drill.targetMake
        });
      }
      out.push({
        id: (typeof menu.id === 'string') ? menu.id : '',
        name: (typeof menu.name === 'string') ? menu.name : '',
        drills: outDrills
      });
    }
    return JSON.stringify(out);
  }

  /**
   * JSON 文字列を Menu_Record の集合へ復元する（要件 13-11, 13-13, 13-14, 18-6）。
   * 例外を送出せず、常に 1 件以上のメニューを含む集合と `issues` を返す。
   *
   * 検証違反のあるメニューは集合から除外し、除外後 0 件になる場合は既定メニュー
   * 1 件のみを返す。メニュー名の一意性は「先に受理したメニュー」を優先して判定し、
   * 21 件目以降は受理しない（メニュー数 1〜20）。
   *
   * @param {string} json 保存データ
   * @returns {{menus: Array, issues: Array}}
   */
  function deserializeMenus(json) {
    var issues = [];
    var raw = null;

    if (typeof json !== 'string' || json.length === 0) {
      issues.push(makeIssue('PARSE_ERROR', 'menus',
        '保存データが無いためメニュー定義を復元できなかった。'));
      return { menus: [createDefaultMenu()], issues: issues };
    }
    try {
      raw = JSON.parse(json);
    } catch (e) {
      issues.push(makeIssue('PARSE_ERROR', 'menus',
        '保存データを解析できなかったためメニュー定義を復元できなかった。'));
      return { menus: [createDefaultMenu()], issues: issues };
    }
    if (!isArrayValue(raw)) {
      issues.push(makeIssue('NOT_ARRAY', 'menus',
        '保存データの形式が異なるためメニュー定義を復元できなかった。'));
      return { menus: [createDefaultMenu()], issues: issues };
    }

    var accepted = [];
    var acceptedNames = [];

    for (var i = 0; i < raw.length; i++) {
      var candidate = coerceMenuRecord(raw[i]);
      if (candidate === null) {
        issues.push(makeIssue('MENU_INVALID', 'menus[' + i + ']',
          i + 1 + ' 番目のメニュー定義を復元できなかった。'));
        continue;
      }
      if (accepted.length >= LIMITS.MENU_COUNT_MAX) {
        issues.push(makeIssue('MENU_COUNT_RANGE', 'menus[' + i + ']',
          'メニュー数の上限 ' + LIMITS.MENU_COUNT_MAX + ' 個を超える分を除外した。'));
        continue;
      }
      var result = validateMenu(candidate, { otherNames: acceptedNames });
      if (!result.ok) {
        issues.push(makeIssue('MENU_EXCLUDED', 'menus[' + i + ']',
          i + 1 + ' 番目のメニュー定義が制約を満たさないため除外した（' +
          firstViolationCodes(result.violations) + '）。'));
        continue;
      }
      accepted.push(candidate);
      acceptedNames.push(candidate.name);
    }

    if (accepted.length === 0) {
      issues.push(makeIssue('MENU_SET_EMPTY', 'menus',
        'メニュー定義を復元できなかったため既定メニューを使用する。'));
      return { menus: [createDefaultMenu()], issues: issues };
    }

    return { menus: accepted, issues: issues };
  }

  /**
   * 復元対象を Menu_Record の 3 フィールドへ写す。
   * **値は変換しない**（検証は validateMenu の責務。不正値をそのまま渡して
   * 違反として検出させる）。オブジェクトでない要素のみ null を返す。
   */
  function coerceMenuRecord(value) {
    if (!isPlainObject(value)) { return null; }
    var drills = value.drills;
    if (isArrayValue(drills)) {
      var out = [];
      for (var i = 0; i < drills.length; i++) {
        out.push(isPlainObject(drills[i]) ? cloneMenuDrill(drills[i]) : drills[i]);
      }
      drills = out;
    }
    return { id: value.id, name: value.name, drills: drills };
  }

  /** 違反コードを重複なく最大 3 個まで列挙した文字列（メッセージ用）。 */
  function firstViolationCodes(violations) {
    var codes = [];
    for (var i = 0; i < violations.length && codes.length < 3; i++) {
      if (codes.indexOf(violations[i].code) === -1) { codes.push(violations[i].code); }
    }
    return codes.join(', ');
  }

  /* ------------------------------------------------------------------------
   * 2-6. 経過時間・表示算出・履歴順序 … タスク 8.1
   *      elapsedFrom / formatElapsed / progressRatio / aggregateBySection /
   *      formatRate / sortHistoryIndex
   *      （deriveTargetTotal は validateMenu が依存するため 2-5 に定義済み）
   *
   * 本小節も 2-1〜2-5 と同じ方針（引数以外を読まない・書かない、例外を送出
   * しない、DOM と現在時刻に触れない）に従う。**現在時刻は必ず引数で受け取る**。
   * これにより Session_Timer（3-9）が時刻の供給だけを担い、単調性と飽和の
   * 判定は純粋関数側で完結する（Property 12）。
   *
   * === 目標合計にリテラル 125 を持たない（前提 7）==================
   * 目標合計は常に `deriveTargetTotal(menu)`（= targetMake の総和）である。
   * 125 / 13 種目 / 20・40・30・35 は既定メニューの初期内容としてのみ
   * `DRILL_MENU` に現れ、算出経路には現れない。
   * ---------------------------------------------------------------------- */

  /**
   * 開始時刻・一時停止累計・直前報告値・現在時刻から経過秒を算出する
   * （要件 11-8, 11-9。Property 12）。
   *
   * 単調非減少は「直前に報告した値（`lastReportedSec`）を下回らない」という
   * 形で保証する。端末の時計が過去方向へ変更されても、大幅に前進しても、
   * 戻り値は常に `0 ≤ e ≤ 86399` の整数であり、一度 86399 に達したら以後
   * 86399 のままである。
   *
   * @param {number} startedAtMs 開始時刻（epoch ミリ秒）
   * @param {number} pausedTotalMs 一時停止の累計ミリ秒（負値は 0 として扱う）
   * @param {number} lastReportedSec 直前に報告した経過秒（初回は 0）
   * @param {number} nowMs 現在時刻（epoch ミリ秒）
   * @returns {number} 0〜86399 の整数
   */
  function elapsedFrom(startedAtMs, pausedTotalMs, lastReportedSec, nowMs) {
    var floor = clampElapsedSec(lastReportedSec);
    if (floor >= LIMITS.ELAPSED_SEC_MAX) { return LIMITS.ELAPSED_SEC_MAX; }

    var started = (typeof startedAtMs === 'number' && isFinite(startedAtMs)) ? startedAtMs : null;
    var now = (typeof nowMs === 'number' && isFinite(nowMs)) ? nowMs : null;
    if (started === null || now === null) { return floor; }

    var paused = (typeof pausedTotalMs === 'number' && isFinite(pausedTotalMs) && pausedTotalMs > 0)
      ? pausedTotalMs
      : 0;

    var raw = Math.floor((now - started - paused) / 1000);
    var candidate = clampElapsedSec(raw);
    return (candidate > floor) ? candidate : floor;
  }

  /** 2 桁ゼロ埋め。 */
  function pad2(n) {
    return (n < 10) ? ('0' + n) : String(n);
  }

  /**
   * 経過秒を表示形式へ変換する（要件 11-3）。
   * 3600 秒未満は `mm:ss`（分と秒をそれぞれ 2 桁ゼロ埋め）、
   * 3600 秒以上は `h:mm:ss`。
   *
   * @param {number} sec
   * @returns {string}
   */
  function formatElapsed(sec) {
    var total = clampElapsedSec(sec);
    var s = total % 60;
    var m = Math.floor(total / 60) % 60;
    var h = Math.floor(total / 3600);
    if (total < 3600) { return pad2(m) + ':' + pad2(s); }
    return String(h) + ':' + pad2(m) + ':' + pad2(s);
  }

  /**
   * 全体進捗バーの充填率（要件 8-5）。
   * 全体成功数 ÷ 目標合計 × 100 を小数第 1 位まで丸め、100 で上限打ち切りする。
   *
   * 目標合計が 0 以下（不正なメニュー）のときは、全体成功数が 1 以上なら 100、
   * 0 なら 0 を返す（0 除算を発生させない）。
   *
   * @param {number} totalMake 全体成功数
   * @param {number} target 目標合計
   * @returns {number} 0〜100（小数第 1 位）
   */
  function progressRatio(totalMake, target) {
    var make = toIntegerOrNull(totalMake);
    if (make === null || make < 0) { make = 0; }
    var goal = toIntegerOrNull(target);
    if (goal === null || goal <= 0) { return (make > 0) ? 100 : 0; }
    if (make >= goal) { return 100; }
    var ratio = Math.round(make / goal * 1000) / 10;
    if (ratio < 0) { return 0; }
    if (ratio > 100) { return 100; }
    return ratio;
  }

  /**
   * 表示領域の寸法から種目一覧の表示形式を決める（要件 8-9, 8-10, 8-11）。
   *
   *   縦向き（高さ ≥ 幅）で長辺が 568 CSS ピクセル未満 → `'aggregate'`
   *     （種目一覧を section 単位の集約表示へ切り替える。要件 8-10）
   *   それ以外（長辺 568 以上の縦向き / 幅 > 高さの横向き）→ `'list'`
   *     （種目一覧を縦スクロール領域として 1 種目 1 行で表示する。要件 8-9, 8-11）
   *
   * 純粋関数なので境界（567 / 568 / 569）を単体テストで直接確認できる。
   *
   * @param {number} width CSS ピクセル
   * @param {number} height CSS ピクセル
   * @returns {('list'|'aggregate')}
   */
  function layoutModeFor(width, height) {
    var w = (typeof width === 'number' && isFinite(width) && width > 0) ? width : 0;
    var h = (typeof height === 'number' && isFinite(height) && height > 0) ? height : 0;
    if (w > h) { return 'list'; }
    var longSide = (h > w) ? h : w;
    return (longSide < LAYOUT_PORTRAIT_LONG_MIN) ? 'aggregate' : 'list';
  }

  /** section の表示キー（文字列でない値は空文字として扱う）。 */
  function sectionKeyOf(drill) {
    if (drill === null || typeof drill !== 'object') { return ''; }
    return (typeof drill.section === 'string') ? drill.section : '';
  }

  /** deriveTargetTotal と同一の採用規則（1 以上の整数のみ加算する）。 */
  function targetMakeOf(drill) {
    if (drill === null || typeof drill !== 'object') { return 0; }
    var target = toIntegerOrNull(drill.targetMake);
    return (target !== null && target > 0) ? target : 0;
  }

  /**
   * 種目一覧を section 単位に集約する（要件 8-10, 17-6）。
   * 行の並びは section が最初に現れた順。同一 section は 1 行に集約し、
   * Make 合計と targetMake 合計を保存する。
   *
   * カウントは種目 id で対応付ける（配列順に依存しない）。集約の保存則
   *   Σ row.make       === totals(counts).make
   *   Σ row.targetMake === deriveTargetTotal(menu)
   * が成立するよう、`targetMake` の採用規則は deriveTargetTotal と揃える。
   *
   * @param {{drills: Array}} menu
   * @param {Array} counts `[{id, make, attempt}, ...]`
   * @returns {Array<{section: string, make: number, targetMake: number}>}
   */
  function aggregateBySection(menu, counts) {
    var drills = menuDrillsOf(menu);
    var normalized = normalizeCounts(counts);

    var makeById = Object.create(null);
    for (var c = 0; c < normalized.length; c++) {
      var cid = normalized[c].id;
      if (cid === null) { continue; }
      if (makeById[cid] === undefined) { makeById[cid] = normalized[c].make; }
    }

    var rows = [];
    var rowIndexBySection = Object.create(null);
    for (var i = 0; i < drills.length; i++) {
      var drill = drills[i];
      var key = sectionKeyOf(drill);
      var drillId = (drill !== null && typeof drill === 'object') ? toIntegerOrNull(drill.id) : null;
      var make = (drillId !== null && makeById[drillId] !== undefined) ? makeById[drillId] : 0;

      // Object.create(null) でも '__proto__' のような値をキーにできるよう接頭辞を付ける
      var mapKey = 's:' + key;
      var at = rowIndexBySection[mapKey];
      if (at === undefined) {
        rowIndexBySection[mapKey] = rows.length;
        rows.push({ section: key, make: make, targetMake: targetMakeOf(drill) });
      } else {
        rows[at].make += make;
        rows[at].targetMake += targetMakeOf(drill);
      }
    }
    return rows;
  }

  /**
   * 成功率の表示値（要件 4-5, 4-6, 14-4）。
   * `attempt` が 0 のときは `'--%'`、それ以外は小数第 1 位までの `xx.x%`。
   * 戻り値は常に `/^--%$/` または `/^\d{1,3}\.\d%$/` に一致する。
   *
   * @param {number} make
   * @param {number} attempt
   * @returns {string}
   */
  function formatRate(make, attempt) {
    var rate = successRate(make, attempt);
    if (rate === null) { return '--%'; }
    return rate.toFixed(1) + '%';
  }

  /**
   * 履歴インデックスを「終了日時の降順 → 識別子の降順」で並べる
   * （要件 14-2, 14-6, 12-6。Property 17）。
   *
   * 識別子は一意であるため、この 2 段の比較は全順序になる。したがって結果は
   * 入力順に依存せず、同一の履歴集合に対して常に同一の並びになる。
   * 最古の 1 件（終了日時が最小、同値では識別子が最小）は結果の末尾要素である。
   *
   * 終了日時は数値（epoch ミリ秒）または ISO 8601 文字列を受け付ける。
   * 文字列は `Date.parse` で数値化し、解釈できない値は最小として末尾に寄せる。
   * 識別子は双方が数値のときのみ数値比較し、それ以外は文字列として比較する。
   *
   * 引数は変更せず、新しい配列を返す。
   *
   * @param {Array<{id: *, endedAt: *}>} entries
   * @returns {Array} 並べ替えた新しい配列（要素は入力の要素参照をそのまま持つ）
   */
  function sortHistoryIndex(entries) {
    var src = isArrayValue(entries) ? entries : [];
    var decorated = [];
    for (var i = 0; i < src.length; i++) {
      var entry = src[i];
      decorated.push({
        entry: entry,
        time: historyTimeKey(entry),
        id: (entry !== null && typeof entry === 'object') ? entry.id : undefined
      });
    }
    decorated.sort(function (a, b) {
      if (a.time !== b.time) { return (a.time < b.time) ? 1 : -1; }
      return compareHistoryIds(b.id, a.id);
    });
    var out = [];
    for (var k = 0; k < decorated.length; k++) { out.push(decorated[k].entry); }
    return out;
  }

  /** 終了日時の比較キー。解釈できない値は -Infinity（最も古い扱い）。 */
  function historyTimeKey(entry) {
    if (entry === null || typeof entry !== 'object') { return -Infinity; }
    var value = entry.endedAt;
    if (typeof value === 'number' && isFinite(value)) { return value; }
    if (typeof value === 'string') {
      var parsed = Date.parse(value);
      if (!isNaN(parsed)) { return parsed; }
    }
    return -Infinity;
  }

  /** 識別子の昇順比較。双方が数値のときのみ数値比較、それ以外は文字列比較。 */
  function compareHistoryIds(a, b) {
    if (typeof a === 'number' && typeof b === 'number' && isFinite(a) && isFinite(b)) {
      if (a === b) { return 0; }
      return (a < b) ? -1 : 1;
    }
    var sa = (a === undefined || a === null) ? '' : String(a);
    var sb = (b === undefined || b === null) ? '' : String(b);
    if (sa === sb) { return 0; }
    return (sa < sb) ? -1 : 1;
  }

  /**
   * 履歴レコードを組み立てる（要件 14-1。設計 Data Models / History_Record）。
   * 純粋関数であり、識別子と終了日時は呼び出し側が与える。
   *
   * @param {{id: string, endedAt: string, completionSec: number,
   *          menu: object, counts: Array}} params
   * @returns {Object} History_Record（12 フィールド、キー順固定）
   */
  function buildHistoryRecord(params) {
    var p = isPlainObject(params) ? params : {};
    var menu = p.menu || null;
    var drills = menuDrillsOf(menu);
    var counts = normalizeCounts(p.counts);

    var byId = Object.create(null);
    var i;
    for (i = 0; i < counts.length; i++) {
      if (counts[i].id !== null && byId[counts[i].id] === undefined) {
        byId[counts[i].id] = counts[i];
      }
    }

    var snapshot = [];
    var totalMake = 0;
    var totalAttempt = 0;
    for (i = 0; i < drills.length; i++) {
      var drill = drills[i];
      var id = (drill !== null && typeof drill === 'object') ? toIntegerOrNull(drill.id) : null;
      var c = (id !== null && byId[id] !== undefined)
        ? byId[id]
        : { make: LIMITS.COUNT_MIN, attempt: LIMITS.COUNT_MIN };
      totalMake += c.make;
      totalAttempt += c.attempt;
      snapshot.push({
        name: (drill !== null && typeof drill === 'object' && typeof drill.name === 'string')
          ? drill.name
          : '',
        targetMake: targetMakeOf(drill),
        make: c.make,
        attempt: c.attempt,
        rate: successRate(c.make, c.attempt)
      });
    }

    var targetTotal = deriveTargetTotal(menu);
    return {
      schemaVersion: SCHEMA_VERSION,
      id: (typeof p.id === 'string') ? p.id : '',
      endedAt: (typeof p.endedAt === 'string') ? p.endedAt : '',
      completionSec: clampElapsedSec(p.completionSec),
      menuId: (menu !== null && typeof menu === 'object' && typeof menu.id === 'string')
        ? menu.id
        : '',
      menuName: (menu !== null && typeof menu === 'object' && typeof menu.name === 'string')
        ? menu.name
        : '',
      targetTotal: targetTotal,
      totalMake: totalMake,
      totalAttempt: totalAttempt,
      totalRate: successRate(totalMake, totalAttempt),
      achieved: (targetTotal > 0 && totalMake >= targetTotal),
      drills: snapshot
    };
  }

  /**
   * 履歴レコードの識別子（`h-{base36 時刻}-{4 文字乱数}`。設計 Data Models）。
   * 乱数と現在時刻を引数で受け取るため、テストから決定的に扱える。
   */
  function makeHistoryId(nowMs, random) {
    var stamp = Math.floor((typeof nowMs === 'number' && isFinite(nowMs)) ? nowMs : 0).toString(36);
    var rnd = (typeof random === 'function') ? random : Math.random;
    var alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    var suffix = '';
    for (var i = 0; i < 4; i++) {
      suffix += alphabet.charAt(Math.floor(rnd() * alphabet.length) % alphabet.length);
    }
    return 'h-' + stamp + '-' + suffix;
  }

  /**
   * 終了日時の一覧表示形式（`YYYY-MM-DD HH:MM`、端末のローカルタイムゾーン。
   * 要件 14-3）。解釈できない値はそのまま返す。
   */
  function formatEndedAt(value) {
    var ms = (typeof value === 'number' && isFinite(value)) ? value
      : (typeof value === 'string') ? Date.parse(value) : NaN;
    if (isNaN(ms)) { return (typeof value === 'string') ? value : ''; }
    var date = new Date(ms);
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) +
      ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes());
  }

  /* ==========================================================================
   * 3. 副作用レイヤ領域
   * --------------------------------------------------------------------------
   * DOM / localStorage / Web Speech API / Wake Lock API / Service Worker /
   * タイマーへの副作用はこの節のファクトリ関数の内部にのみ存在する。
   * 状態マネージャは DOM を直接触らず、レンダラは状態を書き換えない
   * （単一方向データフロー: 入力 → Command_Dispatcher → 状態 → レンダラ → 永続化）。
   * ========================================================================== */

  /* ---- 3-1. Storage_Adapter … タスク 11.1 / 11.2 / 11.3 --------------------
   * createStorageAdapter({ storage, now, timeoutMs })
   *   guarded(key, fn) による 1000ms タイムアウト保証、拒否値 {code, key, message}
   *   localStorage の直接呼び出しはこの節の内部のみ。接頭辞 `vsc:` 以外の鍵は
   *   読まず・変更せず・削除しない（要件 12-3）。公開関数 13 個はすべて Promise を返す。
   *     saveSession / loadSession / deleteSession                … 11.1
   *     saveSettings / loadSettings                              … 11.1
   *     saveActiveMenuId / loadActiveMenuId                      … 11.1
   *     appendHistory / listHistory / deleteHistory              … 11.2
   *     listMenus / saveMenu / deleteMenu                        … 11.3
   *
   * === 設計シグネチャからの 2 点の相違（いずれも要件が要求する情報の受け渡し）
   * 1. `loadSession(menu)` は選択中メニューを引数に取り、`{state, issues}` か
   *    `null`（保存データなし）を返す。復元には種目 id 集合との整合（要件 1-10,
   *    6-10, 6-11）が必要で、それは選択中メニューを見ないと決まらない。
   * 2. `listMenus()` は `{menus, issues}` を返す。要件 13-14 は「復元できな
   *    かったことを示すメッセージ」を要求するため、除外の事実を呼び出し側へ
   *    渡す必要がある。
   *
   * === 偽 storage の注入 ============================================
   * `deps.storage` を渡すとその実装を使う（既定は `window.localStorage`）。
   * 容量超過・書き込み検証失敗・タイムアウトの単体テスト（11.5 / 11.6）は
   * この注入だけで成立し、実際の localStorage を汚さない。
   * ------------------------------------------------------------------------ */

  /** 唯一の共通接頭辞（要件 12-3）。 */
  var STORAGE_PREFIX = 'vsc:';

  var STORAGE_KEYS = deepFreeze({
    SESSION: STORAGE_PREFIX + 'session',
    MENUS: STORAGE_PREFIX + 'menus',
    ACTIVE_MENU_ID: STORAGE_PREFIX + 'activeMenuId',
    SETTINGS: STORAGE_PREFIX + 'settings',
    HISTORY_INDEX: STORAGE_PREFIX + 'hist:index',
    HISTORY_ITEM: STORAGE_PREFIX + 'hist:',
    PROBE: STORAGE_PREFIX + 'probe'
  });

  /** 拒否値の code 集合（設計「Storage_Adapter の関数シグネチャ一覧」）。 */
  var STORAGE_CODES = deepFreeze([
    'QUOTA_EXCEEDED', 'UNAVAILABLE', 'VERIFY_MISMATCH', 'NOT_FOUND', 'INVALID', 'TIMEOUT'
  ]);

  /** 公開関数の 1 回の呼び出しに与える上限（要件 12-2）。 */
  var STORAGE_TIMEOUT_MS = 1000;

  /** 設定の既定値（要件 10-9, 10-10）。`powerSave: null` は「未設定」。 */
  var DEFAULT_SETTINGS = deepFreeze({ schemaVersion: SCHEMA_VERSION, powerSave: null });

  function storageReason(code, key, message) {
    return { code: code, key: key, message: message };
  }

  /** 例外を拒否値へ写す。既に拒否値の形をしているものはそのまま通す。 */
  function toStorageReason(error, key) {
    if (isPlainObject(error) && typeof error.code === 'string' &&
        STORAGE_CODES.indexOf(error.code) !== -1) {
      return storageReason(error.code, (typeof error.key === 'string') ? error.key : key,
        (typeof error.message === 'string') ? error.message : '保存処理に失敗した。');
    }
    var name = (error && typeof error.name === 'string') ? error.name : '';
    var code = (error && typeof error.code === 'number') ? error.code : null;
    if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22) {
      return storageReason('QUOTA_EXCEEDED', key, '保存領域の空きが足りない。');
    }
    return storageReason('UNAVAILABLE', key, '保存領域を利用できない。');
  }

  function createStorageAdapter(deps) {
    var options = isPlainObject(deps) ? deps : {};
    var timeoutMs = (typeof options.timeoutMs === 'number' && options.timeoutMs > 0)
      ? options.timeoutMs
      : STORAGE_TIMEOUT_MS;

    var backing = options.storage;
    if (backing === undefined || backing === null) {
      try {
        backing = (typeof window !== 'undefined') ? window.localStorage : null;
      } catch (e) {
        backing = null;
      }
    }

    /*
     * タイマーの差し替え口。既定は setTimeout / clearTimeout。
     * localStorage は同期 API なので実運用では締切に到達しないが、要件 12-2 は
     * 「1000ms 以内に解決または拒否する」ことを保証として要求しており、将来
     * 本体を `fetch` に差し替えた際にこの締切がそのまま効く必要がある。
     * この 2 個を注入できるようにすることで、締切側の分岐を単体テストで
     * 検証できる（タスク 11.6）。
     */
    var setTimer = (typeof options.setTimer === 'function') ? options.setTimer : function (fn, ms) {
      return setTimeout(fn, ms);
    };
    var clearTimer = (typeof options.clearTimer === 'function')
      ? options.clearTimer
      : function (handle) { clearTimeout(handle); };

    /* ---- 低水準アクセス（接頭辞の検査をここに集約する）------------------ */

    function assertOwnKey(key) {
      if (typeof key !== 'string' || key.indexOf(STORAGE_PREFIX) !== 0) {
        throw storageReason('INVALID', String(key),
          '接頭辞 ' + STORAGE_PREFIX + ' を持たない鍵は操作しない。');
      }
    }

    function requireBacking(key) {
      if (backing === null || typeof backing.getItem !== 'function') {
        throw storageReason('UNAVAILABLE', key, '保存領域を利用できない。');
      }
    }

    function rawGet(key) {
      assertOwnKey(key);
      requireBacking(key);
      return backing.getItem(key);
    }

    function rawSet(key, value) {
      assertOwnKey(key);
      requireBacking(key);
      backing.setItem(key, value);
    }

    function rawRemove(key) {
      assertOwnKey(key);
      requireBacking(key);
      backing.removeItem(key);
    }

    /** 書き込み → 読込 → 照合（要件 12-7 の「保存直後の読込値不一致」の検知）。 */
    function writeVerified(key, value) {
      rawSet(key, value);
      var readBack = rawGet(key);
      if (readBack !== value) {
        throw storageReason('VERIFY_MISMATCH', key, '保存した内容を読み直せなかった。');
      }
    }

    /** `vsc:probe` による書き込み→読込→削除の検証。検証後に必ず削除する。 */
    function probe() {
      var token = 'p' + String(Date.now());
      writeVerified(STORAGE_KEYS.PROBE, token);
      rawRemove(STORAGE_KEYS.PROBE);
      return true;
    }

    /**
     * 公開関数の共通ラッパ（設計「実装の共通ラッパ」）。
     * 同期例外を送出せず、必ず 1000ms 以内に解決または拒否する（要件 12-2）。
     */
    function guarded(key, fn) {
      return new Promise(function (resolve, reject) {
        var settled = false;
        var timer = setTimer(function () {
          if (!settled) {
            settled = true;
            reject(storageReason('TIMEOUT', key, '保存処理が時間内に完了しなかった。'));
          }
        }, timeoutMs);
        try {
          var value = fn();
          if (!settled) {
            settled = true;
            clearTimer(timer);
            resolve(value);
          }
        } catch (e) {
          if (!settled) {
            settled = true;
            clearTimer(timer);
            reject(toStorageReason(e, key));
          }
        }
      });
    }

    /* ---- 履歴の内部処理（11.2）----------------------------------------- */

    function historyKeyOf(id) {
      return STORAGE_KEYS.HISTORY_ITEM + String(id);
    }

    /** `vsc:hist:index` を `[{id, endedAt}]` として読む（壊れていれば空配列）。 */
    function readHistoryIndex() {
      var raw = rawGet(STORAGE_KEYS.HISTORY_INDEX);
      if (typeof raw !== 'string' || raw.length === 0) { return []; }
      var parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        return [];
      }
      if (!isArrayValue(parsed)) { return []; }
      var out = [];
      for (var i = 0; i < parsed.length; i++) {
        var entry = parsed[i];
        if (!isPlainObject(entry) || typeof entry.id !== 'string' || entry.id.length === 0) {
          continue;
        }
        out.push({ id: entry.id, endedAt: entry.endedAt });
      }
      return out;
    }

    function writeHistoryIndex(index) {
      var out = [];
      for (var i = 0; i < index.length; i++) {
        out.push({ id: index[i].id, endedAt: index[i].endedAt });
      }
      writeVerified(STORAGE_KEYS.HISTORY_INDEX, JSON.stringify(out));
    }

    /** 最古の 1 件（`endedAt` 最小 → id 最小）。`sortHistoryIndex` の末尾要素。 */
    function oldestEntry(index) {
      if (index.length === 0) { return null; }
      var sorted = sortHistoryIndex(index);
      return sorted[sorted.length - 1];
    }

    function removeFromIndex(index, id) {
      var out = [];
      for (var i = 0; i < index.length; i++) {
        if (index[i].id !== id) { out.push(index[i]); }
      }
      return out;
    }

    function tryRemoveQuiet(key) {
      try {
        rawRemove(key);
      } catch (e) {
        /* 退避処理中の削除失敗は無視する（本来の拒否理由を隠さない） */
      }
    }

    /**
     * 履歴 1 件の追加（要件 14-1, 14-5, 14-6, 12-6, 12-9）。
     *
     * 1. 100 件を超える場合は最古 1 件を削除してから保存する（要件 14-6）
     * 2. 容量超過で失敗したら最古 1 件を削除して再試行する。成功するか履歴が
     *    0 件になるまで最大 100 回繰り返す（要件 12-6）
     * 3. それでも失敗する場合は、書きかけのレコード鍵を削除し、生存レコードに
     *    整合するインデックスへ戻して `QUOTA_EXCEEDED` で拒否する（要件 12-9。
     *    退避が 1 件も起きていない＝履歴 0 件から始めた場合、これは
     *    「保存試行前の内容の維持」と一致する）
     */
    function appendHistorySync(record) {
      if (!isPlainObject(record) || typeof record.id !== 'string' || record.id.length === 0) {
        throw storageReason('INVALID', STORAGE_KEYS.HISTORY_INDEX,
          '履歴レコードの形式が異なる。');
      }

      var index = readHistoryIndex();
      index = removeFromIndex(index, record.id);

      // 要件 14-6: 上限件数を超える分を先に落とす
      while (index.length >= LIMITS.HISTORY_MAX) {
        var over = oldestEntry(index);
        if (over === null) { break; }
        tryRemoveQuiet(historyKeyOf(over.id));
        index = removeFromIndex(index, over.id);
      }

      var payload = JSON.stringify(record);
      var attempts = 0;
      var evicted = 0;
      var lastError = null;

      while (attempts <= LIMITS.HISTORY_MAX) {
        attempts++;
        try {
          writeVerified(historyKeyOf(record.id), payload);
          var nextIndex = index.slice();
          nextIndex.push({ id: record.id, endedAt: record.endedAt });
          writeHistoryIndex(nextIndex);
          return { record: record, evicted: evicted };
        } catch (e) {
          lastError = toStorageReason(e, historyKeyOf(record.id));
          if (lastError.code !== 'QUOTA_EXCEEDED') { throw lastError; }
          var victim = oldestEntry(index);
          if (victim === null) { break; }
          tryRemoveQuiet(historyKeyOf(victim.id));
          index = removeFromIndex(index, victim.id);
          evicted++;
        }
      }

      // 保存できなかった: 書きかけを消し、生存レコードに整合する状態へ戻す
      tryRemoveQuiet(historyKeyOf(record.id));
      try {
        writeHistoryIndex(index);
      } catch (e) {
        /* インデックスの復旧に失敗しても、拒否理由は容量超過のままとする */
      }
      throw storageReason('QUOTA_EXCEEDED', historyKeyOf(record.id),
        '保存領域の空きが足りないため練習履歴を保存できなかった。');
    }

    /* ---- メニューの内部処理（11.3）------------------------------------- */

    function readMenusSync() {
      var raw = rawGet(STORAGE_KEYS.MENUS);
      if (typeof raw !== 'string' || raw.length === 0) {
        return { menus: null, issues: [] };
      }
      var restored = deserializeMenus(raw);
      return { menus: restored.menus, issues: restored.issues };
    }

    /* ---- 公開関数（13 個。すべて Promise を返す）------------------------ */

    return {
      /** 保存領域が使えるかを検証する（`vsc:probe` は検証後に必ず削除する）。 */
      probe: function () {
        return guarded(STORAGE_KEYS.PROBE, probe);
      },

      /* --- 進行中セッション --- */

      saveSession: function (sessionState) {
        return guarded(STORAGE_KEYS.SESSION, function () {
          writeVerified(STORAGE_KEYS.SESSION, serializeSession(sessionState));
        });
      },

      /**
       * 進行中セッションの読込。保存データが無ければ `null`。
       * 選択中メニューを正として整合させた `{state, issues}` を返す。
       */
      loadSession: function (menu) {
        return guarded(STORAGE_KEYS.SESSION, function () {
          var raw = rawGet(STORAGE_KEYS.SESSION);
          if (typeof raw !== 'string' || raw.length === 0) { return null; }
          return deserializeSession(raw, menu);
        });
      },

      deleteSession: function () {
        return guarded(STORAGE_KEYS.SESSION, function () {
          rawRemove(STORAGE_KEYS.SESSION);
        });
      },

      /* --- 設定 --- */

      saveSettings: function (settings) {
        return guarded(STORAGE_KEYS.SETTINGS, function () {
          var src = isPlainObject(settings) ? settings : {};
          var powerSave = (src.powerSave === true || src.powerSave === false)
            ? src.powerSave
            : null;
          writeVerified(STORAGE_KEYS.SETTINGS, JSON.stringify({
            schemaVersion: SCHEMA_VERSION,
            powerSave: powerSave
          }));
        });
      },

      loadSettings: function () {
        return guarded(STORAGE_KEYS.SETTINGS, function () {
          var raw = rawGet(STORAGE_KEYS.SETTINGS);
          if (typeof raw !== 'string' || raw.length === 0) {
            return { schemaVersion: DEFAULT_SETTINGS.schemaVersion, powerSave: null };
          }
          var parsed;
          try {
            parsed = JSON.parse(raw);
          } catch (e) {
            return { schemaVersion: DEFAULT_SETTINGS.schemaVersion, powerSave: null };
          }
          var version = isPlainObject(parsed) ? toIntegerOrNull(parsed.schemaVersion) : null;
          if (version === null || version > SCHEMA_VERSION) {
            return { schemaVersion: DEFAULT_SETTINGS.schemaVersion, powerSave: null };
          }
          var powerSave = (parsed.powerSave === true || parsed.powerSave === false)
            ? parsed.powerSave
            : null;
          return { schemaVersion: SCHEMA_VERSION, powerSave: powerSave };
        });
      },

      /* --- 選択中メニュー識別子 --- */

      saveActiveMenuId: function (id) {
        return guarded(STORAGE_KEYS.ACTIVE_MENU_ID, function () {
          if (typeof id !== 'string' || id.length === 0) {
            throw storageReason('INVALID', STORAGE_KEYS.ACTIVE_MENU_ID,
              '選択中メニュー識別子が空である。');
          }
          writeVerified(STORAGE_KEYS.ACTIVE_MENU_ID, JSON.stringify(id));
        });
      },

      loadActiveMenuId: function () {
        return guarded(STORAGE_KEYS.ACTIVE_MENU_ID, function () {
          var raw = rawGet(STORAGE_KEYS.ACTIVE_MENU_ID);
          if (typeof raw !== 'string' || raw.length === 0) { return null; }
          var parsed;
          try {
            parsed = JSON.parse(raw);
          } catch (e) {
            return null;
          }
          return (typeof parsed === 'string' && parsed.length > 0) ? parsed : null;
        });
      },

      /* --- 履歴 --- */

      appendHistory: function (record) {
        return guarded(historyKeyOf(isPlainObject(record) ? record.id : ''), function () {
          return appendHistorySync(record);
        });
      },

      /** 終了日時降順 → id 降順（要件 14-2）。読めないレコードは黙って除く。 */
      listHistory: function () {
        return guarded(STORAGE_KEYS.HISTORY_INDEX, function () {
          var index = sortHistoryIndex(readHistoryIndex());
          var out = [];
          for (var i = 0; i < index.length; i++) {
            var raw = rawGet(historyKeyOf(index[i].id));
            if (typeof raw !== 'string' || raw.length === 0) { continue; }
            var parsed;
            try {
              parsed = JSON.parse(raw);
            } catch (e) {
              continue;
            }
            if (isPlainObject(parsed)) { out.push(parsed); }
          }
          return out;
        });
      },

      /** 対象 1 件のみを削除する（要件 14-7）。 */
      deleteHistory: function (id) {
        return guarded(historyKeyOf(id), function () {
          if (typeof id !== 'string' || id.length === 0) {
            throw storageReason('INVALID', STORAGE_KEYS.HISTORY_INDEX, '履歴識別子が空である。');
          }
          var index = readHistoryIndex();
          var exists = false;
          for (var i = 0; i < index.length; i++) {
            if (index[i].id === id) { exists = true; break; }
          }
          if (!exists) {
            throw storageReason('NOT_FOUND', historyKeyOf(id), '対象の履歴が見つからない。');
          }
          rawRemove(historyKeyOf(id));
          writeHistoryIndex(removeFromIndex(index, id));
        });
      },

      /* --- メニュー --- */

      /** `{menus, issues}` を返す。保存データが無い場合は `menus: null`。 */
      listMenus: function () {
        return guarded(STORAGE_KEYS.MENUS, readMenusSync);
      },

      /** 作成・更新の upsert（要件 17-17, 18-1）。 */
      saveMenu: function (menuRecord) {
        return guarded(STORAGE_KEYS.MENUS, function () {
          if (!isPlainObject(menuRecord) || typeof menuRecord.id !== 'string') {
            throw storageReason('INVALID', STORAGE_KEYS.MENUS, 'メニューの形式が異なる。');
          }
          var current = readMenusSync();
          var menus = (current.menus === null) ? [] : current.menus;
          var replaced = false;
          for (var i = 0; i < menus.length; i++) {
            if (menus[i].id === menuRecord.id) {
              menus[i] = menuRecord;
              replaced = true;
              break;
            }
          }
          if (!replaced) { menus.push(menuRecord); }
          writeVerified(STORAGE_KEYS.MENUS, serializeMenus(menus));
          return menuRecord;
        });
      },

      /** メニュー集合をまとめて保存する（Menu_Manager の persist 経路）。 */
      saveMenus: function (menus) {
        return guarded(STORAGE_KEYS.MENUS, function () {
          writeVerified(STORAGE_KEYS.MENUS, serializeMenus(menus));
        });
      },

      deleteMenu: function (id) {
        return guarded(STORAGE_KEYS.MENUS, function () {
          var current = readMenusSync();
          var menus = (current.menus === null) ? [] : current.menus;
          var next = [];
          var found = false;
          for (var i = 0; i < menus.length; i++) {
            if (menus[i].id === id) { found = true; continue; }
            next.push(menus[i]);
          }
          if (!found) {
            throw storageReason('NOT_FOUND', STORAGE_KEYS.MENUS, '対象のメニューが見つからない。');
          }
          writeVerified(STORAGE_KEYS.MENUS, serializeMenus(next));
        });
      }
    };
  }

  /* ---- 3-1b. Persistence_Coordinator … タスク 11.4 ------------------------
   * createPersistenceCoordinator({ storage, getSessionState, showMessage,
   *                               onConflict, now, setTimer, clearTimer })
   *   scheduleSave / flush / cancel / isConflicted / watchOtherTabs /
   *   restoreSession
   *
   * 責務:
   *   - Make / Attempt / アクティブ種目の変化を 300ms デバウンスで 1 回の保存に
   *     まとめ、最初の変化から 1000ms 以内に完了させる（要件 12-4）。
   *     デバウンス待ちが 1000ms の締切を越える場合は締切で打ち切って保存する。
   *   - 失敗時は `reasonKey`（= 拒否値の code）で同一原因のメッセージを 1 回だけ
   *     出し、メモリ内状態で操作を継続させる（要件 12-7）。
   *   - `storage` イベントで `vsc:session` の他タブ由来の変化を検知したら
   *     競合フラグを立て、上書き保存を停止して再読込を促す（要件 12-11）。
   * ---------------------------------------------------------------------- */

  var SAVE_DEBOUNCE_MS = 300;
  var SAVE_DEADLINE_MS = 1000;

  function createPersistenceCoordinator(deps) {
    var d = isPlainObject(deps) ? deps : {};
    var storage = d.storage;
    var getSessionState = (typeof d.getSessionState === 'function') ? d.getSessionState : null;
    var showMessage = (typeof d.showMessage === 'function') ? d.showMessage : function () {};
    var onConflict = (typeof d.onConflict === 'function') ? d.onConflict : function () {};
    var now = (typeof d.now === 'function') ? d.now : function () { return Date.now(); };
    var setTimer = (typeof d.setTimer === 'function') ? d.setTimer : function (fn, ms) {
      return setTimeout(fn, ms);
    };
    var clearTimer = (typeof d.clearTimer === 'function') ? d.clearTimer : function (handle) {
      clearTimeout(handle);
    };

    var timer = null;
    var deadline = null;
    var conflicted = false;
    var reportedReasons = Object.create(null);

    function reportFailure(reason) {
      var key = (isPlainObject(reason) && typeof reason.code === 'string')
        ? reason.code
        : 'UNAVAILABLE';
      if (reportedReasons[key] === true) { return; }
      reportedReasons[key] = true;
      var text = (isPlainObject(reason) && typeof reason.message === 'string')
        ? reason.message
        : '保存できなかった。';
      // 要件 12-7: 保存できないことを示すが、操作はメモリ内状態で継続する
      showMessage('error', text + '記録は画面上で続けられる。', 0, key);
    }

    function clearPending() {
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
      deadline = null;
    }

    function flush() {
      clearPending();
      if (conflicted || storage === undefined || storage === null || getSessionState === null) {
        return Promise.resolve(false);
      }
      var state = getSessionState();
      if (state === null || state === undefined) { return Promise.resolve(false); }
      return storage.saveSession(state).then(function () {
        return true;
      }, function (reason) {
        reportFailure(reason);
        return false;
      });
    }

    return {
      /** 状態変化を 1 回の保存にまとめてスケジュールする（要件 12-4）。 */
      scheduleSave: function () {
        if (conflicted) { return; }
        var at = now();
        if (deadline === null) { deadline = at + SAVE_DEADLINE_MS; }
        var wait = SAVE_DEBOUNCE_MS;
        if (at + wait > deadline) { wait = (deadline > at) ? (deadline - at) : 0; }
        if (timer !== null) { clearTimer(timer); }
        timer = setTimer(flush, wait);
      },

      /** 待機中の保存を即時実行する（画面遷移・セッション終了時に使う）。 */
      flush: flush,

      /**
       * 起動時の復元（要件 12-5, 5-7, 6-10, 6-11）。
       * 保存データが無ければ `{resumed:false}`。あれば counts / cursor / timer に
       * 復元値を流し込み、`resumed:true` と `issues` を返す。呼び出し側（タスク
       * 21.1）は `resumed` を見て「前回の練習を再開した」表示を提示する。
       *
       * @param {{menu: object, counts: object, cursor: object, timer: object}} targets
       * @returns {Promise<{resumed: boolean, state: (object|null), issues: Array}>}
       */
      restoreSession: function (targets) {
        var t = isPlainObject(targets) ? targets : {};
        var menu = t.menu || null;
        if (storage === undefined || storage === null) {
          return Promise.resolve({ resumed: false, state: null, issues: [] });
        }
        return storage.loadSession(menu).then(function (loaded) {
          if (loaded === null || !isPlainObject(loaded)) {
            return { resumed: false, state: null, issues: [] };
          }
          var state = loaded.state;
          var issues = isArrayValue(loaded.issues) ? loaded.issues.slice() : [];

          if (t.counts && typeof t.counts.restore === 'function') {
            t.counts.restore(state.counts, state.operations);
          }
          if (t.cursor && typeof t.cursor.restore === 'function') {
            var restored = t.cursor.restore(state.activeIndex, state.counts.length);
            if (!restored.ok) {
              issues.push(makeIssue('ACTIVE_INDEX_RANGE', 'activeIndex',
                'アクティブ種目を復元できなかったため先頭種目を選んだ。'));
            }
          }
          if (t.timer && typeof t.timer.restore === 'function') {
            t.timer.restore({
              startedAt: state.startedAt,
              elapsedSec: state.elapsedSec,
              frozen: state.ended === true
            }, now());
          }
          return { resumed: true, state: state, issues: issues };
        }, function (reason) {
          reportFailure(reason);
          return { resumed: false, state: null, issues: [reason] };
        });
      },

      cancel: clearPending,

      isConflicted: function () {
        return conflicted;
      },

      /** テストと再読込後の復帰のために競合状態を解除する。 */
      resetConflict: function () {
        conflicted = false;
      },

      /** 同一原因のメッセージ抑止を解除する（保存が回復したときに呼ぶ）。 */
      resetFailureNotices: function () {
        reportedReasons = Object.create(null);
      },

      /**
       * 他タブによる `vsc:session` の変化を監視する（要件 12-11）。
       * 検知したら上書き保存を停止し、再読込を促すメッセージを出す。
       */
      handleStorageEvent: function (event) {
        if (!event || event.key !== STORAGE_KEYS.SESSION) { return false; }
        if (conflicted) { return true; }
        conflicted = true;
        clearPending();
        showMessage('error',
          '他のタブで練習が進行している。このタブでの記録を停止した。再読込すると続けられる。',
          0, 'CONFLICT');
        onConflict();
        return true;
      },

      watchOtherTabs: function (target) {
        var host = target || ((typeof window !== 'undefined') ? window : null);
        if (host === null || typeof host.addEventListener !== 'function') { return false; }
        var self = this;
        host.addEventListener('storage', function (event) {
          self.handleStorageEvent(event);
        });
        return true;
      }
    };
  }


  /* ---- 3-2. Count_Manager … タスク 10.1 ------------------------------------
   * createCountManager()
   *   initFromMenu / getCounts / apply / undo / resetAll /
   *   purgeDrill / addDrill / reconcile / getHistory / restore
   *   内部遷移は 2-2 の純粋関数に委譲する。
   *
   * === 内部表現と射影 ===============================================
   * 内部は 2-2 / 2-4 と同じ正規形 `[{id, make, attempt}]`（配列順 = メニュー順）
   * で保持し、`getCounts()` は設計の `{ [drillId]: {make, attempt} }` 形の
   * **射影**を都度作って返す（レンダラが id で引けるようにするため）。
   * 直列化には配列形が必要なため `getCountsList()` を別に公開する。
   * どちらも複製を返すので、呼び出し側が内部状態を書き換えることはできない。
   *
   * === 種目 id の高水位 =============================================
   * `addDrill` の採番は「そのセッションで一度でも使った id」を避ける必要がある
   * （最大 id の種目を削除した直後の追加で削除済み id を再利用すると、
   *   別種目のカウントが復活したように見える）。この高水位は counts / history
   * から失われるため Count_Manager が `reservedMaxId` として保持し、
   * `getReservedIdHigh()` で払い出し側（Menu_Manager / タスク 18.2）に渡す。
   * `initFromMenu`（= 新規セッション）でメニューの最大 id に再初期化し、
   * `resetAll` / `purgeDrill` では下げない。
   * ------------------------------------------------------------------------ */

  /** 整数 id の列（counts / history / drills のいずれの要素でも可）の最大値。 */
  function maxIdIn(list) {
    return maxReservedId(list);
  }

  function createCountManager() {
    var counts = [];
    var history = [];
    var reservedMaxId = 0;

    function raiseReserved(value) {
      if (value > reservedMaxId) { reservedMaxId = value; }
    }

    function initFrom(menu) {
      var drills = menuDrillsOf(menu);
      var next = [];
      for (var i = 0; i < drills.length; i++) {
        var drill = drills[i];
        next.push({
          id: (drill !== null && typeof drill === 'object') ? toIntegerOrNull(drill.id) : null,
          make: LIMITS.COUNT_MIN,
          attempt: LIMITS.COUNT_MIN
        });
      }
      counts = next;
      history = [];
      return maxIdIn(drills);
    }

    return {
      /** 新規セッションの初期化（要件 1-7, 1-8, 5-8）。高水位も作り直す。 */
      initFromMenu: function (menu) {
        reservedMaxId = initFrom(menu);
      },

      /** 全カウント初期化（要件 7-10）。高水位は下げない。 */
      resetAll: function (menu) {
        raiseReserved(initFrom(menu));
      },

      /** 設計の `{ [drillId]: {make, attempt} }` 形の射影（複製）。 */
      getCounts: function () {
        var out = {};
        for (var i = 0; i < counts.length; i++) {
          if (counts[i].id === null) { continue; }
          out[counts[i].id] = { make: counts[i].make, attempt: counts[i].attempt };
        }
        return out;
      },

      /** 正規形の配列（複製）。直列化と集約算出はこちらを使う。 */
      getCountsList: function () {
        var out = [];
        for (var i = 0; i < counts.length; i++) {
          out.push({ id: counts[i].id, make: counts[i].make, attempt: counts[i].attempt });
        }
        return out;
      },

      getHistory: function () {
        var out = [];
        for (var i = 0; i < history.length; i++) {
          out.push({ drillId: history[i].drillId, type: history[i].type });
        }
        return out;
      },

      /** 全体成功数・全体試投数（要件 4-7, 4-8）。 */
      getTotals: function () {
        return totals(counts);
      },

      getReservedIdHigh: function () {
        return reservedMaxId;
      },

      /** 計数操作（要件 4-1, 4-2, 4-13, 5-1, 5-2, 5-6）。 */
      apply: function (type, drillId) {
        var result = applyCount(counts, history, type, drillId);
        if (!result.ok) {
          return { ok: false, reason: result.reason, entry: null, evicted: null };
        }
        counts = result.counts;
        history = result.history;
        return { ok: true, reason: null, entry: result.entry, evicted: result.evicted };
      },

      /** 直前 1 件の取り消し（要件 5-3, 5-4, 5-5）。Redo は提供しない（要件 5-9）。 */
      undo: function () {
        var result = undoCount(counts, history);
        if (!result.ok) {
          return { ok: false, reason: result.reason, entry: null };
        }
        counts = result.counts;
        history = result.history;
        return { ok: true, reason: null, entry: result.entry };
      },

      /** 種目削除に伴う破棄（要件 17-12）。高水位は下げない。 */
      purgeDrill: function (drillId) {
        var result = purgeDrillCounts(counts, history, drillId);
        counts = result.counts;
        history = result.history;
        return { removed: result.removed, removedOperations: result.removedOperations };
      },

      /** 種目追加に伴う 0 / 0 の追加（要件 17-13）。 */
      addDrill: function (drillId) {
        var result = addDrillCounts(counts, drillId);
        counts = result.counts;
        var id = toIntegerOrNull(drillId);
        if (id !== null) { raiseReserved(id); }
        return { added: result.added };
      },

      /** 種目並べ替えに伴う配列順の追従（要件 17-3）。 */
      reorder: function (orderedIds) {
        counts = reorderCounts(counts, orderedIds);
      },

      /**
       * 選択中メニューの種目 id 集合を正として整合させる（要件 1-10）。
       * 直列化側の `reconcileWithMenu` に委譲し、破棄 / 補完した id を返す。
       */
      reconcile: function (menu) {
        var drills = menuDrillsOf(menu);
        var before = counts;
        var result = reconcileWithMenu(counts, history, drills);

        var kept = Object.create(null);
        var i;
        for (i = 0; i < result.counts.length; i++) {
          if (result.counts[i].id !== null) { kept[result.counts[i].id] = true; }
        }
        var dropped = [];
        for (i = 0; i < before.length; i++) {
          if (before[i].id !== null && kept[before[i].id] !== true) { dropped.push(before[i].id); }
        }
        var had = Object.create(null);
        for (i = 0; i < before.length; i++) {
          if (before[i].id !== null) { had[before[i].id] = true; }
        }
        var filled = [];
        for (i = 0; i < result.counts.length; i++) {
          var id = result.counts[i].id;
          if (id !== null && had[id] !== true) { filled.push(id); }
        }

        counts = result.counts;
        history = result.operations;
        raiseReserved(maxIdIn(drills));
        return { dropped: dropped, filled: filled, issues: result.issues };
      },

      /** 保存済みセッションからの復元（要件 5-7, 6-10）。 */
      restore: function (countsIn, historyIn) {
        counts = normalizeCounts(countsIn);
        history = normalizeOperationHistory(historyIn);
        raiseReserved(maxIdIn(counts));
        raiseReserved(maxIdIn(history));
      }
    };
  }

  /* ---- 3-3. Cursor_Manager … タスク 10.2 -----------------------------------
   * createCursorManager()
   *   setMenu / getIndex / getActiveDrill / next / prev / selectIndex /
   *   restore / reindexAfterMenuChange
   *   内部遷移は 2-3 の cursorReducer に委譲する。循環しない。
   *
   * カウントを一切参照しないため、カーソル操作が Make / Attempt を変えることは
   * 原理的にない（要件 6-1, 6-3, 6-4, 6-8）。Make の targetMake 到達も
   * この層には伝わらないため、到達によってアクティブ種目が動くこともない
   * （要件 6-9）。
   * ------------------------------------------------------------------------ */

  function createCursorManager() {
    var drills = [];
    var index = 0;

    function length() {
      return drills.length;
    }

    function clampIndex(value) {
      var n = length();
      if (n < 1) { return 0; }
      var i = toIntegerOrNull(value);
      if (i === null || i < 0) { return 0; }
      if (i > n - 1) { return n - 1; }
      return i;
    }

    return {
      /**
       * 選択中メニューを差し替える（新規セッション / メニュー切替）。
       * アクティブ種目は先頭種目（要件 6-2, 18-10, 18-11）。
       */
      setMenu: function (menu) {
        drills = menuDrillsOf(menu);
        index = 0;
      },

      /** 種目定義だけを更新し、アクティブ種目は呼び出し側の決定に委ねる。 */
      updateDrills: function (menu, nextIndex) {
        drills = menuDrillsOf(menu);
        index = clampIndex(nextIndex);
      },

      getIndex: function () {
        return index;
      },

      getLength: function () {
        return length();
      },

      getActiveDrill: function () {
        var drill = drills[index];
        return (drill === undefined) ? null : drill;
      },

      /** 次種目（要件 6-3, 6-5）。循環しない。 */
      next: function () {
        var result = cursorReducer(index, length(), 'NEXT');
        index = result.index;
        return { ok: result.ok, reason: result.reason };
      },

      /** 前種目（要件 6-4, 6-6）。循環しない。 */
      prev: function () {
        var result = cursorReducer(index, length(), 'PREV');
        index = result.index;
        return { ok: result.ok, reason: result.reason };
      },

      /** 種目一覧のタップ（要件 6-8）。範囲外は不変。 */
      selectIndex: function (i) {
        var result = cursorReducer(index, length(), { type: 'SELECT', index: i });
        index = result.index;
        return { ok: result.ok, reason: result.reason };
      },

      /**
       * 保存済みセッションからの復元（要件 6-10, 6-11）。
       * 範囲外なら先頭種目にして `OUT_OF_RANGE` を返す（カウントは触らない）。
       */
      restore: function (savedIndex, n) {
        if (typeof n === 'number' && length() === 0) {
          // 種目定義が未設定のまま復元された場合に備えて長さだけを反映する
          var placeholder = [];
          for (var i = 0; i < normalizeCursorLength(n); i++) { placeholder.push(null); }
          drills = placeholder;
        }
        var result = cursorReducer(index, length(), { type: 'SELECT', index: savedIndex });
        index = result.index;
        if (!result.ok) {
          index = 0;
          return { ok: false, reason: 'OUT_OF_RANGE' };
        }
        return { ok: true, reason: null };
      },

      /** 種目数の変化後のアクティブ種目の再決定（要件 17-14）。 */
      reindexAfterMenuChange: function (prevIndex, prevLength, newLength, removedIndex) {
        index = reindexAfterMenuChange(prevIndex, prevLength, newLength, removedIndex);
        return index;
      }
    };
  }

  /* ---- 3-4. Menu_Manager … タスク 10.3（コア）/ 18.1〜18.3（UI）-----------
   * createMenuManager({ persist })
   *   init / listMenus / getActiveMenu / getActiveMenuId / createMenu /
   *   duplicateMenu / renameMenu / deleteMenu / switchMenu /
   *   addDrill / updateDrill / removeDrill / reorderDrills /
   *   resetActiveMenuToDefault
   *   戻り値は {ok:true, menu} | {ok:false, violations}
   *
   * === 責務境界 =====================================================
   * 本タスク（10.3）はメモリ内コアのみを実装する。`localStorage` には触れず、
   * 変更が確定した直後に `persist(menus, activeMenuId)` を 1 回呼ぶ
   * （既定は no-op）。Storage_Adapter の配線はタスク 11.3 / 18.x が
   * この `persist` を差し替える形で行うため、本コアは同期関数のままでよい。
   *
   * 検証はすべて 2-5 の `validateMenu` に委譲する。違反がある編集は
   * **一切反映しない**（要件 17-7, 18-4）。メニュー数は常に 1 個以上
   * （要件 18-6）で、最後のメニューの削除は `MENU_COUNT_RANGE` で拒否する
   * （要件 18-7）。
   *
   * 種目集合の構造操作は 2-3 の純粋関数（reorderDrills / removeDrill /
   * addDrill）に委譲する。カウント側の追従（purgeDrill / addDrill / reorder）と
   * アクティブ種目の再決定は**呼び出し側（ディスパッチャ / タスク 18.2）**が
   * 行う（設計「状態層のマネージャは互いを直接呼ばない」）。
   * ------------------------------------------------------------------------ */

  function createMenuManager(deps) {
    var options = isPlainObject(deps) ? deps : {};
    var persist = (typeof options.persist === 'function') ? options.persist : null;
    var now = (typeof options.now === 'function') ? options.now : function () { return Date.now(); };
    var random = (typeof options.random === 'function') ? options.random : Math.random;

    var menus = [createDefaultMenu()];
    var activeMenuId = menus[0].id;

    /** `m-{base36 時刻}-{4 文字乱数}`（設計 Data Models）。 */
    function newMenuId() {
      var stamp = Math.floor(now()).toString(36);
      var suffix = '';
      var alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
      for (var i = 0; i < 4; i++) {
        suffix += alphabet.charAt(Math.floor(random() * alphabet.length) % alphabet.length);
      }
      return 'm-' + stamp + '-' + suffix;
    }

    function indexOfMenu(id) {
      for (var i = 0; i < menus.length; i++) {
        if (menus[i].id === id) { return i; }
      }
      return -1;
    }

    function activeIndex() {
      var at = indexOfMenu(activeMenuId);
      return (at === -1) ? 0 : at;
    }

    function cloneMenu(menu) {
      return cloneMenuWithDrills(menu, cloneMenuDrills(menuDrillsOf(menu)));
    }

    function namesExcept(id) {
      var out = [];
      for (var i = 0; i < menus.length; i++) {
        if (menus[i].id !== id) { out.push(menus[i].name); }
      }
      return out;
    }

    function ok(menu) {
      if (persist) { persist(listMenusCopy(), activeMenuId); }
      return { ok: true, menu: cloneMenu(menu), violations: [] };
    }

    function reject(violations) {
      return { ok: false, menu: cloneMenu(menus[activeIndex()]), violations: violations };
    }

    function rejectCode(code, field, message) {
      return reject([makeIssue(code, field, message)]);
    }

    function listMenusCopy() {
      var out = [];
      for (var i = 0; i < menus.length; i++) { out.push(cloneMenu(menus[i])); }
      return out;
    }

    /** 候補メニューを検証し、通れば `menus[at]` を置き換える。 */
    function commit(at, candidate, context) {
      var result = validateMenu(candidate, context);
      if (!result.ok) { return reject(result.violations); }
      menus[at] = candidate;
      return ok(candidate);
    }

    return {
      /**
       * 復元済みのメニュー集合と選択中メニュー識別子を取り込む（要件 18-13, 18-14）。
       * 不正な集合は既定メニュー 1 件へ畳む。識別子が一致しない場合は
       * 既定メニュー、無ければ先頭メニューを選び `issues` に記録する。
       */
      init: function (restoredMenus, restoredActiveId) {
        var accepted = [];
        var names = [];
        var issues = [];
        var source = isArrayValue(restoredMenus) ? restoredMenus : [];
        for (var i = 0; i < source.length && accepted.length < LIMITS.MENU_COUNT_MAX; i++) {
          var candidate = coerceMenuRecord(source[i]);
          if (candidate === null) { continue; }
          if (!validateMenu(candidate, { otherNames: names }).ok) { continue; }
          accepted.push(candidate);
          names.push(candidate.name);
        }
        if (accepted.length === 0) {
          accepted = [createDefaultMenu()];
          /*
           * 保存データが**存在しなかった**場合は初回起動であり、既定メニューを
           * 生成するのは正常な動作（要件 18-5）なので `issues` に積まない。
           * 保存データはあったのに全件が検証違反で除外された場合だけ、
           * 「復元できなかった」ことを伝える（要件 13-14）。
           */
          if (source.length > 0) {
            issues.push(makeIssue('MENU_SET_EMPTY', 'menus',
              'メニュー定義を復元できなかったため既定メニューを使用する。'));
          }
        }
        menus = accepted;

        var at = -1;
        if (typeof restoredActiveId === 'string') {
          for (var k = 0; k < menus.length; k++) {
            if (menus[k].id === restoredActiveId) { at = k; break; }
          }
        }
        if (at === -1) {
          var defaultAt = -1;
          for (var d = 0; d < menus.length; d++) {
            if (menus[d].id === DEFAULT_MENU_ID) { defaultAt = d; break; }
          }
          at = (defaultAt !== -1) ? defaultAt : 0;
          if (typeof restoredActiveId === 'string' && restoredActiveId.length > 0) {
            issues.push(makeIssue('ACTIVE_MENU_NOT_FOUND', 'activeMenuId',
              '前回使用したメニューを復元できなかった。'));
          }
        }
        activeMenuId = menus[at].id;
        return { menus: listMenusCopy(), activeMenu: cloneMenu(menus[at]), issues: issues };
      },

      listMenus: listMenusCopy,

      getActiveMenu: function () {
        return cloneMenu(menus[activeIndex()]);
      },

      getActiveMenuId: function () {
        return activeMenuId;
      },

      /** 新規作成（要件 18-2, 18-3, 18-4）。既定メニューの内容を初期値にする。 */
      createMenu: function (name) {
        if (menus.length >= LIMITS.MENU_COUNT_MAX) {
          return rejectCode('MENU_COUNT_RANGE', 'menus',
            'メニュー数は ' + LIMITS.MENU_COUNT_MAX + ' 個以下にする。');
        }
        var candidate = {
          id: newMenuId(),
          name: name,
          drills: cloneDrills(DRILL_MENU)
        };
        var result = validateMenu(candidate, {
          menuCount: menus.length + 1,
          otherNames: namesExcept(null)
        });
        if (!result.ok) { return reject(result.violations); }
        menus.push(candidate);
        return ok(candidate);
      },

      /** 複製（要件 18-2, 18-3, 18-4）。種目 id は複製元のまま保つ。 */
      duplicateMenu: function (id, name) {
        var at = indexOfMenu(id);
        if (at === -1) {
          return rejectCode('MENU_NOT_FOUND', 'id', '複製元のメニューが見つからない。');
        }
        if (menus.length >= LIMITS.MENU_COUNT_MAX) {
          return rejectCode('MENU_COUNT_RANGE', 'menus',
            'メニュー数は ' + LIMITS.MENU_COUNT_MAX + ' 個以下にする。');
        }
        var candidate = {
          id: newMenuId(),
          name: name,
          drills: cloneMenuDrills(menuDrillsOf(menus[at]))
        };
        var result = validateMenu(candidate, {
          menuCount: menus.length + 1,
          otherNames: namesExcept(null)
        });
        if (!result.ok) { return reject(result.violations); }
        menus.push(candidate);
        return ok(candidate);
      },

      /** 名称変更（要件 18-2, 18-3, 18-4）。 */
      renameMenu: function (id, name) {
        var at = indexOfMenu(id);
        if (at === -1) {
          return rejectCode('MENU_NOT_FOUND', 'id', '対象のメニューが見つからない。');
        }
        var candidate = cloneMenuWithDrills({ id: menus[at].id, name: name },
          cloneMenuDrills(menuDrillsOf(menus[at])));
        return commit(at, candidate, {
          menuCount: menus.length,
          otherNames: namesExcept(id)
        });
      },

      /**
       * 削除（要件 18-2, 18-6, 18-7, 18-8）。
       * 最後の 1 件は削除しない。選択中メニューを削除した場合は残る 1 個を選ぶ。
       */
      deleteMenu: function (id) {
        var at = indexOfMenu(id);
        if (at === -1) {
          return rejectCode('MENU_NOT_FOUND', 'id', '対象のメニューが見つからない。');
        }
        if (menus.length <= LIMITS.MENU_COUNT_MIN) {
          return rejectCode('MENU_COUNT_RANGE', 'menus',
            'メニューは ' + LIMITS.MENU_COUNT_MIN + ' 個以上保持する必要がある。');
        }
        var wasActive = (menus[at].id === activeMenuId);
        menus.splice(at, 1);
        if (wasActive) {
          var nextAt = (at < menus.length) ? at : (menus.length - 1);
          activeMenuId = menus[nextAt].id;
        }
        return ok(menus[activeIndex()]);
      },

      /**
       * 選択中メニューの切り替え（要件 18-2, 18-12）。
       * 進行中セッションの終了・履歴保存・新セッション開始は呼び出し側
       * （タスク 18.3）が確認表示を経て順序を決める。本関数は選択だけを行う。
       */
      switchMenu: function (id) {
        var at = indexOfMenu(id);
        if (at === -1) {
          return rejectCode('MENU_NOT_FOUND', 'id', '切り替え先のメニューが見つからない。');
        }
        activeMenuId = menus[at].id;
        return ok(menus[at]);
      },

      /** 選択中メニューへの種目追加（要件 17-1, 17-13）。 */
      addDrill: function (draft, reservedIds) {
        var at = activeIndex();
        var prevLength = menuDrillsOf(menus[at]).length;
        var built = addDrill(menus[at], draft, reservedIds);
        var result = validateMenu(built.menu, { menuCount: menus.length });
        if (!result.ok) { return reject(result.violations); }
        menus[at] = built.menu;
        if (persist) { persist(listMenusCopy(), activeMenuId); }
        return {
          ok: true,
          menu: cloneMenu(built.menu),
          drill: built.drill,
          index: built.index,
          prevLength: prevLength,
          violations: []
        };
      },

      /** 種目の name / section / targetMake の編集（要件 17-1, 17-4, 17-7〜17-10）。 */
      updateDrill: function (drillId, patch) {
        var at = activeIndex();
        var drills = menuDrillsOf(menus[at]);
        var target = indexOfDrillId(drills, drillId);
        if (target === -1) {
          return rejectCode('UNKNOWN_DRILL', 'drills', '対象の種目が見つからない。');
        }
        var src = isPlainObject(patch) ? patch : {};
        var next = cloneMenuDrills(drills);
        var drill = next[target];
        if (hasField(src, 'name')) { drill.name = src.name; }
        if (hasField(src, 'section')) { drill.section = src.section; }
        if (hasField(src, 'targetMake')) { drill.targetMake = src.targetMake; }
        return commit(at, cloneMenuWithDrills(menus[at], next), { menuCount: menus.length });
      },

      /**
       * 種目の削除（要件 17-11, 17-12）。
       * カウントと操作履歴の破棄は呼び出し側が `Count_Manager.purgeDrill` で行う。
       * 戻り値の `index` は削除前の添字であり、`reindexAfterMenuChange` の
       * `removedIndex` にそのまま渡せる（要件 17-14）。
       */
      removeDrill: function (drillId) {
        var at = activeIndex();
        var built = removeDrill(menus[at], drillId);
        if (!built.ok) {
          return rejectCode(built.reason, 'drills',
            (built.reason === 'LAST_DRILL')
              ? '種目は ' + LIMITS.DRILL_COUNT_MIN + ' 個以上必要である。'
              : '対象の種目が見つからない。');
        }
        var result = validateMenu(built.menu, { menuCount: menus.length });
        if (!result.ok) { return reject(result.violations); }
        var prevLength = menuDrillsOf(menus[at]).length;
        menus[at] = built.menu;
        if (persist) { persist(listMenusCopy(), activeMenuId); }
        return {
          ok: true,
          menu: cloneMenu(built.menu),
          drill: built.drill,
          index: built.index,
          prevLength: prevLength,
          violations: []
        };
      },

      /** 種目の並べ替え（要件 17-1, 17-2, 17-3）。 */
      reorderDrills: function (orderedIds) {
        var at = activeIndex();
        var built = reorderDrills(menus[at], orderedIds);
        if (!built.ok) {
          return rejectCode(built.reason, 'drills', '並べ替えの指定が種目集合と一致しない。');
        }
        return commit(at, built.menu, { menuCount: menus.length });
      },

      /** 選択中メニューのリセット（要件 17-15, 17-16）。種目配列のみを差し替える。 */
      resetActiveMenuToDefault: function () {
        var at = activeIndex();
        var candidate = cloneMenuWithDrills(menus[at], cloneDrills(DRILL_MENU));
        return commit(at, candidate, { menuCount: menus.length });
      }
    };
  }

  /* ---- 3-5. Command_Dispatcher … タスク 10.4 -------------------------------
   * createCommandDispatcher(deps).dispatch(command, source, timestampMs)
   *   command: 'MAKE' | 'MISS' | 'NEXT' | 'PREV' | 'UNDO'
   *   source:  'voice' | 'touch'
   *
   * 設計「コマンドディスパッチャの責務」の 8 段をこの順で実行する。
   *   1. 他タブ競合時は計数系コマンドを受け付けない（要件 12-11）
   *   2. touch の同一ボタン 300ms 連打を破棄（要件 7-7）。
   *      音声側の 800ms 抑止は Speech_Recognizer 内で完了しているため
   *      ここで二重適用しない
   *   3. 計数コマンドで Session_Timer が未開始なら開始（要件 11-2）
   *   4. 対応する状態マネージャを呼ぶ
   *   5. 拒否理由をメッセージ列に積む（要件 4-13, 5-5, 6-5, 6-6）
   *   6. 変更されたビュー領域に dirty フラグを立てる
   *   7. 状態変化時に保存を 300ms デバウンスでスケジュール（要件 12-4）
   *   8. 全体成功数が目標合計に達したら達成時間の確定を要求（要件 11-6）
   *
   * 音声由来とタッチ由来がこの 1 個の入口を共有するため、結果状態と操作履歴が
   * 入力元によらず一致する（要件 7-4）。
   * ------------------------------------------------------------------------ */

  /** 同一ボタンの連打を破棄する間隔（要件 7-7）。 */
  var TOUCH_DEBOUNCE_MS = 300;

  /** ディスパッチャが受け付けるコマンド種別。 */
  var DISPATCH_COMMANDS = deepFreeze(['MAKE', 'MISS', 'NEXT', 'PREV', 'UNDO']);

  /** 拒否理由 → 利用者向けメッセージ（`reasonKey` で重複抑止する）。 */
  var REJECT_MESSAGES = deepFreeze({
    CEILING: { kind: 'warn', text: 'この種目は試投数の上限に達した。', holdMs: 3000 },
    EMPTY_HISTORY: { kind: 'info', text: '取り消せる操作がない。', holdMs: 3000 },
    AT_LAST: { kind: 'info', text: '最後の種目である。', holdMs: 3000 },
    AT_FIRST: { kind: 'info', text: '最初の種目である。', holdMs: 3000 },
    CONFLICT: { kind: 'error', text: '他のタブで練習が進行している。再読込してから操作する。', holdMs: 0 },
    NO_ACTIVE_DRILL: { kind: 'warn', text: 'アクティブ種目が無いため計数できない。', holdMs: 3000 },
    UNKNOWN_COMMAND: { kind: 'warn', text: '解釈できない操作である。', holdMs: 3000 }
  });

  function createCommandDispatcher(deps) {
    var d = isPlainObject(deps) ? deps : {};
    var countManager = d.counts;
    var cursorManager = d.cursor;
    var timer = d.timer || null;
    var getMenu = (typeof d.getMenu === 'function') ? d.getMenu : function () { return null; };
    var showMessage = (typeof d.showMessage === 'function') ? d.showMessage : function () {};
    var markDirty = (typeof d.markDirty === 'function') ? d.markDirty : function () {};
    var scheduleSave = (typeof d.scheduleSave === 'function') ? d.scheduleSave : function () {};
    var onGoalReached = (typeof d.onGoalReached === 'function') ? d.onGoalReached : function () {};
    var isConflicted = (typeof d.isConflicted === 'function')
      ? d.isConflicted
      : function () { return false; };

    // 同一ボタンごとの直前の受付時刻（要件 7-7 は「同一の操作ボタン」が対象）
    var lastTouchAt = {};
    // 目標達成の通知は 1 セッションで 1 回だけ行う（要件 11-6）
    var goalNotified = false;

    function reject(reasonKey) {
      var spec = REJECT_MESSAGES[reasonKey];
      if (spec) { showMessage(spec.kind, spec.text, spec.holdMs, reasonKey); }
      return { ok: false, reason: reasonKey, applied: false };
    }

    function isCountCommand(command) {
      return command === 'MAKE' || command === 'MISS';
    }

    function checkGoal() {
      var menu = getMenu();
      var target = deriveTargetTotal(menu);
      var made = countManager.getTotals().make;
      if (target > 0 && made >= target) {
        if (!goalNotified) {
          goalNotified = true;
          onGoalReached(made, target);
        }
      }
    }

    return {
      /** 目標達成通知の再武装（新規セッション開始時に呼ぶ）。 */
      resetGoalNotice: function () {
        goalNotified = false;
      },

      dispatch: function (command, source, timestampMs) {
        if (DISPATCH_COMMANDS.indexOf(command) === -1) {
          return reject('UNKNOWN_COMMAND');
        }

        // 1. 他タブ競合（要件 12-11）: 計数系（MAKE / MISS / UNDO）を受け付けない
        if (isConflicted() && (isCountCommand(command) || command === 'UNDO')) {
          return reject('CONFLICT');
        }

        // 2. タッチの同一ボタン 300ms 連打を破棄（要件 7-7）
        var at = (typeof timestampMs === 'number' && isFinite(timestampMs))
          ? timestampMs
          : Date.now();
        if (source === 'touch') {
          var prev = lastTouchAt[command];
          if (prev !== undefined && at - prev < TOUCH_DEBOUNCE_MS) {
            return { ok: false, reason: 'DEBOUNCED', applied: false };
          }
          lastTouchAt[command] = at;
        }

        // 3. 計数コマンドでタイマー未開始なら開始（要件 11-2）
        if (isCountCommand(command) && timer && typeof timer.ensureStarted === 'function') {
          timer.ensureStarted(at);
          markDirty('timer');
        }

        // 4. 状態マネージャを呼ぶ
        if (command === 'UNDO') {
          var undone = countManager.undo();
          if (!undone.ok) { return reject(undone.reason); }
          markDirty('active');
          markDirty('progress');
          markDirty('list');
          scheduleSave();
          return { ok: true, reason: null, applied: true, entry: undone.entry };
        }

        if (command === 'NEXT' || command === 'PREV') {
          var moved = (command === 'NEXT') ? cursorManager.next() : cursorManager.prev();
          if (!moved.ok) { return reject(moved.reason); }
          markDirty('active');
          markDirty('list');
          scheduleSave();
          return { ok: true, reason: null, applied: true };
        }

        var drill = cursorManager.getActiveDrill();
        var drillId = (drill !== null && typeof drill === 'object') ? drill.id : null;
        if (toIntegerOrNull(drillId) === null) {
          return reject('NO_ACTIVE_DRILL');
        }

        var applied = countManager.apply(command, drillId);
        if (!applied.ok) { return reject(applied.reason); }

        // 5〜7. 表示更新と保存
        markDirty('active');
        markDirty('progress');
        markDirty('list');
        scheduleSave();

        // 8. 目標合計への到達（要件 11-6）
        checkGoal();

        return {
          ok: true,
          reason: null,
          applied: true,
          entry: applied.entry,
          evicted: applied.evicted
        };
      },

      /** 種目一覧のタップ（要件 6-8）。計数系ではないため競合時も受け付ける。 */
      selectDrillIndex: function (index, source, timestampMs) {
        var at = (typeof timestampMs === 'number' && isFinite(timestampMs))
          ? timestampMs
          : Date.now();
        if (source === 'touch') {
          var key = 'SELECT:' + index;
          var prev = lastTouchAt[key];
          if (prev !== undefined && at - prev < TOUCH_DEBOUNCE_MS) {
            return { ok: false, reason: 'DEBOUNCED', applied: false };
          }
          lastTouchAt[key] = at;
        }
        var result = cursorManager.selectIndex(index);
        if (!result.ok) { return { ok: false, reason: result.reason, applied: false }; }
        markDirty('active');
        markDirty('list');
        scheduleSave();
        return { ok: true, reason: null, applied: true };
      }
    };
  }


  /* ---- 3-6. Speech_Recognizer … タスク 14.1 / 14.2 -------------------------
   * createSpeechRecognizer({ onCommand, onFeedback, onStatus, onFatal })
   *   isSupported / enable / disable / getStatus / handleEnd（テスト用）
   *   コマンド判定は 2-1 の selectCommand に委譲し、再開待機は restartDelay に従う。
   *
   * === 抑止と再開の 2 つのカウンタ ==================================
   * 1. 同一種別 800ms 抑止（要件 3-7）: 種別ごとに「直前に**発行**した時刻」を
   *    保持し、破棄した判定では起点を動かさない。
   * 2. 空結果の連続回数（要件 2-6, 2-11）: 1 回の開始から確定・暫定のいずれも
   *    受信せずに終了した回数。`restartDelay` に渡して 300ms → 倍々 → 5000ms
   *    飽和を決め、5 回連続で自動再開を中止してトグルを無効へ戻す。
   *    結果を 1 件でも受信したら 0 に戻る。
   * ------------------------------------------------------------------------ */

  /** 同一種別のコマンドを続けて発行しない最小間隔（要件 3-7）。 */
  var COMMAND_SUPPRESS_MS = 800;

  function createSpeechRecognizer(deps) {
    var d = isPlainObject(deps) ? deps : {};
    var onCommand = (typeof d.onCommand === 'function') ? d.onCommand : function () {};
    var onFeedback = (typeof d.onFeedback === 'function') ? d.onFeedback : function () {};
    var onStatus = (typeof d.onStatus === 'function') ? d.onStatus : function () {};
    var onFatal = (typeof d.onFatal === 'function') ? d.onFatal : function () {};
    var host = d.window || ((typeof window !== 'undefined') ? window : null);
    var now = (typeof d.now === 'function') ? d.now : function () { return Date.now(); };
    var setTimer = (typeof d.setTimer === 'function') ? d.setTimer : function (fn, ms) {
      return setTimeout(fn, ms);
    };
    var clearTimer = (typeof d.clearTimer === 'function') ? d.clearTimer : function (h) {
      clearTimeout(h);
    };

    /** 実装の取得。`deps.factory` を渡すとそれを使う（テスト用）。 */
    function resolveFactory() {
      if (typeof d.factory === 'function') { return d.factory; }
      if (host === null) { return null; }
      if (typeof host.SpeechRecognition === 'function') { return host.SpeechRecognition; }
      if (typeof host.webkitSpeechRecognition === 'function') { return host.webkitSpeechRecognition; }
      return null;
    }

    var factory = resolveFactory();
    var enabled = false;
    var status = 'stopped';
    var recognition = null;
    var restartHandle = null;
    var emptyStreak = 0;
    var currentDelay = 0;
    var sawResultThisRun = false;
    var lastIssuedAt = Object.create(null);

    function setStatus(next) {
      if (status === next) { return; }
      status = next;
      onStatus(status);
    }

    function clearRestart() {
      if (restartHandle !== null) {
        clearTimer(restartHandle);
        restartHandle = null;
      }
    }

    /** トグルを無効へ戻して停止する（自動再開も行わない）。 */
    function shutdown(reasonKey, message) {
      enabled = false;
      clearRestart();
      if (recognition !== null) {
        try {
          recognition.onend = null;
          recognition.onerror = null;
          recognition.onresult = null;
          recognition.stop();
        } catch (e) {
          /* 停止時の例外は無視する */
        }
        recognition = null;
      }
      setStatus('stopped');
      if (message) { onFatal({ reasonKey: reasonKey, message: message }); }
    }

    function handleResult(event) {
      var results = (event && event.results) ? event.results : null;
      if (results === null) { return; }
      var index = (typeof event.resultIndex === 'number') ? event.resultIndex : 0;
      var finalText = '';
      var interimText = '';
      for (var i = index; i < results.length; i++) {
        var item = results[i];
        if (!item || !item[0]) { continue; }
        var transcript = (typeof item[0].transcript === 'string') ? item[0].transcript : '';
        if (item.isFinal) { finalText += transcript; } else { interimText += transcript; }
      }

      if (finalText.length > 0 || interimText.length > 0) {
        sawResultThisRun = true;
      }

      // 要件 2-9 / 2-10 / 3-11: 暫定結果は表示のみ。コマンド判定は行わない。
      if (interimText.length > 0 && finalText.length === 0) {
        onFeedback({ final: null, interim: interimText });
        return;
      }
      if (finalText.length === 0) { return; }

      onFeedback({ final: finalText, interim: '' });

      var normalized = normalizeText(finalText);
      var selected = selectCommand(normalized, COMMAND_TABLE, EXCLUSION_WORDS);
      // 要件 3-8: どのコマンド語も含まなければ発行せず表示のみ
      if (selected === null) { return; }

      var at = now();
      var previous = lastIssuedAt[selected.type];
      // 要件 3-7: 同一種別 800ms 未満は破棄し、起点は直前の発行時刻から動かさない
      if (previous !== undefined && at - previous < COMMAND_SUPPRESS_MS) { return; }
      lastIssuedAt[selected.type] = at;
      onCommand(selected.type, at, selected);
    }

    function handleEnd() {
      if (!enabled) {
        setStatus('stopped');
        return;
      }
      recognition = null;

      /*
       * 要件 2-6 / 2-11: 待機時間と中止判定は 2-1 の restartDelay が決める。
       * `consecutiveEmpty` は restartDelay が更新した値をそのまま持ち回す
       * （結果を受信していた回では 0 に戻る）。
       */
      var plan = restartDelay(sawResultThisRun, emptyStreak, currentDelay);
      emptyStreak = plan.consecutiveEmpty;
      if (plan.stop) {
        currentDelay = 0;
        shutdown('SPEECH_ABORTED',
          '音声認識を継続できなかった。手動ボタンで計測を続けられる。');
        return;
      }
      currentDelay = plan.delayMs;
      setStatus('restarting');
      clearRestart();
      restartHandle = setTimer(function () {
        restartHandle = null;
        if (!enabled) { return; }
        start();
      }, plan.delayMs);
    }

    function handleError(event) {
      var code = (event && typeof event.error === 'string') ? event.error : '';
      // 要件 2-8: マイク許可の拒否は自動再開せずトグルを無効へ戻す
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        shutdown('MIC_DENIED', 'マイクの使用許可が必要である。手動ボタンで計測を続けられる。');
        return;
      }
      // 要件 15-7: オフライン / network エラーも自動再開しない
      if (code === 'network') {
        shutdown('SPEECH_NETWORK',
          '音声認識がネットワークを利用できない。手動ボタンで計測を続けられる。');
        return;
      }
      if (code === 'audio-capture') {
        shutdown('MIC_UNAVAILABLE', 'マイクを利用できない。手動ボタンで計測を続けられる。');
      }
      // no-speech / aborted は onend の再開待機（要件 2-6）に委ねる
    }

    function start() {
      if (factory === null) { return false; }
      // 要件 15-7: オフラインでは開始せずメッセージを出す
      if (host && host.navigator && host.navigator.onLine === false) {
        shutdown('SPEECH_OFFLINE',
          'オフラインのため音声認識を利用できない。手動ボタンで計測を続けられる。');
        return false;
      }
      sawResultThisRun = false;
      var instance;
      try {
        instance = new factory();
      } catch (e) {
        shutdown('SPEECH_UNAVAILABLE', '音声認識を開始できなかった。手動ボタンで計測を続けられる。');
        return false;
      }
      // 要件 2-2: 日本語・連続認識・暫定結果あり
      instance.lang = 'ja-JP';
      instance.continuous = true;
      instance.interimResults = true;
      instance.maxAlternatives = 1;
      instance.onresult = handleResult;
      instance.onend = handleEnd;
      instance.onerror = handleError;
      recognition = instance;
      try {
        instance.start();
      } catch (e) {
        recognition = null;
        shutdown('SPEECH_UNAVAILABLE', '音声認識を開始できなかった。手動ボタンで計測を続けられる。');
        return false;
      }
      setStatus('recognizing');
      return true;
    }

    return {
      isSupported: function () {
        return factory !== null;
      },

      isEnabled: function () {
        return enabled;
      },

      getStatus: function () {
        return status;
      },

      /** トグル ON（要件 2-2）。空結果の連続回数は 0 に戻す。 */
      enable: function () {
        if (factory === null) {
          onFatal({
            reasonKey: 'SPEECH_UNSUPPORTED',
            message: 'この端末は音声認識に対応していない。手動ボタンで計測できる。'
          });
          return false;
        }
        if (enabled) { return true; }
        enabled = true;
        emptyStreak = 0;
        currentDelay = 0;
        return start();
      },

      /** トグル OFF（要件 2-3）。以後の自動再開を行わない。 */
      disable: function () {
        if (!enabled && recognition === null) {
          setStatus('stopped');
          return true;
        }
        enabled = false;
        clearRestart();
        if (recognition !== null) {
          try {
            recognition.onend = null;
            recognition.stop();
          } catch (e) {
            /* 停止時の例外は無視する */
          }
          recognition = null;
        }
        setStatus('stopped');
        return true;
      },

      /** テストから認識オブジェクトのイベントを直接駆動するための入口。 */
      __test: {
        handleResult: handleResult,
        handleEnd: handleEnd,
        handleError: handleError,
        getEmptyStreak: function () { return emptyStreak; },
        getCurrentDelay: function () { return currentDelay; },
        getRecognition: function () { return recognition; }
      }
    };
  }

  /* ---- 3-7. Wake_Lock_Manager … タスク 15.1 --------------------------------
   * createWakeLockManager({ onStateChange, onMessage })
   *   isSupported / request / release / isHeld / handleVisibilityChange /
   *   setSessionActive / watch
   *
   * 要求の失敗（要件 9-6）および意図しない解放（要件 9-8）では、**同一の可視
   * 状態の間は自動再要求を行わない**。この「同一可視状態」を
   * `blockedInThisVisibility` フラグで表し、`visibilitychange` で可視へ復帰した
   * ときにのみ解除する。
   * ------------------------------------------------------------------------ */

  function createWakeLockManager(deps) {
    var d = isPlainObject(deps) ? deps : {};
    var onStateChange = (typeof d.onStateChange === 'function') ? d.onStateChange : function () {};
    var onMessage = (typeof d.onMessage === 'function') ? d.onMessage : function () {};
    var host = d.window || ((typeof window !== 'undefined') ? window : null);
    var doc = d.document || ((typeof document !== 'undefined') ? document : null);
    var api = d.wakeLock;
    if (api === undefined) {
      api = (host && host.navigator && host.navigator.wakeLock) ? host.navigator.wakeLock : null;
    }

    var sentinel = null;
    var held = false;
    var sessionActive = false;
    var blockedInThisVisibility = false;
    var unsupportedNotified = false;

    function setHeld(next) {
      if (held === next) { return; }
      held = next;
      onStateChange(held);
    }

    return {
      isSupported: function () {
        return api !== null && api !== undefined && typeof api.request === 'function';
      },

      isHeld: function () {
        return held;
      },

      /** セッションの進行状態を伝える（可視復帰時の再要求条件。要件 9-4）。 */
      setSessionActive: function (active) {
        sessionActive = (active === true);
      },

      /**
       * screen 種別の Wake Lock を要求する（要件 9-1, 9-5, 9-6, 9-9）。
       * 取得成功 / 取得失敗のいずれかに必ず確定する。
       */
      request: function () {
        var self = this;
        if (!self.isSupported()) {
          // 要件 9-5: 代替手段を使わず、メッセージだけを出して計測を継続する
          if (!unsupportedNotified) {
            unsupportedNotified = true;
            onMessage('warn',
              'この端末はスリープ防止に対応していない。端末の自動ロックで画面が消灯しうる。',
              0, 'WAKELOCK_UNSUPPORTED');
          }
          setHeld(false);
          return Promise.resolve(false);
        }
        if (held) { return Promise.resolve(true); }
        return Promise.resolve().then(function () {
          return api.request('screen');
        }).then(function (result) {
          sentinel = result;
          if (sentinel && typeof sentinel.addEventListener === 'function') {
            sentinel.addEventListener('release', function () {
              // 要件 9-8: 意図しない解放。同一可視状態では自動再要求しない
              sentinel = null;
              blockedInThisVisibility = true;
              setHeld(false);
            });
          }
          blockedInThisVisibility = false;
          setHeld(true);
          return true;
        }, function () {
          // 要件 9-6: 取得失敗。未取得に確定し、同一可視状態では再要求しない
          sentinel = null;
          blockedInThisVisibility = true;
          setHeld(false);
          onMessage('warn', 'スリープ防止を有効化できなかった。', 3000, 'WAKELOCK_FAILED');
          return false;
        });
      },

      /** 取得済みの Wake Lock を解放する（要件 9-7）。 */
      release: function () {
        var target = sentinel;
        sentinel = null;
        setHeld(false);
        if (target === null || typeof target.release !== 'function') {
          return Promise.resolve();
        }
        return Promise.resolve().then(function () {
          return target.release();
        }).then(function () {}, function () {});
      },

      /**
       * 可視状態の変化（要件 9-4）。
       * 可視へ復帰したら「同一可視状態」の抑止を解除し、未取得かつセッション
       * 進行中なら再要求する。
       */
      handleVisibilityChange: function (visible) {
        var isVisible = (typeof visible === 'boolean')
          ? visible
          : (doc ? doc.visibilityState !== 'hidden' : true);
        if (!isVisible) { return Promise.resolve(false); }
        blockedInThisVisibility = false;
        if (held || !sessionActive) { return Promise.resolve(false); }
        return this.request();
      },

      /** 同一可視状態内での自動再要求が抑止されているか（テスト用）。 */
      isBlocked: function () {
        return blockedInThisVisibility;
      },

      watch: function () {
        if (doc === null || typeof doc.addEventListener !== 'function') { return false; }
        var self = this;
        doc.addEventListener('visibilitychange', function () {
          self.handleVisibilityChange();
        });
        return true;
      }
    };
  }

  /* ---- 3-8. Theme_Manager … タスク 16.1（配色は 16.2 で index.html 側）----
   * createThemeManager({ storage })
   *   init / isPowerSave / toggle / getRenderBudgetMs / apply
   *   init の優先順位は「保存値 > OS 配色 > 既定（無効）」（要件 10-8〜10-10）。
   *   配色の切り替えは `documentElement` の `data-theme` 属性の付け外しのみで
   *   成立し、値は index.html の CSS トークンが持つ（要件 10-2）。
   * ------------------------------------------------------------------------ */

  function createThemeManager(deps) {
    var d = isPlainObject(deps) ? deps : {};
    var storage = d.storage || null;
    var host = d.window || ((typeof window !== 'undefined') ? window : null);
    var doc = d.document || ((typeof document !== 'undefined') ? document : null);
    var onMessage = (typeof d.onMessage === 'function') ? d.onMessage : function () {};

    var powerSave = false;

    function applyAttribute() {
      if (doc === null || !doc.documentElement) { return; }
      var theme = powerSave ? THEME.power : THEME.normal;
      if (theme.cssAttributeValue === null) {
        doc.documentElement.removeAttribute(THEME.cssAttribute);
      } else {
        doc.documentElement.setAttribute(THEME.cssAttribute, theme.cssAttributeValue);
      }
    }

    function prefersDark() {
      if (host === null || typeof host.matchMedia !== 'function') { return false; }
      try {
        var query = host.matchMedia('(prefers-color-scheme: dark)');
        return !!(query && query.matches);
      } catch (e) {
        return false;
      }
    }

    return {
      /**
       * 起動時の適用（要件 10-8, 10-9, 10-10）。
       * 最初の画面描画より前に呼ぶこと。保存値の読み出しは非同期だが、
       * 先に「保存値なしの既定」を同期的に適用しておくため、描画時点で
       * 必ず何らかのテーマが適用済みになる。
       */
      init: function () {
        // 同期段: OS 配色を見た暫定値を先に当てる（未保存時の最終値と一致する）
        powerSave = prefersDark();
        applyAttribute();
        if (storage === null || typeof storage.loadSettings !== 'function') {
          return Promise.resolve(powerSave);
        }
        var self = this;
        return storage.loadSettings().then(function (settings) {
          // 要件 10-8: 保存値は OS 配色より優先する
          if (settings && (settings.powerSave === true || settings.powerSave === false)) {
            powerSave = settings.powerSave;
          }
          applyAttribute();
          return powerSave;
        }, function () {
          applyAttribute();
          return powerSave;
        });
      },

      isPowerSave: function () {
        return powerSave;
      },

      /** 明示的に値を設定する（復元経路とテスト用）。 */
      apply: function (next) {
        powerSave = (next === true);
        applyAttribute();
        return powerSave;
      },

      /** 切り替え（要件 10-2 の 300ms、10-7 の 500ms 以内の保存）。 */
      toggle: function () {
        powerSave = !powerSave;
        // 属性の付け替えは同期処理なので、CSS の適用は同一フレームで完了する
        applyAttribute();
        if (storage === null || typeof storage.saveSettings !== 'function') {
          return Promise.resolve(powerSave);
        }
        var value = powerSave;
        return storage.saveSettings({ powerSave: value }).then(function () {
          return value;
        }, function (reason) {
          onMessage('error',
            (reason && reason.message) ? reason.message : '設定を保存できなかった。',
            0, (reason && reason.code) ? reason.code : 'UNAVAILABLE');
          return value;
        });
      },

      /** 描画バジェット（通常 0 / 省電力 200ms。要件 10-4）。 */
      getRenderBudgetMs: function () {
        return powerSave ? THEME.power.renderBudgetMs : THEME.normal.renderBudgetMs;
      }
    };
  }

  /* ---- 3-9. Session_Timer … タスク 17.1 / 17.2 -----------------------------
   * createSessionTimer({ now })
   *   start / ensureStarted / pause / resume / freeze / isFrozen / isPaused /
   *   isStarted / elapsedSec / snapshot / restore / reset
   *   算出は 2-6 の elapsedFrom に委譲する（単調非減少、0〜86399 に飽和）。
   *
   * 永続化しないメモリ内状態（設計 Data Models）:
   *   pausedTotalMs / pauseStartedAtMs / frozen / lastReportedSec
   * 復元時は保存済みの `startedAt` と `elapsedSec` から再構成する。
   * ------------------------------------------------------------------------ */

  function createSessionTimer(deps) {
    var d = isPlainObject(deps) ? deps : {};
    var now = (typeof d.now === 'function') ? d.now : function () { return Date.now(); };

    var startedAtMs = null;
    var startedAtIso = null;
    var pausedTotalMs = 0;
    var pauseStartedAtMs = null;
    var frozen = false;
    var lastReportedSec = 0;

    function computeAt(atMs) {
      if (startedAtMs === null) { return lastReportedSec; }
      var effectivePaused = pausedTotalMs;
      if (pauseStartedAtMs !== null) {
        var delta = atMs - pauseStartedAtMs;
        if (delta > 0) { effectivePaused += delta; }
      }
      return elapsedFrom(startedAtMs, effectivePaused, lastReportedSec, atMs);
    }

    return {
      /** 練習開始（要件 11-1）。経過時間を 0 秒に初期化する。 */
      start: function (atMs) {
        var at = (typeof atMs === 'number' && isFinite(atMs)) ? atMs : now();
        startedAtMs = at;
        startedAtIso = isoLocalFrom(at);
        pausedTotalMs = 0;
        pauseStartedAtMs = null;
        frozen = false;
        lastReportedSec = 0;
        return 0;
      },

      /** 計数コマンドでの暗黙の開始（要件 11-2）。既に開始済みなら何もしない。 */
      ensureStarted: function (atMs) {
        if (startedAtMs !== null) { return false; }
        this.start(atMs);
        return true;
      },

      isStarted: function () {
        return startedAtMs !== null;
      },

      isPaused: function () {
        return pauseStartedAtMs !== null;
      },

      isFrozen: function () {
        return frozen;
      },

      getStartedAtIso: function () {
        return startedAtIso;
      },

      /** 一時停止（要件 11-4）。経過時間を停止時点の値に維持する。 */
      pause: function (atMs) {
        if (startedAtMs === null || frozen || pauseStartedAtMs !== null) { return false; }
        var at = (typeof atMs === 'number' && isFinite(atMs)) ? atMs : now();
        lastReportedSec = computeAt(at);
        pauseStartedAtMs = at;
        return true;
      },

      /** 再開（要件 11-5）。一時停止時点の経過時間を起点に加算を再開する。 */
      resume: function (atMs) {
        if (pauseStartedAtMs === null) { return false; }
        var at = (typeof atMs === 'number' && isFinite(atMs)) ? atMs : now();
        var delta = at - pauseStartedAtMs;
        if (delta > 0) { pausedTotalMs += delta; }
        pauseStartedAtMs = null;
        return true;
      },

      /**
       * 達成時間の確定（要件 11-6, 11-7）。
       * 以後は再開せず、経過時間を増加させない。既に確定済みなら値を変えない。
       */
      freeze: function (atMs) {
        if (frozen) { return lastReportedSec; }
        var at = (typeof atMs === 'number' && isFinite(atMs)) ? atMs : now();
        if (startedAtMs === null) {
          frozen = true;
          return lastReportedSec;
        }
        lastReportedSec = computeAt(at);
        frozen = true;
        return lastReportedSec;
      },

      /**
       * 経過秒（要件 11-3, 11-8, 11-9）。
       * 単調非減少で 0〜86399 に飽和し、確定後は増加しない。
       */
      elapsedSec: function (atMs) {
        if (frozen) { return lastReportedSec; }
        var at = (typeof atMs === 'number' && isFinite(atMs)) ? atMs : now();
        if (pauseStartedAtMs !== null) { return lastReportedSec; }
        lastReportedSec = computeAt(at);
        return lastReportedSec;
      },

      snapshot: function () {
        return {
          startedAt: startedAtIso,
          elapsedSec: lastReportedSec,
          frozen: frozen
        };
      },

      /**
       * 復元（要件 11-8）。保存済みの開始時刻・経過時間から状態を再構成する。
       * 開始時刻が解釈できない場合は「現在時刻 − 経過時間」を開始時刻とみなす。
       */
      restore: function (snapshot, atMs) {
        var s = isPlainObject(snapshot) ? snapshot : {};
        var at = (typeof atMs === 'number' && isFinite(atMs)) ? atMs : now();
        var savedSec = clampElapsedSec(s.elapsedSec);

        var parsed = (typeof s.startedAt === 'string') ? Date.parse(s.startedAt) : NaN;
        if (!isNaN(parsed)) {
          startedAtMs = parsed;
          startedAtIso = s.startedAt;
        } else if (savedSec > 0) {
          startedAtMs = at - savedSec * 1000;
          startedAtIso = isoLocalFrom(startedAtMs);
        } else {
          startedAtMs = null;
          startedAtIso = null;
        }

        frozen = (s.frozen === true);
        pauseStartedAtMs = null;
        lastReportedSec = savedSec;

        /*
         * 保存済みの経過時間と「現在時刻 − 開始時刻」の差は、その間の一時停止と
         * 非可視期間の合計にあたる。確定済み（frozen）でなければ、差の分を
         * 一時停止累計として扱い、復元直後の算出値が保存値を下回らないように
         * しつつ、以後は現在時刻の進みに追従させる。
         */
        pausedTotalMs = 0;
        if (startedAtMs !== null && !frozen) {
          var wall = at - startedAtMs;
          var gap = wall - savedSec * 1000;
          if (gap > 0) { pausedTotalMs = gap; }
        }
        return lastReportedSec;
      },

      /** 新規セッション用に初期化する（メニュー切替・全カウント初期化）。 */
      reset: function () {
        startedAtMs = null;
        startedAtIso = null;
        pausedTotalMs = 0;
        pauseStartedAtMs = null;
        frozen = false;
        lastReportedSec = 0;
      }
    };
  }


  /* ---- 3-10. Renderer / Display_Panel … タスク 12.1〜12.6 ------------------
   * createRenderer({ getBudgetMs, paint, now, requestFrame })  … 12.1
   *   markDirty(region) / flush() / isPending()
   *   領域: 'active' | 'progress' | 'list' | 'timer' | 'feedback' | 'status'
   *   dirty フラグを立てて requestAnimationFrame で 1 回にまとめる。
   *   省電力時は `getBudgetMs()` が 200 を返すため、前回描画から 200ms 未満の
   *   変化は待機してまとめられ、毎秒 5 回以下に制限される（要件 10-3, 10-4）。
   *   レンダラは状態を読むだけで書き換えない（設計の単一方向データフロー）。
   *
   * createDisplayPanel({ doc, getViewState, dispatch, ... })   … 12.2〜12.6
   *   markDirty / render / renderAll / showMessage / showConfirm /
   *   setSpeechText / updateLayoutMode / isReady
   * ------------------------------------------------------------------------ */

  var RENDER_REGIONS = deepFreeze(['active', 'progress', 'list', 'timer', 'feedback', 'status']);

  /*
   * requestAnimationFrame が間引かれる環境（非可視タブ、ヘッドレスブラウザ、
   * 一部の組み込み WebView）でも再描画を取りこぼさないための保険の待機時間。
   * rAF が正常に動く環境では rAF が先に走り、こちらの呼び出しはトークン判定で
   * 空振りになるため、余分な描画は発生しない。
   */
  var RENDER_FALLBACK_MS = 100;

  function createRenderer(deps) {
    var d = isPlainObject(deps) ? deps : {};
    var paint = (typeof d.paint === 'function') ? d.paint : function () {};
    var getBudgetMs = (typeof d.getBudgetMs === 'function') ? d.getBudgetMs : function () { return 0; };
    var now = (typeof d.now === 'function') ? d.now : function () { return Date.now(); };
    var requestFrame = (typeof d.requestFrame === 'function') ? d.requestFrame : function (fn) {
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        return window.requestAnimationFrame(fn);
      }
      return setTimeout(fn, 16);
    };
    var defer = (typeof d.defer === 'function') ? d.defer : function (fn, ms) {
      return setTimeout(fn, ms);
    };

    var dirty = Object.create(null);
    var pending = false;
    var lastPaintAt = null;
    // 同一の予約に対して最初に到達したコールバックだけが描画する
    var token = 0;

    function frame(expectedToken) {
      if (expectedToken !== undefined && expectedToken !== token) { return; }
      token++;
      pending = false;
      lastPaintAt = now();
      var regions = dirty;
      dirty = Object.create(null);
      paint(regions);
    }

    function schedule() {
      if (pending) { return; }
      pending = true;
      var expected = token;
      var budget = getBudgetMs();
      var wait = 0;
      if (typeof budget === 'number' && budget > 0 && lastPaintAt !== null) {
        var since = now() - lastPaintAt;
        if (since < budget) { wait = budget - since; }
      }
      if (wait > 0) {
        defer(function () { frame(expected); }, wait);
        return;
      }
      requestFrame(function () { frame(expected); });
      var fallback = (typeof budget === 'number' && budget > RENDER_FALLBACK_MS)
        ? budget
        : RENDER_FALLBACK_MS;
      defer(function () { frame(expected); }, fallback);
    }

    return {
      markDirty: function (region) {
        if (RENDER_REGIONS.indexOf(region) === -1) { return false; }
        dirty[region] = true;
        schedule();
        return true;
      },

      markAllDirty: function () {
        for (var i = 0; i < RENDER_REGIONS.length; i++) { dirty[RENDER_REGIONS[i]] = true; }
        schedule();
      },

      /** 待機中の描画を即時実行する（テストと画面遷移で使う）。 */
      flush: function () {
        if (!pending) { return false; }
        frame();
        return true;
      },

      isPending: function () {
        return pending;
      }
    };
  }

  /* ---- Display_Panel ------------------------------------------------------ */

  /** app.js が参照する要素 id（index.html の「id 契約」と 1 対 1 に対応する）。 */
  var PANEL_IDS = deepFreeze([
    'app', 'panel-main', 'panel-history', 'panel-menu',
    'menu-name', 'elapsed-time', 'speech-status', 'speech-status-text',
    'wakelock-indicator', 'toggle-voice', 'toggle-voice-state',
    'toggle-power-save', 'toggle-power-state',
    'btn-session-start', 'btn-session-pause', 'btn-session-end',
    'btn-open-history', 'btn-open-menu',
    'active-drill', 'active-section', 'active-name', 'active-make',
    'active-target', 'active-attempt', 'active-rate',
    'progress-text', 'progress-bar', 'progress-bar-fill',
    'drill-list-wrap', 'drill-list',
    'btn-make', 'btn-miss', 'btn-undo', 'btn-prev', 'btn-next',
    'btn-reset-counts',
    'feedback-final', 'feedback-interim', 'feedback-message',
    'confirm-backdrop', 'confirm-title', 'confirm-message',
    'btn-confirm-cancel', 'btn-confirm-ok',
    'tpl-drill-row', 'tpl-aggregate-row'
  ]);

  /** 5 個の操作ボタンとコマンドの対応（要件 7-1, 7-4）。 */
  var OP_BUTTONS = deepFreeze([
    { id: 'btn-make', command: 'MAKE' },
    { id: 'btn-miss', command: 'MISS' },
    { id: 'btn-undo', command: 'UNDO' },
    { id: 'btn-prev', command: 'PREV' },
    { id: 'btn-next', command: 'NEXT' }
  ]);

  function createDisplayPanel(deps) {
    var d = isPlainObject(deps) ? deps : {};
    var doc = d.doc || ((typeof document !== 'undefined') ? document : null);
    var host = d.window || ((typeof window !== 'undefined') ? window : null);
    var getViewState = (typeof d.getViewState === 'function') ? d.getViewState : function () { return null; };
    var dispatch = (typeof d.dispatch === 'function') ? d.dispatch : function () {};
    var selectDrillIndex = (typeof d.selectDrillIndex === 'function') ? d.selectDrillIndex : function () {};
    var onResetCounts = (typeof d.onResetCounts === 'function') ? d.onResetCounts : function () {};
    var getBudgetMs = (typeof d.getBudgetMs === 'function') ? d.getBudgetMs : function () { return 0; };
    /*
     * タッチ操作に付けるタイムスタンプの供給元。既定は Date.now。
     * ディスパッチャの 300ms 連打破棄（要件 7-7）が掛かるため、DOM テストは
     * ここを差し替えて 1 ミリ秒内に複数回 click しても破棄されないようにする。
     */
    var timestamp = (typeof d.timestamp === 'function') ? d.timestamp : function () {
      return Date.now();
    };
    var vibrate = d.vibrate;
    if (typeof vibrate !== 'function') {
      vibrate = function (ms) {
        if (host && host.navigator && typeof host.navigator.vibrate === 'function') {
          try {
            host.navigator.vibrate(ms);
            return true;
          } catch (e) {
            return false;
          }
        }
        return false;
      };
    }

    /* ---- 要素参照の収集（欠けていれば ready:false で早期に知らせる）---- */

    var el = {};
    var missing = [];
    if (doc === null) {
      missing = PANEL_IDS.slice();
    } else {
      for (var i = 0; i < PANEL_IDS.length; i++) {
        var node = doc.getElementById(PANEL_IDS[i]);
        if (node === null) { missing.push(PANEL_IDS[i]); } else { el[PANEL_IDS[i]] = node; }
      }
    }
    var ready = (missing.length === 0);

    /* ---- 達成状態の直前値（振動を 1 回だけ発生させるため。要件 4-10）---- */
    var lastMakeById = Object.create(null);
    var messageTimer = null;
    var confirmState = null;

    function setText(node, text) {
      if (node && node.textContent !== text) { node.textContent = text; }
    }

    function drillById(menu, id) {
      var drills = menuDrillsOf(menu);
      for (var k = 0; k < drills.length; k++) {
        if (drills[k] && toIntegerOrNull(drills[k].id) === id) { return drills[k]; }
      }
      return null;
    }

    function countOf(counts, id) {
      for (var k = 0; k < counts.length; k++) {
        if (counts[k].id === id) { return counts[k]; }
      }
      return { id: id, make: 0, attempt: 0 };
    }

    /* ---- 領域別の描画（状態を書き換えない）----------------------------- */

    function paintActive(state) {
      var drill = state.activeDrill;
      var counts = state.counts;
      var id = (drill !== null && typeof drill === 'object') ? toIntegerOrNull(drill.id) : null;
      var c = (id === null) ? { make: 0, attempt: 0 } : countOf(counts, id);
      var target = (drill !== null && typeof drill === 'object')
        ? (toIntegerOrNull(drill.targetMake) || 0)
        : 0;

      setText(el['active-section'], (drill && typeof drill.section === 'string') ? drill.section : '');
      setText(el['active-name'], (drill && typeof drill.name === 'string') ? drill.name : '');
      setText(el['active-make'], String(c.make));
      setText(el['active-target'], String(target));
      setText(el['active-attempt'], String(c.attempt));
      // 要件 4-6: Attempt 0 の成功率は --%
      setText(el['active-rate'], formatRate(c.make, c.attempt));

      // 要件 4-9 / 4-12 / 17-10: targetMake 以上なら達成済みとして識別できる表示
      var achieved = (target > 0 && c.make >= target);
      el['active-drill'].setAttribute('data-achieved', achieved ? 'true' : 'false');
    }

    function paintProgress(state) {
      // 要件 8-4: 目標合計を超えても実際の全体成功数を表示する
      setText(el['progress-text'], state.totalMake + ' / ' + state.targetTotal + '本 IN');
      var ratio = progressRatio(state.totalMake, state.targetTotal);
      el['progress-bar-fill'].style.width = ratio + '%';
      el['progress-bar'].setAttribute('aria-valuenow', String(ratio));
      el['progress-bar'].setAttribute('aria-valuetext',
        state.totalMake + ' / ' + state.targetTotal + '本');
    }

    function paintList(state) {
      var list = el['drill-list'];
      var mode = list.getAttribute('data-mode') === 'aggregate' ? 'aggregate' : 'list';
      var frag = doc.createDocumentFragment();

      if (mode === 'aggregate') {
        // 要件 8-10: section 単位に集約し、Make 合計と targetMake 合計を併記する
        var rows = aggregateBySection(state.menu, state.counts);
        for (var r = 0; r < rows.length; r++) {
          var aggRow = el['tpl-aggregate-row'].content.firstElementChild.cloneNode(true);
          aggRow.querySelector('.drill-name').textContent =
            (rows[r].section.length > 0) ? rows[r].section : '(区分なし)';
          aggRow.querySelector('.drill-make').textContent =
            rows[r].make + ' / ' + rows[r].targetMake;
          if (rows[r].targetMake > 0 && rows[r].make >= rows[r].targetMake) {
            aggRow.setAttribute('data-achieved', 'true');
          }
          frag.appendChild(aggRow);
        }
      } else {
        var drills = menuDrillsOf(state.menu);
        for (var i = 0; i < drills.length; i++) {
          var drill = drills[i];
          var id = toIntegerOrNull(drill && drill.id);
          var c = (id === null) ? { make: 0, attempt: 0 } : countOf(state.counts, id);
          var target = toIntegerOrNull(drill && drill.targetMake) || 0;

          var row = el['tpl-drill-row'].content.firstElementChild.cloneNode(true);
          row.setAttribute('data-index', String(i));
          if (id !== null) { row.setAttribute('data-drill-id', String(id)); }
          // 要件 8-8: アクティブ行を区別する
          row.setAttribute('aria-current', (i === state.activeIndex) ? 'true' : 'false');
          // 要件 4-12 / 17-10: 達成済みの識別表示（Make は実際の値をそのまま表示）
          row.setAttribute('data-achieved',
            (target > 0 && c.make >= target) ? 'true' : 'false');
          row.querySelector('.drill-section').textContent =
            (drill && typeof drill.section === 'string') ? drill.section : '';
          row.querySelector('.drill-name').textContent =
            (drill && typeof drill.name === 'string') ? drill.name : '';
          // 要件 8-7: 各種目に「{Make} / {targetMake}」を併記する
          row.querySelector('.drill-make').textContent = c.make + ' / ' + target;
          row.querySelector('.drill-rate').textContent = formatRate(c.make, c.attempt);
          frag.appendChild(row);
        }
      }

      list.textContent = '';
      list.appendChild(frag);
    }

    function paintTimer(state) {
      setText(el['elapsed-time'], formatElapsed(state.elapsedSec));
      el['elapsed-time'].setAttribute('data-paused', state.paused ? 'true' : 'false');
      el['btn-session-pause'].textContent = state.paused ? '再開' : '一時停止';
    }

    function paintStatus(state) {
      setText(el['menu-name'], (state.menu && typeof state.menu.name === 'string') ? state.menu.name : '');

      var speech = state.speechStatus || 'stopped';
      var speechText = (speech === 'recognizing') ? '認識中'
        : (speech === 'restarting') ? '再開待機中' : '停止中';
      el['speech-status'].setAttribute('data-state', speech);
      setText(el['speech-status-text'], speechText);

      el['toggle-voice'].setAttribute('aria-pressed', state.speechEnabled ? 'true' : 'false');
      setText(el['toggle-voice-state'], state.speechEnabled ? 'ON' : 'OFF');
      // 要件 2-7: 非対応時はトグルを操作不可にする
      el['toggle-voice'].disabled = (state.speechSupported === false);

      el['toggle-power-save'].setAttribute('aria-pressed', state.powerSave ? 'true' : 'false');
      setText(el['toggle-power-state'], state.powerSave ? 'ON' : 'OFF');

      // 要件 9-3: 取得中はインジケーターを提示する
      if (state.wakeLockHeld) {
        el['wakelock-indicator'].removeAttribute('hidden');
        el['wakelock-indicator'].setAttribute('data-state', 'on');
      } else {
        el['wakelock-indicator'].setAttribute('hidden', '');
        el['wakelock-indicator'].setAttribute('data-state', 'off');
      }
    }

    /** 要件 4-10: Make が targetMake に達した回のみ 200ms 振動する。 */
    function pulseIfAchieved(state) {
      var drills = menuDrillsOf(state.menu);
      for (var i = 0; i < drills.length; i++) {
        var id = toIntegerOrNull(drills[i] && drills[i].id);
        if (id === null) { continue; }
        var target = toIntegerOrNull(drills[i].targetMake) || 0;
        var make = countOf(state.counts, id).make;
        var prev = lastMakeById[id];
        /*
         * 「targetMake に到達した回のみ 1 回」を、描画が省電力バジェットで
         * まとめられて Make が targetMake を飛び越えた場合でも満たすため、
         * 判定は `直前 < target かつ 今回 ≥ target`（= 到達の瞬間をまたいだか）
         * とする。以後は `直前 ≥ target` になるので超過分では振動しない。
         */
        if (target > 0 && prev !== undefined && prev < target && make >= target) {
          vibrate(200);
        }
        lastMakeById[id] = make;
      }
    }

    function paint(regions) {
      if (!ready) { return; }
      var state = getViewState();
      if (state === null || state === undefined) { return; }
      if (regions.active) { paintActive(state); }
      if (regions.progress) { paintProgress(state); }
      if (regions.list) { paintList(state); }
      if (regions.timer) { paintTimer(state); }
      if (regions.status) { paintStatus(state); }
      if (regions.active || regions.list) { pulseIfAchieved(state); }
    }

    var renderer = createRenderer({
      paint: paint,
      getBudgetMs: getBudgetMs,
      now: d.now,
      requestFrame: d.requestFrame,
      defer: d.defer
    });

    /* ---- 入力の配線（12.4）-------------------------------------------- */

    function wireButtons() {
      if (!ready) { return; }
      var i;
      for (i = 0; i < OP_BUTTONS.length; i++) {
        (function (entry) {
          el[entry.id].addEventListener('click', function (event) {
            if (event && typeof event.preventDefault === 'function') { event.preventDefault(); }
            // 要件 7-4: タッチも音声と同一のディスパッチャ経路を通る
            dispatch(entry.command, 'touch', timestamp());
          });
        })(OP_BUTTONS[i]);
      }

      /*
       * トグルとセッション操作（要件 2-1, 10-1, 11-1, 11-4, 11-7, 14-10）。
       * これらは計数系ではないため、音声コマンドは提供しない
       * （要件 7-11, 18-15）。ハンドラの中身は bootstrap が渡す。
       */
      var actions = [
        ['toggle-voice', d.onToggleVoice],
        ['toggle-power-save', d.onTogglePowerSave],
        ['btn-session-start', d.onSessionStart],
        ['btn-session-pause', d.onSessionPause],
        ['btn-session-end', d.onSessionEnd],
        ['btn-open-history', d.onOpenHistory],
        ['btn-open-menu', d.onOpenMenu]
      ];
      for (i = 0; i < actions.length; i++) {
        (function (id, handler) {
          if (typeof handler !== 'function') { return; }
          el[id].addEventListener('click', function (event) {
            if (event && typeof event.preventDefault === 'function') { event.preventDefault(); }
            handler();
          });
        })(actions[i][0], actions[i][1]);
      }

      // 要件 6-8: 種目一覧のタップでアクティブ種目を設定する
      el['drill-list'].addEventListener('click', function (event) {
        var node = event ? event.target : null;
        while (node && node !== el['drill-list'] && !node.hasAttribute('data-index')) {
          node = node.parentNode;
        }
        if (!node || node === el['drill-list']) { return; }
        var index = toIntegerOrNull(Number(node.getAttribute('data-index')));
        if (index === null) { return; }
        selectDrillIndex(index, 'touch', timestamp());
      });

      // 要件 7-9 / 7-10: 全カウント初期化は確認操作の完了まで状態を変えない
      el['btn-reset-counts'].addEventListener('click', function () {
        api.showConfirm({
          title: '全カウントを初期化する',
          message: '選択中メニューの全種目の成功数・試投数と操作履歴をすべて 0 に戻す。この操作は取り消せない。',
          okLabel: '初期化する'
        }).then(function (confirmed) {
          if (confirmed) { onResetCounts(); }
        });
      });
    }

    /* ---- 確認ダイアログ（12.5）---------------------------------------- */

    function closeConfirm(result) {
      if (confirmState === null) { return; }
      var resolve = confirmState.resolve;
      confirmState = null;
      el['confirm-backdrop'].setAttribute('hidden', '');
      resolve(result);
    }

    function wireConfirm() {
      if (!ready) { return; }
      el['btn-confirm-ok'].addEventListener('click', function () { closeConfirm(true); });
      el['btn-confirm-cancel'].addEventListener('click', function () { closeConfirm(false); });
      el['confirm-backdrop'].addEventListener('click', function (event) {
        if (event && event.target === el['confirm-backdrop']) { closeConfirm(false); }
      });
    }

    var api = {
      isReady: function () {
        return ready;
      },

      missingElements: function () {
        return missing.slice();
      },

      markDirty: function (region) {
        return renderer.markDirty(region);
      },

      markAllDirty: function () {
        renderer.markAllDirty();
      },

      /** 待機中の描画を即時実行する。 */
      flush: function () {
        return renderer.flush();
      },

      /** 全領域を同期的に描画する（初回描画とパネル復帰で使う）。 */
      renderAll: function () {
        if (!ready) { return false; }
        var all = {};
        for (var i = 0; i < RENDER_REGIONS.length; i++) { all[RENDER_REGIONS[i]] = true; }
        paint(all);
        return true;
      },

      /**
       * 利用者向け提示の単一経路（要件 2-4, 5-5, 6-5, 6-6, 10-6, 12-7）。
       * `holdMs` が 0 以下なら消さずに残す（保存できないことの通知など）。
       * 同一原因の重複抑止は呼び出し側（Persistence_Coordinator）が行う。
       */
      showMessage: function (kind, text, holdMs, reasonKey) {
        if (!ready) { return false; }
        var node = el['feedback-message'];
        var level = (kind === 'warn' || kind === 'error') ? kind : 'info';
        node.setAttribute('data-kind', level);
        if (typeof reasonKey === 'string' && reasonKey.length > 0) {
          node.setAttribute('data-reason', reasonKey);
        } else {
          node.removeAttribute('data-reason');
        }
        node.textContent = String(text);
        if (messageTimer !== null) {
          clearTimeout(messageTimer);
          messageTimer = null;
        }
        var hold = (typeof holdMs === 'number' && holdMs > 0) ? holdMs : 0;
        if (hold > 0) {
          messageTimer = setTimeout(function () {
            messageTimer = null;
            node.textContent = '';
            node.removeAttribute('data-reason');
          }, hold);
        }
        return true;
      },

      /** 確定テキストと暫定テキストを視覚的に区別して表示する（要件 2-9）。 */
      setSpeechText: function (finalText, interimText) {
        if (!ready) { return false; }
        setText(el['feedback-final'], (typeof finalText === 'string') ? finalText : '');
        setText(el['feedback-interim'], (typeof interimText === 'string') ? interimText : '');
        return true;
      },

      /**
       * Promise ベースの確認表示（要件 7-9, 17-11, 17-15, 18-9）。
       * 解決するまで呼び出し側は状態を変えない。
       */
      showConfirm: function (spec) {
        if (!ready) { return Promise.resolve(false); }
        var s = isPlainObject(spec) ? spec : {};
        if (confirmState !== null) { closeConfirm(false); }
        setText(el['confirm-title'], (typeof s.title === 'string') ? s.title : '確認');
        setText(el['confirm-message'], (typeof s.message === 'string') ? s.message : '');
        el['btn-confirm-ok'].textContent = (typeof s.okLabel === 'string') ? s.okLabel : '実行する';
        el['btn-confirm-cancel'].textContent = (typeof s.cancelLabel === 'string')
          ? s.cancelLabel
          : 'やめる';
        el['confirm-backdrop'].removeAttribute('hidden');
        return new Promise(function (resolve) {
          confirmState = { resolve: resolve };
          try {
            el['btn-confirm-cancel'].focus();
          } catch (e) {
            /* フォーカス移動の失敗は無視する */
          }
        });
      },

      /** テストと外部イベントから確認表示を閉じる。 */
      resolveConfirm: function (result) {
        closeConfirm(result === true);
      },

      /**
       * 表示領域に応じて種目一覧の表示形式を切り替える（要件 8-9, 8-10, 8-11）。
       * 変化があったときだけ list 領域を dirty にする。
       */
      updateLayoutMode: function (width, height) {
        if (!ready) { return null; }
        var w = (typeof width === 'number') ? width : (host ? host.innerWidth : 0);
        var h = (typeof height === 'number') ? height : (host ? host.innerHeight : 0);
        var mode = layoutModeFor(w, h);
        if (el['drill-list'].getAttribute('data-mode') !== mode) {
          el['drill-list'].setAttribute('data-mode', mode);
          renderer.markDirty('list');
        }
        return mode;
      },

      /** パネルの切り替え（ページ遷移を行わない。要件 14-10, 14-11, 16-1）。 */
      showPanel: function (name) {
        if (!ready) { return false; }
        var panels = ['panel-main', 'panel-history', 'panel-menu'];
        var wanted = 'panel-' + name;
        for (var i = 0; i < panels.length; i++) {
          if (panels[i] === wanted) {
            el[panels[i]].removeAttribute('hidden');
          } else {
            el[panels[i]].setAttribute('hidden', '');
          }
        }
        if (wanted === 'panel-main') { renderer.markAllDirty(); }
        return true;
      },

      /** 初期化: ボタンと確認ダイアログを配線し、レイアウト形式を確定させる。 */
      init: function () {
        if (!ready) { return false; }
        wireButtons();
        wireConfirm();
        api.updateLayoutMode();
        if (host && typeof host.addEventListener === 'function') {
          host.addEventListener('resize', function () { api.updateLayoutMode(); });
          host.addEventListener('orientationchange', function () { api.updateLayoutMode(); });
        }
        return true;
      },

      /** 達成表示の直前値を作り直す（新規セッション / 全カウント初期化）。 */
      resetAchievementTracking: function () {
        lastMakeById = Object.create(null);
      },

      /** テスト用の要素参照（DOM 層の検証でのみ使う）。 */
      elements: function () {
        return el;
      }
    };

    return api;
  }

  /* ---- 3-11. History_View … タスク 19.1 / 19.2 -----------------------------
   * createHistoryView({ doc, storage, panel, onBack, now, random })
   *   open / close / refresh / selectRecord / requestDelete / saveSession
   *   並び順は 2-6 の sortHistoryIndex に従う（endedAt 降順 → id 降順）。
   *   履歴レコードの組み立ては 2-6 の buildHistoryRecord（純粋関数）に委譲する。
   * ------------------------------------------------------------------------ */

  var HISTORY_IDS = deepFreeze([
    'history-empty', 'history-list', 'history-detail', 'history-detail-title',
    'history-detail-list', 'btn-history-delete', 'btn-history-detail-close',
    'btn-history-back', 'tpl-history-row', 'tpl-history-detail-row'
  ]);

  function createHistoryView(deps) {
    var d = isPlainObject(deps) ? deps : {};
    var doc = d.doc || ((typeof document !== 'undefined') ? document : null);
    var storage = d.storage || null;
    var panel = d.panel || null;
    var onBack = (typeof d.onBack === 'function') ? d.onBack : function () {};
    var now = (typeof d.now === 'function') ? d.now : function () { return Date.now(); };
    var random = (typeof d.random === 'function') ? d.random : Math.random;

    var el = {};
    var missing = [];
    if (doc === null) {
      missing = HISTORY_IDS.slice();
    } else {
      for (var i = 0; i < HISTORY_IDS.length; i++) {
        var node = doc.getElementById(HISTORY_IDS[i]);
        if (node === null) { missing.push(HISTORY_IDS[i]); } else { el[HISTORY_IDS[i]] = node; }
      }
    }
    var ready = (missing.length === 0);

    var records = [];
    var selectedId = null;

    function message(kind, text, holdMs, reasonKey) {
      if (panel && typeof panel.showMessage === 'function') {
        panel.showMessage(kind, text, holdMs, reasonKey);
      }
    }

    function recordById(id) {
      for (var i = 0; i < records.length; i++) {
        if (records[i].id === id) { return records[i]; }
      }
      return null;
    }

    /** 一覧を描画する（要件 14-2, 14-3, 14-8）。 */
    function renderList() {
      var list = el['history-list'];
      list.textContent = '';
      if (records.length === 0) {
        el['history-empty'].removeAttribute('hidden');
        el['history-detail'].setAttribute('hidden', '');
        return;
      }
      el['history-empty'].setAttribute('hidden', '');

      var frag = doc.createDocumentFragment();
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        var row = el['tpl-history-row'].content.firstElementChild.cloneNode(true);
        row.setAttribute('data-id', r.id);
        row.setAttribute('aria-current', (r.id === selectedId) ? 'true' : 'false');
        row.querySelector('.history-when').textContent = formatEndedAt(r.endedAt);
        row.querySelector('.history-menu-name').textContent =
          (typeof r.menuName === 'string') ? r.menuName : '';
        // 要件 14-3: 達成時間・{全体成功数} / {目標合計}・全体成功率
        row.querySelector('.history-stats').textContent =
          formatElapsed(r.completionSec) + ' · ' +
          r.totalMake + ' / ' + r.targetTotal + ' · ' +
          formatRate(r.totalMake, r.totalAttempt);
        row.querySelector('.history-achieved').textContent = r.achieved ? '達成' : '未達';
        row.setAttribute('data-achieved', r.achieved ? 'true' : 'false');
        frag.appendChild(row);
      }
      list.appendChild(frag);
    }

    /** 詳細を描画する（要件 14-4）。 */
    function renderDetail() {
      var record = (selectedId === null) ? null : recordById(selectedId);
      if (record === null) {
        el['history-detail'].setAttribute('hidden', '');
        return;
      }
      el['history-detail'].removeAttribute('hidden');
      el['history-detail-title'].textContent =
        formatEndedAt(record.endedAt) + ' · ' + record.menuName;

      var list = el['history-detail-list'];
      list.textContent = '';
      var frag = doc.createDocumentFragment();
      var drills = isArrayValue(record.drills) ? record.drills : [];
      for (var i = 0; i < drills.length; i++) {
        var drill = drills[i];
        var row = el['tpl-history-detail-row'].content.firstElementChild.cloneNode(true);
        row.querySelector('.drill-name').textContent =
          (typeof drill.name === 'string') ? drill.name : '';
        row.querySelector('.drill-make').textContent =
          drill.make + ' / ' + drill.targetMake + '（試投 ' + drill.attempt + '）';
        // 要件 14-4: Attempt 0 の成功率は --%
        row.querySelector('.drill-rate').textContent = formatRate(drill.make, drill.attempt);
        frag.appendChild(row);
      }
      list.appendChild(frag);
    }

    function load() {
      if (storage === null) {
        records = [];
        renderList();
        renderDetail();
        return Promise.resolve([]);
      }
      return storage.listHistory().then(function (loaded) {
        // listHistory は既に endedAt 降順 → id 降順で返すが、順序の正は
        // sortHistoryIndex なので念のためここでも通す（要件 14-2）。
        records = sortHistoryIndex(isArrayValue(loaded) ? loaded : []);
        if (selectedId !== null && recordById(selectedId) === null) { selectedId = null; }
        renderList();
        renderDetail();
        return records;
      }, function (reason) {
        records = [];
        renderList();
        renderDetail();
        message('error',
          (reason && reason.message) ? reason.message : '練習履歴を読み込めなかった。',
          0, (reason && reason.code) ? reason.code : 'UNAVAILABLE');
        return [];
      });
    }

    var api = {
      isReady: function () {
        return ready;
      },

      missingElements: function () {
        return missing.slice();
      },

      /** 履歴画面を開く（要件 14-10。進行中セッションの計測は継続する）。 */
      open: function () {
        if (!ready) { return Promise.resolve(false); }
        if (panel && typeof panel.showPanel === 'function') { panel.showPanel('history'); }
        return load().then(function () { return true; });
      },

      close: function () {
        if (!ready) { return false; }
        selectedId = null;
        el['history-detail'].setAttribute('hidden', '');
        onBack();
        return true;
      },

      refresh: load,

      getRecords: function () {
        return records.slice();
      },

      /** レコードを 1 件選択して詳細を表示する（要件 14-4）。 */
      selectRecord: function (id) {
        if (!ready) { return false; }
        if (recordById(id) === null) { return false; }
        selectedId = id;
        renderList();
        renderDetail();
        return true;
      },

      /** 確認操作を経て 1 件のみ削除する（要件 14-7）。 */
      requestDelete: function (id) {
        if (!ready || storage === null) { return Promise.resolve(false); }
        var record = recordById(id);
        if (record === null) { return Promise.resolve(false); }
        var confirmFn = (panel && typeof panel.showConfirm === 'function')
          ? panel.showConfirm
          : function () { return Promise.resolve(false); };
        return confirmFn({
          title: '履歴を削除する',
          message: formatEndedAt(record.endedAt) + ' の記録（' + record.menuName +
            '）を削除する。この操作は取り消せない。',
          okLabel: '削除する'
        }).then(function (confirmed) {
          if (!confirmed) { return false; }
          return storage.deleteHistory(id).then(function () {
            if (selectedId === id) { selectedId = null; }
            return load().then(function () { return true; });
          }, function (reason) {
            message('error',
              (reason && reason.message) ? reason.message : '履歴を削除できなかった。',
              0, (reason && reason.code) ? reason.code : 'UNAVAILABLE');
            return false;
          });
        });
      },

      /**
       * セッション終了時の履歴保存（要件 14-1, 14-9, 12-10）。
       * 全体試投数 0 なら保存せず件数を維持してメッセージを出す（要件 14-9）。
       * 保存成功時は進行中セッションの保存データを削除する（要件 12-10）。
       *
       * @param {{menu: object, counts: Array, completionSec: number}} params
       * @returns {Promise<{saved: boolean, record: (object|null), reason: (object|null)}>}
       */
      saveSession: function (params) {
        var p = isPlainObject(params) ? params : {};
        var totalsNow = totals(p.counts);
        if (totalsNow.attempt === 0) {
          message('info', '記録対象の計測がなかったため履歴を保存しなかった。', 3000,
            'HISTORY_NO_ATTEMPT');
          return Promise.resolve({ saved: false, record: null, reason: null });
        }
        if (storage === null) {
          return Promise.resolve({ saved: false, record: null, reason: null });
        }
        var at = now();
        var record = buildHistoryRecord({
          id: makeHistoryId(at, random),
          endedAt: (typeof p.endedAt === 'string') ? p.endedAt : isoLocalFrom(at),
          completionSec: p.completionSec,
          menu: p.menu,
          counts: p.counts
        });
        return storage.appendHistory(record).then(function () {
          // 要件 12-10: 履歴保存が成功したら進行中セッションを削除する
          return storage.deleteSession().then(function () {
            return { saved: true, record: record, reason: null };
          }, function () {
            return { saved: true, record: record, reason: null };
          });
        }, function (reason) {
          message('error',
            (reason && reason.message) ? reason.message : '練習履歴を保存できなかった。',
            0, (reason && reason.code) ? reason.code : 'UNAVAILABLE');
          return { saved: false, record: record, reason: reason };
        });
      },

      /** 一覧行・詳細操作・戻るボタンを配線する。 */
      init: function () {
        if (!ready) { return false; }
        el['history-list'].addEventListener('click', function (event) {
          var node = event ? event.target : null;
          while (node && node !== el['history-list'] && !node.hasAttribute('data-id')) {
            node = node.parentNode;
          }
          if (!node || node === el['history-list']) { return; }
          api.selectRecord(node.getAttribute('data-id'));
        });
        el['btn-history-delete'].addEventListener('click', function () {
          if (selectedId !== null) { api.requestDelete(selectedId); }
        });
        el['btn-history-detail-close'].addEventListener('click', function () {
          selectedId = null;
          renderList();
          renderDetail();
        });
        el['btn-history-back'].addEventListener('click', function () {
          api.close();
        });
        return true;
      }
    };

    return api;
  }

  /** epoch ミリ秒を ISO 8601 拡張形式（ローカルオフセット付き）へ（要件 14-1）。 */
  function isoLocalFrom(ms) {
    var date = new Date((typeof ms === 'number' && isFinite(ms)) ? ms : Date.now());
    var offsetMin = -date.getTimezoneOffset();
    var sign = (offsetMin >= 0) ? '+' : '-';
    var abs = Math.abs(offsetMin);
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) +
      'T' + pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds()) +
      sign + pad2(Math.floor(abs / 60)) + ':' + pad2(abs % 60);
  }

  /* ---- 3-4b. Menu_Editor_View … タスク 18.1 / 18.2 / 18.3 ------------------
   * createMenuEditorView({ doc, menus, counts, cursor, panel, storage,
   *                        onMenuStructureChanged, onRequestSwitch, onBack })
   *   open / close / refresh / isReady
   *
   * 責務の分割:
   *   - メニュー集合と種目定義の変更は 3-4 の Menu_Manager が行い、検証は
   *     2-5 の validateMenu に閉じる（本節は UI と確認表示・メッセージのみ）。
   *   - カウント側の追従（purgeDrill / addDrill / reorder）とアクティブ種目の
   *     再決定（reindexAfterMenuChange）は、設計どおり**この UI が順序を決めて**
   *     Count_Manager / Cursor_Manager を呼ぶ（状態層のマネージャは互いを
   *     直接呼ばない）。
   *   - 選択中メニューの切り替えは進行中セッションの終了を伴うため、履歴保存と
   *     新セッション開始は `onRequestSwitch` で呼び出し側（bootstrap）に委ねる。
   * ------------------------------------------------------------------------ */

  var MENU_EDITOR_IDS = deepFreeze([
    'menu-violations', 'menu-list', 'input-menu-name',
    'btn-menu-create', 'btn-menu-duplicate', 'btn-menu-rename',
    'btn-menu-delete', 'btn-menu-switch',
    'drill-editor-list', 'btn-drill-add', 'btn-menu-reset-default',
    'drill-form', 'input-drill-name', 'input-drill-section', 'input-drill-target',
    'btn-drill-save', 'btn-drill-cancel', 'btn-menu-back',
    'tpl-menu-row', 'tpl-drill-editor-row'
  ]);

  function createMenuEditorView(deps) {
    var d = isPlainObject(deps) ? deps : {};
    var doc = d.doc || ((typeof document !== 'undefined') ? document : null);
    var menus = d.menus || null;
    var countManager = d.counts || null;
    var cursorManager = d.cursor || null;
    var panel = d.panel || null;
    var onMenuStructureChanged = (typeof d.onMenuStructureChanged === 'function')
      ? d.onMenuStructureChanged
      : function () {};
    var onRequestSwitch = (typeof d.onRequestSwitch === 'function')
      ? d.onRequestSwitch
      : function () { return Promise.resolve(false); };
    var onBack = (typeof d.onBack === 'function') ? d.onBack : function () {};

    var el = {};
    var missing = [];
    if (doc === null) {
      missing = MENU_EDITOR_IDS.slice();
    } else {
      for (var i = 0; i < MENU_EDITOR_IDS.length; i++) {
        var node = doc.getElementById(MENU_EDITOR_IDS[i]);
        if (node === null) { missing.push(MENU_EDITOR_IDS[i]); } else { el[MENU_EDITOR_IDS[i]] = node; }
      }
    }
    var ready = (missing.length === 0);

    var selectedMenuId = null;
    var editingDrillId = null;

    /** 検証違反を項目単位で提示する（要件 17-7, 18-4）。 */
    function showViolations(violations) {
      if (!ready) { return; }
      var list = isArrayValue(violations) ? violations : [];
      if (list.length === 0) {
        el['menu-violations'].textContent = '';
        el['menu-violations'].removeAttribute('data-kind');
        return;
      }
      var parts = [];
      for (var i = 0; i < list.length && i < 5; i++) {
        var field = (typeof list[i].field === 'string' && list[i].field.length > 0)
          ? (list[i].field + ': ')
          : '';
        parts.push(field + list[i].message);
      }
      el['menu-violations'].setAttribute('data-kind', 'error');
      el['menu-violations'].textContent = parts.join(' / ');
    }

    function clearViolations() {
      showViolations([]);
    }

    function confirmWith(spec) {
      if (panel && typeof panel.showConfirm === 'function') { return panel.showConfirm(spec); }
      return Promise.resolve(false);
    }

    /** メニュー一覧を描画する（要件 18-16）。 */
    function renderMenuList() {
      var list = el['menu-list'];
      list.textContent = '';
      var all = menus.listMenus();
      var activeId = menus.getActiveMenuId();
      if (selectedMenuId === null) { selectedMenuId = activeId; }

      var frag = doc.createDocumentFragment();
      for (var i = 0; i < all.length; i++) {
        var menu = all[i];
        var row = el['tpl-menu-row'].content.firstElementChild.cloneNode(true);
        row.setAttribute('data-id', menu.id);
        // 選択中メニューの行を区別する（要件 18-16。配色は CSS 側）
        row.setAttribute('aria-current', (menu.id === activeId) ? 'true' : 'false');
        row.setAttribute('data-selected', (menu.id === selectedMenuId) ? 'true' : 'false');
        row.querySelector('.menu-row-name').textContent = menu.name;
        row.querySelector('.menu-row-meta').textContent =
          menuDrillsOf(menu).length + ' 種目 · 目標 ' + deriveTargetTotal(menu);
        frag.appendChild(row);
      }
      list.appendChild(frag);
    }

    /** 種目編集の一覧を描画する（要件 17-1, 17-6）。 */
    function renderDrillEditor() {
      var list = el['drill-editor-list'];
      list.textContent = '';
      var menu = menus.getActiveMenu();
      var drills = menuDrillsOf(menu);
      var counts = (countManager !== null) ? countManager.getCounts() : {};

      var frag = doc.createDocumentFragment();
      var lastSection = null;
      for (var i = 0; i < drills.length; i++) {
        var drill = drills[i];
        var section = sectionKeyOf(drill);
        var row = el['tpl-drill-editor-row'].content.firstElementChild.cloneNode(true);
        row.setAttribute('data-id', String(drill.id));
        row.setAttribute('data-index', String(i));
        // 同一 section を 1 セクションとして集約表示する（要件 17-6）
        row.setAttribute('data-section', section);
        row.setAttribute('data-section-head', (section !== lastSection) ? 'true' : 'false');
        lastSection = section;

        var made = (counts[drill.id] !== undefined) ? counts[drill.id].make : 0;
        var label = (section.length > 0 ? '[' + section + '] ' : '') +
          drill.name + ' … 目標 ' + drill.targetMake;
        if (made > 0) { label += '（現在 ' + made + '）'; }
        row.querySelector('.drill-editor-label').textContent = label;
        frag.appendChild(row);
      }
      list.appendChild(frag);
    }

    function render() {
      if (!ready) { return; }
      renderMenuList();
      renderDrillEditor();
    }

    /** 種目数の変化後にアクティブ種目を再決定する（要件 17-14）。 */
    function reindex(prevIndex, prevLength, newLength, removedIndex) {
      if (cursorManager === null) { return; }
      cursorManager.updateDrills(menus.getActiveMenu(),
        reindexAfterMenuChange(prevIndex, prevLength, newLength, removedIndex));
    }

    /** 種目定義だけが変わった場合（name / section / targetMake の編集）。 */
    function syncDrillsOnly() {
      if (cursorManager !== null) {
        cursorManager.updateDrills(menus.getActiveMenu(), cursorManager.getIndex());
      }
      onMenuStructureChanged();
    }

    /* ---- メニュー集合の操作（18.3）------------------------------------- */

    function inputName() {
      return el['input-menu-name'].value;
    }

    function handleCreate() {
      clearViolations();
      var result = menus.createMenu(inputName());
      if (!result.ok) { showViolations(result.violations); return; }
      el['input-menu-name'].value = '';
      selectedMenuId = result.menu.id;
      render();
    }

    function handleDuplicate() {
      clearViolations();
      if (selectedMenuId === null) { return; }
      var result = menus.duplicateMenu(selectedMenuId, inputName());
      if (!result.ok) { showViolations(result.violations); return; }
      el['input-menu-name'].value = '';
      selectedMenuId = result.menu.id;
      render();
    }

    function handleRename() {
      clearViolations();
      if (selectedMenuId === null) { return; }
      var result = menus.renameMenu(selectedMenuId, inputName());
      if (!result.ok) { showViolations(result.violations); return; }
      el['input-menu-name'].value = '';
      render();
      onMenuStructureChanged();
    }

    function handleDelete() {
      clearViolations();
      if (selectedMenuId === null) { return; }
      var all = menus.listMenus();
      var target = null;
      for (var i = 0; i < all.length; i++) {
        if (all[i].id === selectedMenuId) { target = all[i]; break; }
      }
      if (target === null) { return; }
      // 最後の 1 件は削除できない（要件 18-7）。確認表示より前に拒否する。
      if (all.length <= LIMITS.MENU_COUNT_MIN) {
        showViolations(menus.deleteMenu(selectedMenuId).violations);
        return;
      }
      return confirmWith({
        title: 'メニューを削除する',
        message: '「' + target.name + '」を削除する。この操作は取り消せない。',
        okLabel: '削除する'
      }).then(function (confirmed) {
        if (!confirmed) { return; }
        var wasActive = (menus.getActiveMenuId() === selectedMenuId);
        var result = menus.deleteMenu(selectedMenuId);
        if (!result.ok) { showViolations(result.violations); return; }
        selectedMenuId = menus.getActiveMenuId();
        render();
        // 選択中メニューが変わった場合は新しいメニューでセッションを作り直す
        if (wasActive) { onRequestSwitch(menus.getActiveMenuId(), { alreadySwitched: true }); }
        onMenuStructureChanged();
      });
    }

    function handleSwitch() {
      clearViolations();
      if (selectedMenuId === null) { return; }
      if (selectedMenuId === menus.getActiveMenuId()) { return; }
      return onRequestSwitch(selectedMenuId, { alreadySwitched: false });
    }

    /* ---- 種目の操作（18.1 / 18.2）-------------------------------------- */

    function openDrillForm(drillId) {
      var drills = menuDrillsOf(menus.getActiveMenu());
      var drill = null;
      for (var i = 0; i < drills.length; i++) {
        if (drills[i].id === drillId) { drill = drills[i]; break; }
      }
      editingDrillId = (drill === null) ? null : drillId;
      el['input-drill-name'].value = (drill === null) ? '' : drill.name;
      el['input-drill-section'].value = (drill === null) ? '' : drill.section;
      el['input-drill-target'].value = (drill === null) ? '' : String(drill.targetMake);
      el['drill-form'].removeAttribute('hidden');
    }

    function closeDrillForm() {
      editingDrillId = null;
      el['drill-form'].setAttribute('hidden', '');
    }

    function handleDrillSave() {
      clearViolations();
      var rawTarget = el['input-drill-target'].value;
      var target = (rawTarget === '') ? NaN : Number(rawTarget);
      var patch = {
        name: el['input-drill-name'].value,
        // section は自由文字列（空欄可。要件 17-5）
        section: el['input-drill-section'].value,
        targetMake: (isFinite(target) && Math.floor(target) === target) ? target : rawTarget
      };

      if (editingDrillId === null) {
        // 追加（要件 17-13）: 高水位を渡して削除済み id を再利用しない
        var reserved = (countManager !== null) ? [countManager.getReservedIdHigh()] : [];
        var prevLength = menuDrillsOf(menus.getActiveMenu()).length;
        var prevIndex = (cursorManager !== null) ? cursorManager.getIndex() : 0;
        var added = menus.addDrill(patch, reserved);
        if (!added.ok) { showViolations(added.violations); return; }
        if (countManager !== null) { countManager.addDrill(added.drill.id); }
        reindex(prevIndex, prevLength, menuDrillsOf(menus.getActiveMenu()).length, null);
        closeDrillForm();
        render();
        onMenuStructureChanged();
        return;
      }

      // 編集（要件 17-8, 17-9, 17-10）: カウント・アクティブ種目・履歴は不変
      var updated = menus.updateDrill(editingDrillId, patch);
      if (!updated.ok) { showViolations(updated.violations); return; }
      closeDrillForm();
      render();
      syncDrillsOnly();
    }

    function handleDrillRemove(drillId) {
      clearViolations();
      var drills = menuDrillsOf(menus.getActiveMenu());
      var target = null;
      for (var i = 0; i < drills.length; i++) {
        if (drills[i].id === drillId) { target = drills[i]; break; }
      }
      if (target === null) { return; }
      if (drills.length <= LIMITS.DRILL_COUNT_MIN) {
        showViolations(menus.removeDrill(drillId).violations);
        return;
      }
      var counts = (countManager !== null) ? countManager.getCounts() : {};
      var current = (counts[drillId] !== undefined) ? counts[drillId] : { make: 0, attempt: 0 };
      // 要件 17-11: 対象種目名とカウント破棄を示す確認表示を経る
      return confirmWith({
        title: '種目を削除する',
        message: '「' + target.name + '」を削除する。この種目の記録（成功 ' +
          current.make + ' / 試投 ' + current.attempt + '）と操作履歴も破棄される。',
        okLabel: '削除する'
      }).then(function (confirmed) {
        if (!confirmed) { return; }
        var prevIndex = (cursorManager !== null) ? cursorManager.getIndex() : 0;
        var prevLength = menuDrillsOf(menus.getActiveMenu()).length;
        var removed = menus.removeDrill(drillId);
        if (!removed.ok) { showViolations(removed.violations); return; }
        // 要件 17-12: カウントと当該種目の操作履歴を破棄する
        if (countManager !== null) { countManager.purgeDrill(drillId); }
        reindex(prevIndex, prevLength, menuDrillsOf(menus.getActiveMenu()).length, removed.index);
        render();
        onMenuStructureChanged();
      });
    }

    function handleDrillMove(drillId, direction) {
      clearViolations();
      var drills = menuDrillsOf(menus.getActiveMenu());
      var at = -1;
      var ids = [];
      for (var i = 0; i < drills.length; i++) {
        ids.push(drills[i].id);
        if (drills[i].id === drillId) { at = i; }
      }
      if (at === -1) { return; }
      var to = at + direction;
      if (to < 0 || to >= ids.length) { return; }
      var swap = ids[at];
      ids[at] = ids[to];
      ids[to] = swap;

      var activeId = null;
      if (cursorManager !== null) {
        var activeDrill = cursorManager.getActiveDrill();
        activeId = (activeDrill && typeof activeDrill === 'object') ? activeDrill.id : null;
      }

      var result = menus.reorderDrills(ids);
      if (!result.ok) { showViolations(result.violations); return; }
      // 要件 17-3: counts の配列順を新しい種目順へ揃える（値は不変）
      if (countManager !== null) { countManager.reorder(ids); }
      // アクティブ種目は「同じ種目」を維持する（並べ替えは種目を消さない）
      if (cursorManager !== null) {
        var nextIndex = 0;
        for (var k = 0; k < ids.length; k++) {
          if (ids[k] === activeId) { nextIndex = k; break; }
        }
        cursorManager.updateDrills(menus.getActiveMenu(), nextIndex);
      }
      render();
      onMenuStructureChanged();
    }

    function handleResetDefault() {
      clearViolations();
      // 要件 17-15: 既定メニューの内容へ戻すことを示す確認表示を経る
      return confirmWith({
        title: 'メニューをリセットする',
        message: '選択中メニューの種目配列を既定メニュー（' + DRILL_MENU.length +
          ' 種目 / 目標 ' + deriveTargetTotal({ drills: DRILL_MENU }) + '）と同一の内容に戻す。',
        okLabel: 'リセットする'
      }).then(function (confirmed) {
        if (!confirmed) { return; }
        var prevIndex = (cursorManager !== null) ? cursorManager.getIndex() : 0;
        var prevLength = menuDrillsOf(menus.getActiveMenu()).length;
        var result = menus.resetActiveMenuToDefault();
        if (!result.ok) { showViolations(result.violations); return; }
        var menu = menus.getActiveMenu();
        // 種目集合が入れ替わるので、カウントはメニューを正として整合させる
        if (countManager !== null) { countManager.reconcile(menu); }
        reindex(prevIndex, prevLength, menuDrillsOf(menu).length, null);
        render();
        onMenuStructureChanged();
      });
    }

    var api = {
      isReady: function () {
        return ready;
      },

      missingElements: function () {
        return missing.slice();
      },

      open: function () {
        if (!ready) { return false; }
        clearViolations();
        closeDrillForm();
        selectedMenuId = menus.getActiveMenuId();
        render();
        if (panel && typeof panel.showPanel === 'function') { panel.showPanel('menu'); }
        return true;
      },

      close: function () {
        if (!ready) { return false; }
        closeDrillForm();
        onBack();
        return true;
      },

      refresh: render,

      getSelectedMenuId: function () {
        return selectedMenuId;
      },

      selectMenu: function (id) {
        selectedMenuId = id;
        render();
      },

      init: function () {
        if (!ready) { return false; }

        el['menu-list'].addEventListener('click', function (event) {
          var node = event ? event.target : null;
          while (node && node !== el['menu-list'] && !node.hasAttribute('data-id')) {
            node = node.parentNode;
          }
          if (!node || node === el['menu-list']) { return; }
          api.selectMenu(node.getAttribute('data-id'));
        });

        el['btn-menu-create'].addEventListener('click', handleCreate);
        el['btn-menu-duplicate'].addEventListener('click', handleDuplicate);
        el['btn-menu-rename'].addEventListener('click', handleRename);
        el['btn-menu-delete'].addEventListener('click', handleDelete);
        el['btn-menu-switch'].addEventListener('click', handleSwitch);

        el['drill-editor-list'].addEventListener('click', function (event) {
          var node = event ? event.target : null;
          var action = null;
          while (node && node !== el['drill-editor-list']) {
            if (node.hasAttribute && node.hasAttribute('data-action')) {
              action = node.getAttribute('data-action');
            }
            if (node.hasAttribute && node.hasAttribute('data-id') && action !== null) { break; }
            node = node.parentNode;
          }
          if (!node || node === el['drill-editor-list'] || action === null) { return; }
          var drillId = toIntegerOrNull(Number(node.getAttribute('data-id')));
          if (drillId === null) { return; }
          if (action === 'edit') { openDrillForm(drillId); return; }
          if (action === 'remove') { handleDrillRemove(drillId); return; }
          if (action === 'up') { handleDrillMove(drillId, -1); return; }
          if (action === 'down') { handleDrillMove(drillId, 1); }
        });

        el['btn-drill-add'].addEventListener('click', function () {
          clearViolations();
          openDrillForm(null);
        });
        el['btn-drill-save'].addEventListener('click', handleDrillSave);
        el['btn-drill-cancel'].addEventListener('click', function () {
          clearViolations();
          closeDrillForm();
        });
        el['btn-menu-reset-default'].addEventListener('click', handleResetDefault);
        el['btn-menu-back'].addEventListener('click', function () { api.close(); });
        return true;
      },

      /** テストから直接操作するための入口（DOM を介さない検証に使う）。 */
      __test: {
        handleDrillSave: handleDrillSave,
        handleDrillRemove: handleDrillRemove,
        handleDrillMove: handleDrillMove,
        handleResetDefault: handleResetDefault,
        openDrillForm: openDrillForm
      }
    };

    return api;
  }

  /* ---- 3-12. PWA_Shell … タスク 20.4（manifest/sw は別ファイル）----------
   * registerServiceWorker({ window, navigator, onMessage })
   *   -> Promise<'registered' | 'unsupported' | 'file-scheme' | 'failed'>
   *   非対応・file://・登録失敗ではメッセージを提示して動作を継続する
   *   （要件 15-3, 15-10）。スコープは同一オリジンのアプリ配置場所に限定する。
   *   起動時・練習中に自オリジン以外へのネットワーク要求を発行しない
   *   （要件 16-5, 16-6。外部オリジンへの fetch はこのファイル全体に存在しない）。
   * ------------------------------------------------------------------------ */

  function registerServiceWorker(deps) {
    var d = isPlainObject(deps) ? deps : {};
    var host = d.window || ((typeof window !== 'undefined') ? window : null);
    var nav = d.navigator || (host ? host.navigator : null);
    var onMessage = (typeof d.onMessage === 'function') ? d.onMessage : function () {};

    var protocol = (host && host.location && typeof host.location.protocol === 'string')
      ? host.location.protocol
      : '';

    // 要件 15-10: file:// では Service Worker を使わずに動作を継続する
    if (protocol === 'file:') {
      onMessage('info',
        'file:// で開いているためオフライン利用の準備はできない。計測機能はそのまま使える。',
        0, 'SW_FILE_SCHEME');
      return Promise.resolve('file-scheme');
    }

    if (!nav || !nav.serviceWorker || typeof nav.serviceWorker.register !== 'function') {
      onMessage('info',
        'この環境はオフライン利用に対応していない。計測機能はそのまま使える。',
        0, 'SW_UNSUPPORTED');
      return Promise.resolve('unsupported');
    }

    /*
     * スコープはアプリ配置場所（index.html のあるディレクトリ）に限定する。
     * 相対パスで登録するため、同一オリジン外は対象にならない（要件 15-3）。
     */
    var scope = './';
    return Promise.resolve().then(function () {
      return nav.serviceWorker.register('./sw.js', { scope: scope });
    }).then(function () {
      return 'registered';
    }, function () {
      onMessage('info',
        'オフライン利用の準備ができなかった。計測機能はそのまま使える。',
        0, 'SW_FAILED');
      return 'failed';
    });
  }


  /* ==========================================================================
   * 4. テスト公開フック
   * --------------------------------------------------------------------------
   * `window.__VSC_TEST__` はグローバル汚染の唯一の例外であり、純粋関数の参照と
   * 読み取り専用定数のみを載せる。ファクトリ関数・DOM 参照・localStorage
   * ラッパは決して公開しない。
   *
   * 公開内容は「2 節の関数が実装され次第この場所に追記する」運用とし、
   * タスク 21.1 が最終的な一覧を確定させる（そうしないとチェックポイント 9 の
   * 「tests.html から実行して全件通過」が 21.1 まで成立しない）。
   *
   * 設計の公開一覧に対する追加分（いずれも 2 節の純粋関数・読み取り専用定数
   * であり、公開方針に反しない）:
   *   reorderDrills / removeDrill / addDrill / purgeDrillCounts /
   *   addDrillCounts / reorderCounts  … Property 11 の検証対象
   *   createDefaultMenu / DRILL_MENU / THEME / SCHEMA_VERSION / SESSION_FIELDS
   *                                   … 単体テスト（2.2 / 7.9）の検証対象
   *
   * 未実装のため未公開:
   *   （なし。2 節の純粋関数はすべて公開済み）
   * ========================================================================== */

  var testHook = {
    // 2-1. テキスト正規化とコマンド判定
    normalizeText: normalizeText,
    buildExclusionMask: buildExclusionMask,
    selectCommand: selectCommand,
    restartDelay: restartDelay,

    // 2-2. カウント遷移と取り消し
    applyCount: applyCount,
    undoCount: undoCount,
    successRate: successRate,
    totals: totals,

    // 2-3. カーソル遷移と種目 id 操作
    cursorReducer: cursorReducer,
    reindexAfterMenuChange: reindexAfterMenuChange,
    reorderDrills: reorderDrills,
    removeDrill: removeDrill,
    addDrill: addDrill,
    purgeDrillCounts: purgeDrillCounts,
    addDrillCounts: addDrillCounts,
    reorderCounts: reorderCounts,
    nextDrillId: nextDrillId,

    // 2-4. セッション直列化
    serializeSession: serializeSession,
    deserializeSession: deserializeSession,

    // 2-5. メニュー直列化と検証
    serializeMenus: serializeMenus,
    deserializeMenus: deserializeMenus,
    validateMenu: validateMenu,
    deriveTargetTotal: deriveTargetTotal,

    // 2-6. 経過時間・表示算出・履歴順序
    elapsedFrom: elapsedFrom,
    formatElapsed: formatElapsed,
    progressRatio: progressRatio,
    aggregateBySection: aggregateBySection,
    formatRate: formatRate,
    sortHistoryIndex: sortHistoryIndex,
    layoutModeFor: layoutModeFor,
    buildHistoryRecord: buildHistoryRecord,
    makeHistoryId: makeHistoryId,
    formatEndedAt: formatEndedAt,
    isoLocalFrom: isoLocalFrom,

    // 読み取り専用定数
    LIMITS: LIMITS,
    COMMAND_TABLE: COMMAND_TABLE,
    EXCLUSION_WORDS: EXCLUSION_WORDS,
    DRILL_MENU: DRILL_MENU,
    THEME: THEME,
    SCHEMA_VERSION: SCHEMA_VERSION,
    SESSION_FIELDS: SESSION_FIELDS,
    createDefaultMenu: createDefaultMenu
  };

  if (typeof window !== 'undefined') {
    window.__VSC_TEST__ = testHook;
  }

  /* --------------------------------------------------------------------------
   * 副作用シェルのファクトリのテスト公開（タスク 10.5 / 11.5 / 11.6 / 14.3 /
   * 15.2 / 17.3 / 18.4 / 19.3 が要求する単体テストの前提）
   *
   * 設計は「状態を保持するファクトリ関数・DOM 参照・localStorage ラッパを
   * `window.__VSC_TEST__` に公開しない」と定めている。一方でタスク 10.5 以降は
   * これらの分岐（他タブ競合・連打破棄・容量超過の退避ループ・自動再開の
   * バックオフなど）の単体テストを要求する。両立させるため、**テストランナー
   * 配下でのみ** `testHook.shell` にファクトリを載せる。
   *
   * 判定には `window.__VSC_LOAD_CONTEXT__` の存在を使う。これは tests.html が
   * 読み込み元を記録するために app.js より前に設定する変数であり、index.html
   * には存在しない。したがって **本番起動（index.html）では `shell` は
   * 一切代入されず**、公開されるのは純粋関数と読み取り専用定数のみになる。
   * `shell` に載せるのも DOM と localStorage に触れないファクトリに限り、
   * Storage_Adapter は偽 storage の注入で検証する（設計の方針どおり）。
   * ------------------------------------------------------------------------ */

  if (typeof window !== 'undefined' && window.__VSC_LOAD_CONTEXT__ !== undefined) {
    testHook.shell = {
      createCountManager: createCountManager,
      createCursorManager: createCursorManager,
      createMenuManager: createMenuManager,
      createCommandDispatcher: createCommandDispatcher,
      createStorageAdapter: createStorageAdapter,
      createPersistenceCoordinator: createPersistenceCoordinator,
      createRenderer: createRenderer,
      createDisplayPanel: createDisplayPanel,
      createSpeechRecognizer: createSpeechRecognizer,
      createWakeLockManager: createWakeLockManager,
      createThemeManager: createThemeManager,
      createSessionTimer: createSessionTimer,
      createHistoryView: createHistoryView,
      createMenuEditorView: createMenuEditorView,
      registerServiceWorker: registerServiceWorker,
      STORAGE_KEYS: STORAGE_KEYS,
      RENDER_REGIONS: RENDER_REGIONS,
      PANEL_IDS: PANEL_IDS
    };
  }

  /* ==========================================================================
   * 5. bootstrap()
   * --------------------------------------------------------------------------
   * 起動順序（タスク 21.1）:
   *   1. テーマ適用（最初の描画より前に適用済みにする。要件 10-8）
   *   2. メニュー集合と選択中メニュー識別子の復元（要件 18-13, 18-14）
   *   3. 進行中セッションの復元と reconcile（要件 12-5, 1-10, 6-10, 6-11）
   *   4. 初回描画
   *   5. Service Worker 登録（要件 15-3）
   *
   * 必須 DOM 要素が見つからない環境（tests.html など）では、テーマ適用だけを
   * 行って早期 return する。これにより app.js をテストランナーから読み込んでも
   * 例外を送出しない。
   * ========================================================================== */

  /** 経過時間表示の更新周期（要件 11-3: 1 秒周期、差を 1 秒以内に維持）。 */
  var TIMER_TICK_MS = 1000;

  function bootstrap() {
    if (typeof document === 'undefined' || !document.getElementById) { return null; }

    var storage = createStorageAdapter({});
    var countManager = createCountManager();
    var cursorManager = createCursorManager();
    var timer = createSessionTimer({});
    var theme = createThemeManager({
      storage: storage,
      onMessage: function (kind, text, holdMs, reasonKey) {
        message(kind, text, holdMs, reasonKey);
      }
    });

    /* --- 1. テーマ適用（最初の描画より前）--- */
    var themeReady = theme.init();

    var panel = null;
    var historyView = null;
    var menuEditor = null;
    var speech = null;
    var wakeLock = null;
    var persistence = null;
    var dispatcher = null;
    var menuManager = null;
    var tickHandle = null;
    var speechEnabled = false;
    var speechStatus = 'stopped';
    var wakeLockHeld = false;

    function message(kind, text, holdMs, reasonKey) {
      if (panel !== null) { panel.showMessage(kind, text, holdMs, reasonKey); }
    }

    /* --- メニュー集合の永続化（Menu_Manager の persist）--- */
    function persistMenus(menus, activeMenuId) {
      storage.saveMenus(menus).then(function () {}, function (reason) {
        // 要件 17-18: 保存失敗でもメモリ内内容を正として操作を継続する
        message('error',
          (reason && reason.message) ? reason.message : 'メニューを保存できなかった。',
          0, (reason && reason.code) ? reason.code : 'UNAVAILABLE');
      });
      storage.saveActiveMenuId(activeMenuId).then(function () {}, function () {});
    }

    menuManager = createMenuManager({ persist: persistMenus });

    /* --- 表示状態の射影（レンダラは状態を書き換えない）--- */
    function getViewState() {
      var menu = menuManager.getActiveMenu();
      var agg = countManager.getTotals();
      return {
        menu: menu,
        counts: countManager.getCountsList(),
        activeIndex: cursorManager.getIndex(),
        activeDrill: cursorManager.getActiveDrill(),
        totalMake: agg.make,
        totalAttempt: agg.attempt,
        targetTotal: deriveTargetTotal(menu),
        elapsedSec: timer.elapsedSec(Date.now()),
        paused: timer.isPaused(),
        powerSave: theme.isPowerSave(),
        speechEnabled: speechEnabled,
        speechSupported: (speech === null) ? false : speech.isSupported(),
        speechStatus: speechStatus,
        wakeLockHeld: wakeLockHeld
      };
    }

    /* --- 2 / 3 の後に使う共通処理 --- */

    function markStateDirty() {
      panel.markDirty('active');
      panel.markDirty('progress');
      panel.markDirty('list');
      panel.markDirty('status');
    }

    function scheduleSave() {
      if (persistence !== null) { persistence.scheduleSave(); }
    }

    function currentSessionState() {
      var snapshot = timer.snapshot();
      return {
        schemaVersion: SCHEMA_VERSION,
        startedAt: snapshot.startedAt,
        elapsedSec: snapshot.elapsedSec,
        menuId: menuManager.getActiveMenuId(),
        activeIndex: cursorManager.getIndex(),
        counts: countManager.getCountsList(),
        operations: countManager.getHistory(),
        ended: snapshot.frozen
      };
    }

    /** 目標合計への到達（要件 11-6）。達成時間を確定する。 */
    function handleGoalReached(made, target) {
      var completed = timer.freeze(Date.now());
      panel.markDirty('timer');
      message('info',
        '目標 ' + target + ' 本に到達した（' + formatElapsed(completed) + '）。',
        5000, 'GOAL_REACHED');
    }

    /** 新しいセッションを開始する（メニュー切替・リセット後）。 */
    function startNewSession(menu) {
      countManager.initFromMenu(menu);
      cursorManager.setMenu(menu);
      timer.reset();
      panel.resetAchievementTracking();
      if (dispatcher !== null) { dispatcher.resetGoalNotice(); }
      if (wakeLock !== null) { wakeLock.setSessionActive(false); }
      panel.markAllDirty();
      scheduleSave();
    }

    /**
     * 進行中セッションを終了する（要件 11-7, 14-1, 14-9, 12-10）。
     * 全体試投数が 1 以上なら履歴を保存する。
     */
    function endSession() {
      var completionSec = timer.freeze(Date.now());
      var menu = menuManager.getActiveMenu();
      var counts = countManager.getCountsList();
      panel.markDirty('timer');
      if (wakeLock !== null) {
        wakeLock.setSessionActive(false);
        wakeLock.release();
      }
      if (historyView === null) { return Promise.resolve({ saved: false }); }
      return historyView.saveSession({
        menu: menu,
        counts: counts,
        completionSec: completionSec,
        endedAt: isoLocalFrom(Date.now())
      }).then(function (result) {
        if (result.saved) {
          message('info', '練習を終了し、履歴に保存した。', 5000, 'SESSION_SAVED');
        }
        return result;
      });
    }

    /**
     * 選択中メニューの切り替え（要件 18-9, 18-10, 18-11, 18-12）。
     * 進行中セッションがあれば確認表示を経て、全体試投数 1 以上なら履歴を
     * 保存してから新セッションを開始する。
     */
    function requestSwitchMenu(menuId, options) {
      var opts = isPlainObject(options) ? options : {};
      var inProgress = timer.isStarted() && !timer.isFrozen();
      var hasAttempts = countManager.getTotals().attempt > 0;

      function commit() {
        var switched = opts.alreadySwitched === true
          ? { ok: true, menu: menuManager.getActiveMenu() }
          : menuManager.switchMenu(menuId);
        if (!switched.ok) { return Promise.resolve(false); }
        startNewSession(menuManager.getActiveMenu());
        if (menuEditor !== null) {
          menuEditor.selectMenu(menuManager.getActiveMenuId());
        }
        return Promise.resolve(true);
      }

      if (!inProgress && !hasAttempts) { return commit(); }

      return panel.showConfirm({
        title: 'メニューを切り替える',
        message: hasAttempts
          ? '進行中の練習を終了して履歴に保存し、新しい練習を開始する。'
          : '進行中の練習を終了して新しい練習を開始する。記録がないため履歴は保存しない。',
        okLabel: '切り替える'
      }).then(function (confirmed) {
        if (!confirmed) { return false; }
        // 要件 18-10 / 18-11: 全体試投数 1 以上なら履歴を保存してから切り替える
        if (!hasAttempts) {
          timer.freeze(Date.now());
          return commit();
        }
        return endSession().then(function () { return commit(); });
      });
    }

    /* --- 4. 表示層 --- */

    panel = createDisplayPanel({
      getViewState: getViewState,
      getBudgetMs: function () { return theme.getRenderBudgetMs(); },
      dispatch: function (command, source, at) {
        return dispatcher ? dispatcher.dispatch(command, source, at) : null;
      },
      selectDrillIndex: function (index, source, at) {
        return dispatcher ? dispatcher.selectDrillIndex(index, source, at) : null;
      },
      onResetCounts: function () {
        // 要件 7-10: 全 Make / Attempt を 0、操作履歴 0 件、アクティブ種目を先頭
        var menu = menuManager.getActiveMenu();
        countManager.resetAll(menu);
        cursorManager.setMenu(menu);
        panel.resetAchievementTracking();
        if (dispatcher !== null) { dispatcher.resetGoalNotice(); }
        panel.markAllDirty();
        scheduleSave();
      },
      onToggleVoice: function () {
        if (speech === null) { return; }
        if (speechEnabled) {
          speech.disable();
          speechEnabled = false;
          // 要件 9-2: 音声認識の無効化では Wake Lock を解放しない
        } else {
          speechEnabled = speech.enable();
          // 要件 9-9: 有効化時に未取得なら Wake Lock を要求する
          if (speechEnabled && wakeLock !== null && !wakeLock.isHeld()) {
            wakeLock.request();
          }
        }
        panel.markDirty('status');
      },
      onTogglePowerSave: function () {
        theme.toggle().then(function () {
          panel.markAllDirty();
        });
        panel.markDirty('status');
      },
      onSessionStart: function () {
        timer.start(Date.now());
        panel.resetAchievementTracking();
        if (dispatcher !== null) { dispatcher.resetGoalNotice(); }
        // 要件 9-1: 練習開始で Wake Lock を要求する
        if (wakeLock !== null) {
          wakeLock.setSessionActive(true);
          wakeLock.request();
        }
        panel.markDirty('timer');
        panel.markDirty('status');
        scheduleSave();
      },
      onSessionPause: function () {
        if (timer.isPaused()) { timer.resume(Date.now()); } else { timer.pause(Date.now()); }
        panel.markDirty('timer');
        scheduleSave();
      },
      onSessionEnd: function () {
        endSession();
      },
      onOpenHistory: function () {
        if (historyView !== null) { historyView.open(); }
      },
      onOpenMenu: function () {
        if (menuEditor !== null) { menuEditor.open(); }
      }
    });

    // 必須 DOM が無い環境（tests.html など）はここで止める
    if (!panel.isReady()) { return null; }

    persistence = createPersistenceCoordinator({
      storage: storage,
      getSessionState: currentSessionState,
      showMessage: function (kind, text, holdMs, reasonKey) {
        message(kind, text, holdMs, reasonKey);
      },
      onConflict: function () {
        panel.markDirty('status');
      }
    });

    dispatcher = createCommandDispatcher({
      counts: countManager,
      cursor: cursorManager,
      timer: timer,
      getMenu: function () { return menuManager.getActiveMenu(); },
      showMessage: function (kind, text, holdMs, reasonKey) {
        message(kind, text, holdMs, reasonKey);
      },
      markDirty: function (region) { panel.markDirty(region); },
      scheduleSave: scheduleSave,
      onGoalReached: handleGoalReached,
      isConflicted: function () { return persistence.isConflicted(); }
    });

    wakeLock = createWakeLockManager({
      onStateChange: function (held) {
        wakeLockHeld = held;
        panel.markDirty('status');
      },
      onMessage: function (kind, text, holdMs, reasonKey) {
        message(kind, text, holdMs, reasonKey);
      }
    });
    wakeLock.watch();

    /* --- 音声認識の配線（タスク 14.2）--- */
    speech = createSpeechRecognizer({
      onCommand: function (type, at) {
        dispatcher.dispatch(type, 'voice', at);
      },
      onFeedback: function (payload) {
        if (payload.final !== null && payload.final !== undefined) {
          panel.setSpeechText(payload.final, '');
        } else {
          panel.setSpeechText(undefined, payload.interim);
        }
      },
      onStatus: function (status) {
        speechStatus = status;
        panel.markDirty('status');
      },
      onFatal: function (info) {
        speechEnabled = false;
        speechStatus = 'stopped';
        message('warn', info.message, 0, info.reasonKey);
        panel.markDirty('status');
      }
    });

    historyView = createHistoryView({
      storage: storage,
      panel: panel,
      onBack: function () { panel.showPanel('main'); }
    });

    menuEditor = createMenuEditorView({
      menus: menuManager,
      counts: countManager,
      cursor: cursorManager,
      panel: panel,
      onMenuStructureChanged: function () {
        panel.markAllDirty();
        scheduleSave();
      },
      onRequestSwitch: requestSwitchMenu,
      onBack: function () { panel.showPanel('main'); }
    });

    panel.init();
    if (historyView.isReady()) { historyView.init(); }
    if (menuEditor.isReady()) { menuEditor.init(); }

    /* --- 経過時間の 1 秒周期更新（要件 11-3）--- */
    function startTick() {
      if (tickHandle !== null) { return; }
      tickHandle = setInterval(function () {
        panel.markDirty('timer');
      }, TIMER_TICK_MS);
    }
    startTick();

    /* --- 他タブ監視（要件 12-11）--- */
    persistence.watchOtherTabs();

    /* --- 非可視復帰時の表示更新（要件 11-8）--- */
    if (typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'hidden') {
          panel.markDirty('timer');
          panel.markDirty('status');
        }
      });
    }

    /* --- 2 → 3 → 4 → 5 の順に復元して描画する --- */
    var startup = themeReady.then(function () {
      panel.markDirty('status');
      return Promise.all([
        storage.listMenus().then(function (result) { return result; }, function () {
          return { menus: null, issues: [] };
        }),
        storage.loadActiveMenuId().then(function (id) { return id; }, function () { return null; })
      ]);
    }).then(function (loaded) {
      var restoredMenus = (loaded[0] && loaded[0].menus) ? loaded[0].menus : null;
      var restoredActiveId = loaded[1];
      var init = menuManager.init(restoredMenus, restoredActiveId);

      // 要件 18-14: 識別子が一致しない場合はメッセージを出し、決定した識別子を保存
      for (var i = 0; i < init.issues.length; i++) {
        message('warn', init.issues[i].message, 5000, init.issues[i].code);
      }
      if (restoredMenus === null || restoredActiveId !== menuManager.getActiveMenuId()) {
        storage.saveActiveMenuId(menuManager.getActiveMenuId()).then(function () {}, function () {});
      }
      if (restoredMenus === null) {
        storage.saveMenus(menuManager.listMenus()).then(function () {}, function () {});
      }

      var menu = menuManager.getActiveMenu();
      countManager.initFromMenu(menu);
      cursorManager.setMenu(menu);

      // 3. 進行中セッションの復元と reconcile
      return persistence.restoreSession({
        menu: menu,
        counts: countManager,
        cursor: cursorManager,
        timer: timer
      });
    }).then(function (restored) {
      var menu = menuManager.getActiveMenu();
      if (restored.resumed) {
        var reconciled = countManager.reconcile(menu);
        cursorManager.updateDrills(menu, cursorManager.getIndex());
        var issues = restored.issues.concat(reconciled.issues);
        for (var i = 0; i < issues.length; i++) {
          message('warn', issues[i].message, 5000, issues[i].code);
        }
        // 要件 12-5: 前回の練習を再開したことを示す表示
        message('info', '前回の練習を再開した。', 5000, 'SESSION_RESUMED');
        if (timer.isStarted() && !timer.isFrozen()) { wakeLock.setSessionActive(true); }
      }
      // 4. 初回描画
      panel.renderAll();
      // 5. Service Worker 登録
      return registerServiceWorker({
        onMessage: function (kind, text, holdMs, reasonKey) {
          message(kind, text, holdMs, reasonKey);
        }
      });
    }).then(function (swState) {
      return swState;
    }, function (error) {
      // 起動経路の予期しない失敗でも計測機能は動作可能に保つ
      panel.renderAll();
      message('warn', '起動時の復元に失敗した。記録は画面上で続けられる。', 0, 'BOOTSTRAP_FAILED');
      return 'failed';
    });

    return {
      startup: startup,
      panel: panel,
      historyView: historyView,
      menuEditor: menuEditor
    };
  }

  var bootstrapResult = null;
  try {
    bootstrapResult = bootstrap();
  } catch (e) {
    /*
     * 起動時の例外でアプリ全体が読み込めなくなることを避ける。
     * ここに到達した場合はブラウザのコンソールに出すだけで、
     * テストランナー（DOM を持たない）からの読み込みも中断しない。
     */
    if (typeof console !== 'undefined' && console && typeof console.error === 'function') {
      console.error('bootstrap failed', e);
    }
  }

  if (typeof window !== 'undefined' && window.__VSC_LOAD_CONTEXT__ !== undefined) {
    testHook.shell.bootstrapResult = bootstrapResult;
  }
})();
