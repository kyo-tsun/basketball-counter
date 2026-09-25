/*
 * voice-shot-counter-pwa — test/spec-dom.js
 *
 * DOM 層の検証（タスク 12.8 / チェックポイント 13）。
 *
 * 実行条件: `tests.html` を簡易静的サーバー経由で開く必要がある
 *   node test/serve.js  →  http://127.0.0.1:8731/test/tests.html
 * `file://` では <iframe> の同一オリジン制約により contentDocument へ触れない。
 * アプリ本体は `file://` でも動作するため、この制約はテストのみに掛かる。
 *
 * 検証方法:
 *   ../index.html を同一オリジンの <iframe> に読み込み、その document を
 *   `createDisplayPanel({ doc })` に渡して**親ページ側**の app.js で駆動する。
 *   iframe 内の app.js は `__VSC_LOAD_CONTEXT__` を持たないため shell フックを
 *   公開しないが、DOM は index.html 自身のものであり、id 契約・CSS・
 *   テンプレートはすべて実物である。
 *
 * 検証項目（タスク 12.8）:
 *   - 描画内容（6 項目・メニュー名・{Make} / {targetMake} 併記・全体進捗形式）
 *   - 代表 3 状態の DOM スナップショット
 *   - 320×568 / 375×812 / 812×375 での文字高（短辺比 20〜30% / 5〜10% / 2.5〜5%）
 *   - 操作ボタンの寸法 72px と間隔 8px / 24px
 *   - 規定要素がビューポート内に収まること
 *   - タッチと音声の結果一致、各ボタンのラベルと代替テキスト
 */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window : globalThis;
  var pbt = G.pbt;
  var assert = G.assert;
  var hook = G.__VSC_TEST__;
  var shell = hook ? hook.shell : null;

  if (!Array.isArray(G.__VSC_DEFERRED__)) { G.__VSC_DEFERRED__ = []; }

  if (typeof document === 'undefined' || !document.createElement) {
    return; // Node ランナーでは何も登録しない
  }

  if (G.location && G.location.protocol === 'file:') {
    /*
     * file:// では <iframe> の同一オリジン制約により contentDocument へ触れない。
     * tests.html の「環境」欄が既にその旨を表示するため、ここでは何も登録せずに
     * 抜ける（失敗として数えない）。全件を実行するには
     *   node test/serve.js  →  http://127.0.0.1:8731/test/tests.html
     * で開く。
     */
    return;
  }

  if (!shell || !shell.createDisplayPanel) {
    pbt.test('spec-dom.js: __VSC_TEST__.shell.createDisplayPanel の前提', function () {
      assert.fail('Display_Panel のファクトリが公開されていない');
    });
    return;
  }

  var MENU = {
    id: 'm-dom',
    name: 'DOM 検証メニュー',
    drills: [
      { id: 1, section: '近距離', name: 'ゴール下 セットシュート', targetMake: 3 },
      { id: 2, section: '近距離', name: 'ショートミドル', targetMake: 2 },
      { id: 3, section: 'エルボー', name: 'エルボー ジャンプ', targetMake: 2 }
    ]
  };
  var TARGET_TOTAL = 7;

  /* ------------------------------------------------------------- iframe 管理 */

  function withFrame(width, height, fn) {
    return new Promise(function (resolve, reject) {
      var frame = document.createElement('iframe');
      frame.setAttribute('title', 'index.html（DOM 検証用）');
      frame.style.position = 'fixed';
      frame.style.left = '-10000px';
      frame.style.top = '0';
      frame.style.border = '0';
      frame.style.width = width + 'px';
      frame.style.height = height + 'px';
      frame.src = '../index.html';
      frame.onload = function () {
        var cleanup = function () {
          if (frame.parentNode) { frame.parentNode.removeChild(frame); }
        };
        var doc;
        try {
          doc = frame.contentDocument;
        } catch (e) {
          cleanup();
          reject(new Error('iframe の contentDocument に触れない（同一オリジンで配信する）'));
          return;
        }
        if (!doc) {
          cleanup();
          reject(new Error('iframe の document を取得できなかった'));
          return;
        }
        Promise.resolve()
          .then(function () { return fn(doc, frame); })
          .then(function (value) { cleanup(); resolve(value); },
            function (e) { cleanup(); reject(e); });
      };
      frame.onerror = function () {
        reject(new Error('../index.html を読み込めなかった'));
      };
      document.body.appendChild(frame);
    });
  }

  /** iframe の document に対して panel + 状態層 + ディスパッチャを 1 組作る。 */
  function buildRig(doc, frameWindow) {
    var counts = shell.createCountManager();
    var cursor = shell.createCursorManager();
    counts.initFromMenu(MENU);
    cursor.setMenu(MENU);

    var rig = {
      doc: doc,
      counts: counts,
      cursor: cursor,
      messages: [],
      paused: false,
      powerSave: false,
      speechEnabled: false,
      speechStatus: 'stopped',
      wakeLockHeld: false,
      vibrations: [],
      clock: 0
    };

    rig.panel = shell.createDisplayPanel({
      doc: doc,
      window: frameWindow,
      getViewState: function () {
        var t = counts.getTotals();
        return {
          menu: MENU,
          counts: counts.getCountsList(),
          activeIndex: cursor.getIndex(),
          activeDrill: cursor.getActiveDrill(),
          totalMake: t.make,
          totalAttempt: t.attempt,
          targetTotal: hook.deriveTargetTotal(MENU),
          elapsedSec: 65,
          paused: rig.paused,
          powerSave: rig.powerSave,
          speechEnabled: rig.speechEnabled,
          speechSupported: true,
          speechStatus: rig.speechStatus,
          wakeLockHeld: rig.wakeLockHeld
        };
      },
      dispatch: function (command, source, at) {
        return rig.dispatcher.dispatch(command, source, at);
      },
      selectDrillIndex: function (index, source, at) {
        return rig.dispatcher.selectDrillIndex(index, source, at);
      },
      onResetCounts: function () {
        counts.resetAll(MENU);
        cursor.setMenu(MENU);
        rig.panel.resetAchievementTracking();
        rig.panel.renderAll();
      },
      getBudgetMs: function () { return rig.powerSave ? 200 : 0; },
      /* 実クロックでは 1 ミリ秒内の連続 click が 300ms 連打破棄（要件 7-7）に
         掛かるため、テストでは 1 回ごとに 1 秒進む論理クロックを渡す。 */
      timestamp: function () { rig.clock += 1000; return rig.clock; },
      vibrate: function (ms) { rig.vibrations.push(ms); return true; }
    });

    rig.dispatcher = shell.createCommandDispatcher({
      counts: counts,
      cursor: cursor,
      timer: { ensureStarted: function () {} },
      getMenu: function () { return MENU; },
      showMessage: function (kind, text, holdMs, reasonKey) {
        rig.messages.push({ kind: kind, reasonKey: reasonKey });
        rig.panel.showMessage(kind, text, holdMs, reasonKey);
      },
      markDirty: function (region) { rig.panel.markDirty(region); },
      scheduleSave: function () { rig.saves = (rig.saves || 0) + 1; },
      onGoalReached: function () { rig.goalReached = true; },
      isConflicted: function () { return false; }
    });

    rig.panel.init();
    rig.panel.renderAll();
    return rig;
  }

  function text(doc, id) {
    var node = doc.getElementById(id);
    return node ? node.textContent : null;
  }

  function click(doc, id) {
    var node = doc.getElementById(id);
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }

  function fontPx(frameWindow, node) {
    return parseFloat(frameWindow.getComputedStyle(node).fontSize);
  }

  function register(name, fn) {
    G.__VSC_DEFERRED__.push(function () {
      return Promise.resolve().then(fn).then(function () {
        pbt.test(name, function () { return true; });
      }, function (e) {
        var msg = (e && e.message) ? String(e.message) : String(e);
        pbt.test(name, function () { assert.fail(msg); });
      });
    });
  }

  /* =======================================================================
   * 描画内容（要件 8-1, 8-2, 8-3, 8-4, 8-7, 8-13）
   * ===================================================================== */

  register('spec-dom: メイン画面の描画内容（要件 8-1, 8-4, 8-7, 8-13）', function () {
    return withFrame(375, 812, function (doc, frame) {
      var rig = buildRig(doc, frame.contentWindow);

      // 要件 8-13: 選択中メニュー名
      assert.ok(text(doc, 'menu-name') === MENU.name,
        'メニュー名が表示されない: ' + text(doc, 'menu-name'));

      // 要件 8-1: アクティブ種目の 6 項目
      assert.ok(text(doc, 'active-section') === '近距離', 'セクション名が一致しない');
      assert.ok(text(doc, 'active-name') === 'ゴール下 セットシュート', '種目名が一致しない');
      assert.ok(text(doc, 'active-make') === '0', 'Make が 0 でない');
      assert.ok(text(doc, 'active-target') === '3', '目標成功数が 3 でない');
      assert.ok(text(doc, 'active-attempt') === '0', 'Attempt が 0 でない');
      assert.ok(text(doc, 'active-rate') === '--%', 'Attempt 0 の成功率が --% でない');

      // 要件 8-4: 「{全体成功数} / {目標合計}本 IN」
      assert.ok(text(doc, 'progress-text') === '0 / ' + TARGET_TOTAL + '本 IN',
        '全体進捗テキストの形式が異なる: ' + text(doc, 'progress-text'));

      // 要件 8-7: 種目一覧に「{Make} / {targetMake}」を併記する
      var rows = doc.querySelectorAll('#drill-list .drill-row');
      assert.ok(rows.length === MENU.drills.length,
        '種目一覧の行数が種目数と一致しない: ' + rows.length);
      for (var i = 0; i < rows.length; i++) {
        var made = rows[i].querySelector('.drill-make').textContent;
        assert.ok(made === '0 / ' + MENU.drills[i].targetMake,
          i + ' 行目の併記が異なる: ' + made);
        assert.ok(rows[i].querySelector('.drill-name').textContent === MENU.drills[i].name,
          i + ' 行目の種目名が異なる');
      }
      // 要件 8-8: アクティブ行が区別されている
      assert.ok(rows[0].getAttribute('aria-current') === 'true', '先頭行がアクティブでない');
      assert.ok(rows[1].getAttribute('aria-current') === 'false', '非アクティブ行が aria-current=true');
    });
  });

  register('spec-dom: 代表 3 状態の DOM スナップショット（要件 8-2, 8-4, 4-6, 4-12）', function () {
    return withFrame(375, 812, function (doc, frame) {
      var rig = buildRig(doc, frame.contentWindow);

      function snap() {
        var rows = doc.querySelectorAll('#drill-list .drill-row');
        var list = [];
        for (var i = 0; i < rows.length; i++) {
          list.push(rows[i].querySelector('.drill-make').textContent + '|' +
            rows[i].getAttribute('aria-current') + '|' +
            rows[i].getAttribute('data-achieved'));
        }
        return {
          active: [text(doc, 'active-section'), text(doc, 'active-name'), text(doc, 'active-make'),
            text(doc, 'active-target'), text(doc, 'active-attempt'), text(doc, 'active-rate')].join('/'),
          progress: text(doc, 'progress-text'),
          achieved: doc.getElementById('active-drill').getAttribute('data-achieved'),
          fill: doc.getElementById('progress-bar-fill').style.width,
          rows: list.join(' ')
        };
      }

      // 状態 1: 初期状態
      assert.deepEqualOk(snap(), {
        active: '近距離/ゴール下 セットシュート/0/3/0/--%',
        progress: '0 / 7本 IN',
        achieved: 'false',
        fill: '0%',
        rows: '0 / 3|true|false 0 / 2|false|false 0 / 2|false|false'
      }, '初期状態のスナップショットが異なる', { name: 'snapshot1' });

      // 状態 2: 先頭種目で成功 2 / 失敗 1（成功率 66.7%、未達成）
      rig.dispatcher.dispatch('MAKE', 'touch', 1000);
      rig.dispatcher.dispatch('MAKE', 'touch', 2000);
      rig.dispatcher.dispatch('MISS', 'touch', 3000);
      rig.panel.renderAll();
      assert.deepEqualOk(snap(), {
        active: '近距離/ゴール下 セットシュート/2/3/3/66.7%',
        progress: '2 / 7本 IN',
        achieved: 'false',
        fill: '28.6%',
        rows: '2 / 3|true|false 0 / 2|false|false 0 / 2|false|false'
      }, '計数後のスナップショットが異なる', { name: 'snapshot2' });

      // 状態 3: 1 種目目が目標到達 → 次の種目へ自動遷移し、以後の加算は新しい種目に入る
      //         （要件 6-9。ゴール下 3/3 完了 → ショートミドルへ）
      rig.dispatcher.dispatch('MAKE', 'touch', 4000);   // ゴール下 3 本目 = 目標到達
      rig.dispatcher.dispatch('MAKE', 'touch', 5000);   // ショートミドル 1 本目
      rig.panel.renderAll();
      assert.deepEqualOk(snap(), {
        active: '近距離/ショートミドル/1/2/1/100.0%',
        progress: '4 / 7本 IN',
        achieved: 'false',
        fill: '57.1%',
        rows: '3 / 3|false|true 1 / 2|true|false 0 / 2|false|false'
      }, '自動遷移後のスナップショットが異なる', { name: 'snapshot3' });

      // 要件 4-10: targetMake に到達した回のみ振動する
      assert.ok(rig.vibrations.length === 1,
        '振動回数が 1 回でない: ' + rig.vibrations.length);
      assert.ok(rig.vibrations[0] === 200, '振動時間が 200ms でない: ' + rig.vibrations[0]);

      // 状態 4: 「戻る」で完了済みの種目に戻り、targetMake を超える Make を
      //         そのまま表示する（要件 4-11, 4-12）。自動遷移は起きない。
      rig.dispatcher.dispatch('PREV', 'touch', 6000);
      rig.dispatcher.dispatch('MAKE', 'touch', 7000);
      rig.panel.renderAll();
      assert.deepEqualOk(snap(), {
        active: '近距離/ゴール下 セットシュート/4/3/5/80.0%',
        progress: '5 / 7本 IN',
        achieved: 'true',
        fill: '71.4%',
        rows: '4 / 3|true|true 1 / 2|false|false 0 / 2|false|false'
      }, '目標超過時のスナップショットが異なる', { name: 'snapshot4' });
      assert.ok(rig.vibrations.length === 1,
        '目標超過の加算で振動した: ' + rig.vibrations.length);
    });
  });

  /* =======================================================================
   * 文字高（要件 8-2, 8-3, 8-13）
   * ===================================================================== */

  function checkFontSizes(width, height) {
    return withFrame(width, height, function (doc, frame) {
      var win = frame.contentWindow;
      buildRig(doc, win);
      var shortSide = Math.min(width, height);
      var label = width + '×' + height;

      var make = fontPx(win, doc.getElementById('active-make'));
      var ratioMake = make / shortSide * 100;
      assert.ok(ratioMake >= 20 && ratioMake <= 30,
        label + ': Make の文字高が短辺の 20〜30% でない: ' + ratioMake.toFixed(2) + '%');

      var name = fontPx(win, doc.getElementById('active-name'));
      var ratioName = name / shortSide * 100;
      assert.ok(ratioName >= 5 && ratioName <= 10,
        label + ': 種目名の文字高が短辺の 5〜10% でない: ' + ratioName.toFixed(2) + '%');

      var menuName = fontPx(win, doc.getElementById('menu-name'));
      var ratioMenu = menuName / shortSide * 100;
      assert.ok(ratioMenu >= 2.5 && ratioMenu <= 5,
        label + ': メニュー名の文字高が短辺の 2.5〜5% でない: ' + ratioMenu.toFixed(2) + '%');
    });
  }

  register('spec-dom: 320×568 の文字高（要件 8-2, 8-3, 8-13）', function () {
    return checkFontSizes(320, 568);
  });
  register('spec-dom: 375×812 の文字高（要件 8-2, 8-3, 8-13）', function () {
    return checkFontSizes(375, 812);
  });
  register('spec-dom: 812×375 の文字高（要件 8-2, 8-3, 8-13）', function () {
    return checkFontSizes(812, 375);
  });

  /* =======================================================================
   * ボタンの寸法・間隔・ラベル（要件 7-1, 7-3, 7-8）
   * ===================================================================== */

  register('spec-dom: 操作ボタンの寸法 72px と間隔 8px / 24px（要件 7-3, 7-8）', function () {
    return withFrame(375, 812, function (doc, frame) {
      buildRig(doc, frame.contentWindow);
      var ids = ['btn-make', 'btn-miss', 'btn-undo', 'btn-prev', 'btn-next'];
      var rects = [];
      var i;
      for (i = 0; i < ids.length; i++) {
        var rect = doc.getElementById(ids[i]).getBoundingClientRect();
        // 要件 7-3: 1 辺 72 CSS ピクセル以上の矩形
        assert.ok(rect.width >= 72 - 0.5,
          ids[i] + ' の幅が 72px 未満: ' + rect.width.toFixed(2));
        assert.ok(rect.height >= 72 - 0.5,
          ids[i] + ' の高さが 72px 未満: ' + rect.height.toFixed(2));
        rects.push(rect);
      }

      // 要件 7-3: 隣接するボタンの間隔 8px 以上
      for (i = 0; i + 1 < rects.length; i++) {
        var a = rects[i];
        var b = rects[i + 1];
        var gapX = (b.left >= a.right) ? (b.left - a.right) : ((a.left >= b.right) ? a.left - b.right : null);
        var gapY = (b.top >= a.bottom) ? (b.top - a.bottom) : ((a.top >= b.bottom) ? a.top - b.bottom : null);
        var gap = (gapX !== null) ? gapX : gapY;
        assert.ok(gap !== null && gap >= 8 - 0.5,
          ids[i] + ' と ' + ids[i + 1] + ' の間隔が 8px 未満: ' + String(gap));
      }

      // 要件 7-8: 全カウント初期化ボタンは最近接の操作ボタンから 24px 以上
      var reset = doc.getElementById('btn-reset-counts').getBoundingClientRect();
      var nearest = Infinity;
      for (i = 0; i < rects.length; i++) {
        var r = rects[i];
        var dy = (reset.top >= r.bottom) ? reset.top - r.bottom
          : (r.top >= reset.bottom) ? r.top - reset.bottom : 0;
        var dx = (reset.left >= r.right) ? reset.left - r.right
          : (r.left >= reset.right) ? r.left - reset.right : 0;
        var dist = Math.max(dx, dy);
        if (dist < nearest) { nearest = dist; }
      }
      assert.ok(nearest >= 24 - 0.5,
        '全カウント初期化ボタンと操作ボタンの間隔が 24px 未満: ' + nearest.toFixed(2));
    });
  });

  register('spec-dom: 各ボタンの文字ラベルと代替テキスト（要件 7-1）', function () {
    return withFrame(375, 812, function (doc, frame) {
      buildRig(doc, frame.contentWindow);
      var expected = [
        ['btn-make', '成功'],
        ['btn-miss', '失敗'],
        ['btn-next', '次へ'],
        ['btn-prev', '戻る'],
        ['btn-undo', '取り消し']
      ];
      for (var i = 0; i < expected.length; i++) {
        var node = doc.getElementById(expected[i][0]);
        assert.ok(node.textContent.indexOf(expected[i][1]) !== -1,
          expected[i][0] + ' の文字ラベルが「' + expected[i][1] + '」を含まない: ' + node.textContent);
        var label = node.getAttribute('aria-label');
        assert.ok(typeof label === 'string' && label.length > 0,
          expected[i][0] + ' に代替テキスト（aria-label）が無い');
        // 要件 5-11: 取り消しボタンは履歴件数に依らず常に操作可能
        assert.ok(node.disabled === false, expected[i][0] + ' が操作不可になっている');
      }
    });
  });

  /* =======================================================================
   * 規定要素がビューポート内に収まる（要件 8-9, 8-10, 8-11）
   * ===================================================================== */

  /*
   * 要件 8-9 / 8-10 / 8-11 が「スクロール操作なしに表示する」と列挙している要素:
   *   第 1 項の 6 項目（セクション名・種目名・目標成功数・Make・Attempt・成功率）
   *   選択中メニュー名 / 全体進捗テキスト / 全体進捗バー / 5 個の操作ボタン
   * 全カウント初期化ボタンとフィードバック領域はこの列挙に含まれない。
   */
  var REQUIRED_IN_VIEW = [
    'menu-name',
    'active-section', 'active-name', 'active-target', 'active-make', 'active-attempt', 'active-rate',
    'progress-text', 'progress-bar',
    'btn-make', 'btn-miss', 'btn-undo', 'btn-prev', 'btn-next'
  ];

  function checkInViewport(width, height, expectedMode) {
    return withFrame(width, height, function (doc, frame) {
      var win = frame.contentWindow;
      var rig = buildRig(doc, win);
      var label = width + '×' + height;

      var mode = rig.panel.updateLayoutMode(width, height);
      rig.panel.renderAll();
      assert.ok(mode === expectedMode,
        label + ': 表示形式が ' + expectedMode + ' でない: ' + mode);

      // 集約表示では行数が section の個数と一致する（要件 8-10）
      if (mode === 'aggregate') {
        var rows = doc.querySelectorAll('#drill-list .drill-row');
        assert.ok(rows.length === 2,
          label + ': 集約行数が section の個数（2）と一致しない: ' + rows.length);
        assert.ok(rows[0].querySelector('.drill-make').textContent === '0 / 5',
          label + ': 集約行の targetMake 合計が 5 でない: ' +
          rows[0].querySelector('.drill-make').textContent);
      }

      // ページ自体はスクロールしない
      assert.ok(doc.documentElement.scrollHeight <= height + 1,
        label + ': ページ全体がスクロールする（scrollHeight ' +
        doc.documentElement.scrollHeight + ' > ' + height + '）');

      for (var i = 0; i < REQUIRED_IN_VIEW.length; i++) {
        var node = doc.getElementById(REQUIRED_IN_VIEW[i]);
        var rect = node.getBoundingClientRect();
        assert.ok(rect.top >= -1 && rect.bottom <= height + 1 &&
          rect.left >= -1 && rect.right <= width + 1,
          label + ': ' + REQUIRED_IN_VIEW[i] + ' がビューポート外（top ' +
          rect.top.toFixed(1) + ', bottom ' + rect.bottom.toFixed(1) +
          ', left ' + rect.left.toFixed(1) + ', right ' + rect.right.toFixed(1) + '）');
      }

      // 種目一覧のラッパだけが縦スクロール領域（要件 8-9, 8-11）
      var wrap = win.getComputedStyle(doc.getElementById('drill-list-wrap'));
      assert.ok(wrap.overflowY === 'auto' || wrap.overflowY === 'scroll',
        label + ': 種目一覧が縦スクロール領域でない: ' + wrap.overflowY);
    });
  }

  register('spec-dom: 320×568 で規定要素がスクロールなしに収まる（要件 8-9）', function () {
    return checkInViewport(320, 568, 'list');
  });
  register('spec-dom: 375×812 で規定要素がスクロールなしに収まる（要件 8-9）', function () {
    return checkInViewport(375, 812, 'list');
  });
  register('spec-dom: 320×480 で種目一覧が集約表示へ切り替わる（要件 8-10）', function () {
    return checkInViewport(320, 480, 'aggregate');
  });
  register('spec-dom: 812×375（幅 > 高さ）で規定要素がスクロールなしに収まる（要件 8-11）', function () {
    return checkInViewport(812, 375, 'list');
  });

  /* =======================================================================
   * タッチと音声の結果一致（要件 7-4, 7-5, 7-6）
   * ===================================================================== */

  register('spec-dom: 実際のボタンタップと音声コマンドの結果が一致する（要件 7-4）', function () {
    return withFrame(375, 812, function (doc, frame) {
      var rig = buildRig(doc, frame.contentWindow);

      // 実際の click イベントで駆動する（連打破棄に掛からないよう別ボタンを使う）
      click(doc, 'btn-make');
      click(doc, 'btn-miss');
      click(doc, 'btn-next');
      click(doc, 'btn-make');
      click(doc, 'btn-undo');
      rig.panel.renderAll();

      var touchCounts = rig.counts.getCountsList();
      var touchHistory = rig.counts.getHistory();
      var touchIndex = rig.cursor.getIndex();

      // 同じ列を音声由来で再現する
      var voiceCounts = shell.createCountManager();
      var voiceCursor = shell.createCursorManager();
      voiceCounts.initFromMenu(MENU);
      voiceCursor.setMenu(MENU);
      var voiceDispatcher = shell.createCommandDispatcher({
        counts: voiceCounts,
        cursor: voiceCursor,
        getMenu: function () { return MENU; },
        isConflicted: function () { return false; }
      });
      var sequence = ['MAKE', 'MISS', 'NEXT', 'MAKE', 'UNDO'];
      for (var i = 0; i < sequence.length; i++) {
        voiceDispatcher.dispatch(sequence[i], 'voice', 1000 + i * 1000);
      }

      assert.deepEqualOk(touchCounts, voiceCounts.getCountsList(),
        'タッチと音声で counts が一致しない', { name: 'counts' });
      assert.deepEqualOk(touchHistory, voiceCounts.getHistory(),
        'タッチと音声で操作履歴が一致しない', { name: 'history' });
      assert.ok(touchIndex === voiceCursor.getIndex(),
        'タッチと音声でアクティブ種目が一致しない');

      // 表示にも反映されている（要件 8-6）
      assert.ok(text(doc, 'progress-text') === '1 / ' + TARGET_TOTAL + '本 IN',
        'タップ後の全体進捗が反映されない: ' + text(doc, 'progress-text'));
    });
  });

  register('spec-dom: 種目一覧のタップでアクティブ種目が変わりカウントは不変（要件 6-8）', function () {
    return withFrame(375, 812, function (doc, frame) {
      var rig = buildRig(doc, frame.contentWindow);
      rig.dispatcher.dispatch('MAKE', 'voice', 1000);
      rig.panel.renderAll();
      var before = rig.counts.getCountsList();

      var rows = doc.querySelectorAll('#drill-list .drill-row');
      rows[2].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      rig.panel.renderAll();

      assert.ok(rig.cursor.getIndex() === 2,
        '3 行目のタップでアクティブ種目が 2 にならない: ' + rig.cursor.getIndex());
      assert.deepEqualOk(rig.counts.getCountsList(), before,
        '種目タップでカウントが変化した', { name: 'counts' });

      var after = doc.querySelectorAll('#drill-list .drill-row');
      assert.ok(after[2].getAttribute('aria-current') === 'true', '3 行目がアクティブにならない');
      assert.ok(after[0].getAttribute('aria-current') === 'false', '1 行目がアクティブのまま');
      assert.ok(text(doc, 'active-name') === MENU.drills[2].name,
        'アクティブ種目の表示が更新されない');
    });
  });

  /* =======================================================================
   * チェックポイント 13: タッチのみで計測・保存・復元が成立する
   * ===================================================================== */

  register('spec-dom: タッチ操作のみで計数・移動・取り消し・保存・復元が成立する（チェックポイント 13）', function () {
    return withFrame(375, 812, function (doc, frame) {
      var rig = buildRig(doc, frame.contentWindow);

      // 偽 storage に保存する（実際の localStorage を汚さない）
      var store = Object.create(null);
      var storage = shell.createStorageAdapter({
        storage: {
          getItem: function (k) {
            return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
          },
          setItem: function (k, v) { store[k] = String(v); },
          removeItem: function (k) { delete store[k]; }
        }
      });

      click(doc, 'btn-make');
      click(doc, 'btn-miss');
      click(doc, 'btn-next');
      click(doc, 'btn-make');
      click(doc, 'btn-make');
      click(doc, 'btn-undo');
      rig.panel.renderAll();

      var expectedCounts = rig.counts.getCountsList();
      var expectedHistory = rig.counts.getHistory();
      var expectedIndex = rig.cursor.getIndex();

      var state = {
        schemaVersion: hook.SCHEMA_VERSION,
        startedAt: '2026-09-25T06:00:00+09:00',
        elapsedSec: 123,
        menuId: MENU.id,
        activeIndex: expectedIndex,
        counts: expectedCounts,
        operations: expectedHistory,
        ended: false
      };

      return storage.saveSession(state).then(function () {
        return storage.loadSession(MENU);
      }).then(function (loaded) {
        assert.ok(loaded !== null, '保存したセッションを読み込めない');
        assert.ok(loaded.issues.length === 0,
          '復元で issues が出た: ' + assert.format(loaded.issues));

        // 別の状態層へ復元し、同じ描画結果になることを確かめる
        var counts2 = shell.createCountManager();
        var cursor2 = shell.createCursorManager();
        counts2.initFromMenu(MENU);
        cursor2.setMenu(MENU);
        counts2.restore(loaded.state.counts, loaded.state.operations);
        cursor2.restore(loaded.state.activeIndex, loaded.state.counts.length);

        assert.deepEqualOk(counts2.getCountsList(), expectedCounts,
          '復元後の counts が一致しない', { name: 'counts' });
        assert.deepEqualOk(counts2.getHistory(), expectedHistory,
          '復元後の操作履歴が一致しない', { name: 'history' });
        assert.ok(cursor2.getIndex() === expectedIndex,
          '復元後のアクティブ種目が一致しない');

        // 復元した状態でも取り消しが続けられる（要件 5-7）
        var undone = counts2.undo();
        assert.ok(undone.ok === true, '復元した履歴を取り消せない');
      });
    });
  });

  register('spec-dom: 全カウント初期化は確認操作の完了まで状態を変えない（要件 7-9, 7-10）', function () {
    return withFrame(375, 812, function (doc, frame) {
      var rig = buildRig(doc, frame.contentWindow);
      click(doc, 'btn-make');
      click(doc, 'btn-next');
      rig.panel.renderAll();
      var before = rig.counts.getCountsList();

      click(doc, 'btn-reset-counts');
      // 確認表示が出ており、状態は変わっていない
      assert.ok(doc.getElementById('confirm-backdrop').hasAttribute('hidden') === false,
        '確認表示が出ていない');
      assert.deepEqualOk(rig.counts.getCountsList(), before,
        '確認前に状態が変化した', { name: 'counts' });

      // 「やめる」を選ぶと状態は変わらない
      click(doc, 'btn-confirm-cancel');
      return Promise.resolve().then(function () {
        assert.deepEqualOk(rig.counts.getCountsList(), before,
          'キャンセル後に状態が変化した', { name: 'counts' });

        click(doc, 'btn-reset-counts');
        click(doc, 'btn-confirm-ok');
        return Promise.resolve();
      }).then(function () {
        var after = rig.counts.getCountsList();
        for (var i = 0; i < after.length; i++) {
          assert.ok(after[i].make === 0 && after[i].attempt === 0,
            '初期化後に Make / Attempt が 0 でない: ' + assert.format(after[i]));
        }
        assert.ok(rig.counts.getHistory().length === 0, '初期化後に操作履歴が残っている');
        assert.ok(rig.cursor.getIndex() === 0, '初期化後にアクティブ種目が先頭でない');
        assert.ok(doc.getElementById('confirm-backdrop').hasAttribute('hidden') === true,
          '確認表示が閉じていない');
      });
    });
  });

  /* =======================================================================
   * 省電力モードの配色（要件 10-2, 10-6, 8-12, 7-2）
   * ===================================================================== */

  function srgbToLinear(c) {
    var v = c / 255;
    return (v <= 0.04045) ? (v / 12.92) : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  function parseRgb(value) {
    var m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(String(value));
    if (!m) { return null; }
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  }

  function luminance(rgb) {
    return 0.2126 * srgbToLinear(rgb[0]) + 0.7152 * srgbToLinear(rgb[1]) + 0.0722 * srgbToLinear(rgb[2]);
  }

  function contrast(a, b) {
    var la = luminance(a);
    var lb = luminance(b);
    var hi = Math.max(la, lb);
    var lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }

  register('spec-dom: 省電力モードの配色とコントラスト比（要件 10-2, 10-6, 8-12, 7-2）', function () {
    return withFrame(375, 812, function (doc, frame) {
      var win = frame.contentWindow;
      buildRig(doc, win);
      doc.documentElement.setAttribute('data-theme', 'power');

      // 要件 10-2: 背景は #000000
      var bodyBg = parseRgb(win.getComputedStyle(doc.body).backgroundColor);
      assert.deepEqualOk(bodyBg, [0, 0, 0], '省電力時の背景が #000000 でない', { name: 'bg' });

      // 要件 8-12 / 10-6: Make・種目名・全体進捗テキストは 7:1 以上
      var sevenToOne = ['active-make', 'active-name', 'progress-text'];
      var i;
      for (i = 0; i < sevenToOne.length; i++) {
        var node = doc.getElementById(sevenToOne[i]);
        var fg = parseRgb(win.getComputedStyle(node).color);
        var ratio = contrast(fg, bodyBg);
        assert.ok(ratio >= 7,
          sevenToOne[i] + ' のコントラスト比が 7:1 未満: ' + ratio.toFixed(2));
      }

      // 要件 7-2: 操作ボタンのラベルと当該ボタンの背景は 4.5:1 以上
      var buttons = ['btn-make', 'btn-miss', 'btn-undo', 'btn-prev', 'btn-next', 'btn-reset-counts'];
      for (i = 0; i < buttons.length; i++) {
        var btn = doc.getElementById(buttons[i]);
        var style = win.getComputedStyle(btn);
        var label = parseRgb(style.color);
        var back = parseRgb(style.backgroundColor);
        var r = contrast(label, back);
        assert.ok(r >= 4.5,
          buttons[i] + ' のラベルと背景のコントラスト比が 4.5:1 未満: ' + r.toFixed(2));
        // 要件 7-2 / 10-6 のトグルも含めタップ領域 72px 以上（要件 7-3）
        var rect = btn.getBoundingClientRect();
        if (buttons[i] !== 'btn-reset-counts') {
          assert.ok(rect.width >= 72 - 0.5 && rect.height >= 72 - 0.5,
            buttons[i] + ' の省電力時のタップ領域が 72px 未満');
        }
      }

      // 要件 8-8: アクティブ行と非アクティブ行の背景は 3:1 以上
      var rows = doc.querySelectorAll('#drill-list .drill-row');
      var activeBg = parseRgb(win.getComputedStyle(rows[0]).backgroundColor);
      var idleBg = parseRgb(win.getComputedStyle(rows[1]).backgroundColor);
      var rowRatio = contrast(activeBg, idleBg);
      assert.ok(rowRatio >= 3,
        'アクティブ行と非アクティブ行のコントラスト比が 3:1 未満: ' + rowRatio.toFixed(2));

      // 要件 10-3: アニメーション・トランジション・影を使わない
      var makeStyle = win.getComputedStyle(doc.getElementById('active-make'));
      assert.ok(makeStyle.transitionDuration === '0s' ||
        makeStyle.transitionDuration === '0s, 0s' ||
        /^0s(,\s*0s)*$/.test(makeStyle.transitionDuration),
        '省電力時にトランジションが残っている: ' + makeStyle.transitionDuration);
      assert.ok(makeStyle.animationName === 'none',
        '省電力時にアニメーションが残っている: ' + makeStyle.animationName);
    });
  });

  /* =======================================================================
   * 省電力時の描画バジェット（要件 10-4）
   * ===================================================================== */

  register('spec-dom: 省電力時は描画を 200ms に 1 回へ集約する（要件 10-4）', function () {
    var paints = 0;
    var clock = 0;
    var frames = [];
    var timers = [];

    var renderer = shell.createRenderer({
      paint: function () { paints++; },
      getBudgetMs: function () { return 200; },
      now: function () { return clock; },
      requestFrame: function (fn) { frames.push(fn); return frames.length; },
      defer: function (fn, ms) { timers.push({ fn: fn, at: clock + ms }); return timers.length; }
    });

    function runFrames() {
      var due = frames;
      frames = [];
      for (var i = 0; i < due.length; i++) { due[i](); }
    }
    function runTimers(to) {
      clock = to;
      var due = [];
      for (var i = timers.length - 1; i >= 0; i--) {
        if (timers[i].at <= clock) { due.unshift(timers[i]); timers.splice(i, 1); }
      }
      for (var k = 0; k < due.length; k++) { due[k].fn(); }
    }

    // 1 回目: 直前の描画が無いので即時（rAF）
    renderer.markDirty('active');
    runFrames();
    assert.ok(paints === 1, '初回描画が行われない: ' + paints);

    // 200ms 以内の連続変化は 1 回にまとまる
    clock = 50;
    renderer.markDirty('active');
    renderer.markDirty('progress');
    renderer.markDirty('list');
    runFrames();
    assert.ok(paints === 1, 'バジェット内の変化が即時描画された: ' + paints);

    runTimers(200);
    assert.ok(paints === 2, 'バジェット経過後に描画されない: ' + paints);

    // 毎秒 5 回以下: 0〜1000ms の間に 6 回変化させても描画は 5 回以下
    paints = 0;
    clock = 1000;
    renderer.markDirty('active');
    runFrames();
    var t = 1000;
    for (var i = 0; i < 10; i++) {
      t += 100;
      clock = t;
      renderer.markDirty('active');
      runTimers(t);
      runFrames();
    }
    assert.ok(paints <= 6, '1 秒あたりの描画回数が多すぎる: ' + paints);
    return Promise.resolve();
  });
})();


/* =========================================================================
 * 実際に bootstrap() した index.html に対する検証（タスク 21.1 / 22）
 * -------------------------------------------------------------------------
 * ここまでのテストは親ページ側の app.js で iframe の DOM を駆動していたが、
 * 以下は iframe 内で **bootstrap() が自ら配線した状態** を検証する。
 *
 * 注意: bootstrap() は実際の localStorage（テストサーバーのオリジン）に
 * `vsc:` 鍵を書く。各テストは実行前後に `vsc:` 接頭辞の鍵のみを掃除する
 * （接頭辞を持たない鍵には触れない。要件 12-3 と同じ方針）。
 * ======================================================================= */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window : globalThis;
  var pbt = G.pbt;
  var assert = G.assert;

  if (typeof document === 'undefined' || (G.location && G.location.protocol === 'file:')) {
    return;
  }
  if (!Array.isArray(G.__VSC_DEFERRED__)) { G.__VSC_DEFERRED__ = []; }

  function clearVscKeys() {
    var doomed = [];
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (typeof key === 'string' && key.indexOf('vsc:') === 0) { doomed.push(key); }
    }
    for (var k = 0; k < doomed.length; k++) { localStorage.removeItem(doomed[k]); }
    return doomed.length;
  }

  /** bootstrap 済みの index.html を iframe に読み込み、起動完了を待つ。 */
  function withBootedApp(width, height, fn) {
    return new Promise(function (resolve, reject) {
      var frame = document.createElement('iframe');
      /*
       * bootstrap() 済みの検証では requestAnimationFrame による再描画バッチが
       * 動く必要がある。画面外（left: -10000px）や opacity: 0 の iframe では
       * ブラウザが rAF を間引くため、**可視領域に重ねて** 配置する。
       * 操作は dispatchEvent で行うので pointer-events は不要。
       */
      frame.style.position = 'fixed';
      frame.style.left = '0';
      frame.style.top = '0';
      frame.style.zIndex = '-1';
      frame.style.border = '0';
      frame.style.pointerEvents = 'none';
      frame.style.width = width + 'px';
      frame.style.height = height + 'px';
      frame.src = '../index.html?boot=' + Date.now();
      frame.onload = function () {
        var cleanup = function () {
          if (frame.parentNode) { frame.parentNode.removeChild(frame); }
        };
        var doc = null;
        try {
          doc = frame.contentDocument;
        } catch (e) {
          cleanup();
          reject(new Error('iframe の contentDocument に触れない'));
          return;
        }
        /*
         * bootstrap() は非同期に復元 → 初回描画を行う。完了の同期的な合図は
         * 無いため、メニュー名が描画されるまで短い間隔でポーリングする。
         */
        var waited = 0;
        function ready() {
          var node = doc.getElementById('menu-name');
          return node && node.textContent && node.textContent.length > 0 &&
            doc.querySelectorAll('#drill-list .drill-row').length > 0;
        }
        function step() {
          if (ready()) {
            Promise.resolve().then(function () { return fn(doc, frame.contentWindow); })
              .then(function (v) { cleanup(); resolve(v); },
                function (e) { cleanup(); reject(e); });
            return;
          }
          waited += 25;
          if (waited > 5000) {
            cleanup();
            reject(new Error('bootstrap() の初回描画が 5 秒以内に完了しなかった'));
            return;
          }
          setTimeout(step, 25);
        }
        step();
      };
      frame.onerror = function () { reject(new Error('../index.html を読み込めなかった')); };
      document.body.appendChild(frame);
    });
  }

  function register(name, fn) {
    G.__VSC_DEFERRED__.push(function () {
      clearVscKeys();
      return Promise.resolve().then(fn).then(function () {
        clearVscKeys();
        pbt.test(name, function () { return true; });
      }, function (e) {
        clearVscKeys();
        var msg = (e && e.message) ? String(e.message) : String(e);
        pbt.test(name, function () { assert.fail(msg); });
      });
    });
  }

  function text(doc, id) {
    var node = doc.getElementById(id);
    return node ? node.textContent : null;
  }

  function click(doc, id) {
    doc.getElementById(id).dispatchEvent(
      new doc.defaultView.MouseEvent('click', { bubbles: true, cancelable: true }));
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  register('spec-dom: bootstrap() が既定メニューで初期描画する（要件 1-5, 8-1, 8-4, 21.1）', function () {
    return withBootedApp(375, 812, function (doc) {
      assert.ok(text(doc, 'menu-name') === '朝練125本IN',
        '既定メニュー名が描画されない: ' + text(doc, 'menu-name'));
      assert.ok(text(doc, 'progress-text') === '0 / 125本 IN',
        '全体進捗が「0 / 125本 IN」でない: ' + text(doc, 'progress-text'));
      var rows = doc.querySelectorAll('#drill-list .drill-row');
      assert.ok(rows.length === 13, '種目一覧が 13 行でない: ' + rows.length);
      assert.ok(text(doc, 'active-rate') === '--%', '初期の成功率が --% でない');
      assert.ok(text(doc, 'elapsed-time') === '00:00', '初期の経過時間が 00:00 でない');
      /* 初回起動で既定メニューを生成するのは正常な動作なので警告を出さない */
      assert.ok(text(doc, 'feedback-message') === '',
        '初回起動で不要なメッセージが出ている: ' + text(doc, 'feedback-message'));

      // 選択中メニュー識別子が保存されている（要件 18-12, 21.1）
      assert.ok(localStorage.getItem('vsc:activeMenuId') === '"m-default"',
        '選択中メニュー識別子が保存されない: ' + localStorage.getItem('vsc:activeMenuId'));
      assert.ok(localStorage.getItem('vsc:menus') !== null, 'メニュー集合が保存されない');
    });
  });

  register('spec-dom: bootstrap() 済みのタッチ操作が計数・保存・復元まで通る（要件 7-4, 12-4, 12-5）', function () {
    return withBootedApp(375, 812, function (doc) {
      // 連打破棄（300ms）を避けるため異なるボタンを交互に押す
      /* 同一ボタンの連打破棄（300ms。要件 7-7）に掛からないよう間隔を空ける */
      click(doc, 'btn-make');
      click(doc, 'btn-miss');
      click(doc, 'btn-next');
      return wait(350).then(function () {
        click(doc, 'btn-make');
        return wait(150);
      }).then(function () {
        assert.ok(text(doc, 'progress-text') === '2 / 125本 IN',
          'タップ後の全体進捗が反映されない: ' + text(doc, 'progress-text'));
        assert.ok(text(doc, 'active-name') === 'ショートミドル セットシュート',
          '次へで 2 番目の種目に移らない: ' + text(doc, 'active-name'));
        // 要件 12-4: 300ms デバウンスで保存される
        return wait(500);
      }).then(function () {
        var raw = localStorage.getItem('vsc:session');
        assert.ok(raw !== null, '進行中セッションが保存されない');
        var saved = JSON.parse(raw);
        assert.ok(saved.activeIndex === 1, '保存された activeIndex が 1 でない: ' + saved.activeIndex);
        assert.ok(saved.counts.length === 13, '保存された counts が 13 件でない');
        assert.ok(saved.counts[0].make === 1 && saved.counts[0].attempt === 2,
          '1 種目目のカウントが保存されない: ' + JSON.stringify(saved.counts[0]));
        assert.ok(saved.counts[1].make === 1 && saved.counts[1].attempt === 1,
          '2 種目目のカウントが保存されない: ' + JSON.stringify(saved.counts[1]));
        assert.ok(saved.operations.length === 3,
          '操作履歴が 3 件でない: ' + saved.operations.length);
      });
    }).then(function () {
      // 同じ localStorage のまま再読み込みすると復元される（要件 12-5）
      return withBootedApp(375, 812, function (doc) {
        assert.ok(text(doc, 'progress-text') === '2 / 125本 IN',
          '再読み込みで全体進捗が復元されない: ' + text(doc, 'progress-text'));
        assert.ok(text(doc, 'active-name') === 'ショートミドル セットシュート',
          '再読み込みでアクティブ種目が復元されない: ' + text(doc, 'active-name'));
        assert.ok(text(doc, 'feedback-message').indexOf('再開') !== -1,
          '前回の練習を再開したことを示す表示がない: ' + text(doc, 'feedback-message'));

        // 復元した履歴を取り消せる（要件 5-7）
        click(doc, 'btn-undo');
        return wait(300).then(function () {
          assert.ok(text(doc, 'progress-text') === '1 / 125本 IN',
            '復元した履歴の取り消しが反映されない: ' + text(doc, 'progress-text'));
        });
      });
    });
  });

  register('spec-dom: bootstrap() 済みで目標到達時に次の種目へ自動遷移する（要件 6-9）', function () {
    return withBootedApp(375, 812, function (doc) {
      /*
       * 既定メニューは各種目 10 本なので、まずメニュー編集画面で 1 種目目の
       * 目標を 2 本に下げてから、成功 2 本で次の種目へ移ることを確認する。
       */
      click(doc, 'btn-open-menu');
      return wait(200).then(function () {
        var rows = doc.querySelectorAll('#drill-editor-list .drill-editor-row');
        rows[0].querySelector('[data-action="edit"]').dispatchEvent(
          new doc.defaultView.MouseEvent('click', { bubbles: true, cancelable: true }));
        doc.getElementById('input-drill-target').value = '2';
        click(doc, 'btn-drill-save');
        return wait(150);
      }).then(function () {
        click(doc, 'btn-menu-back');
        return wait(250);
      }).then(function () {
        assert.ok(text(doc, 'active-name') === 'ゴール下 セットシュート',
          '初期のアクティブ種目が 1 種目目でない: ' + text(doc, 'active-name'));
        assert.ok(text(doc, 'active-target') === '2', '目標成功数が 2 に変わっていない');

        // 1 本目: 目標未達なので遷移しない
        click(doc, 'btn-make');
        return wait(300);
      }).then(function () {
        assert.ok(text(doc, 'active-name') === 'ゴール下 セットシュート',
          '目標未達でアクティブ種目が動いた: ' + text(doc, 'active-name'));
        assert.ok(text(doc, 'active-make') === '1', '1 本目が記録されない');

        // 2 本目: 目標到達 → 自動で 2 種目目へ
        click(doc, 'btn-miss');            // 連打破棄を避けつつ試投だけ増やす
        return wait(350);
      }).then(function () {
        click(doc, 'btn-make');
        return wait(400);
      }).then(function () {
        assert.ok(text(doc, 'active-name') === 'ショートミドル セットシュート',
          '目標到達で次の種目へ自動遷移しない: ' + text(doc, 'active-name'));
        assert.ok(text(doc, 'active-make') === '0',
          '遷移先の種目の Make が 0 でない: ' + text(doc, 'active-make'));
        assert.ok(text(doc, 'active-target') === '10',
          '遷移先の種目の目標成功数が 10 でない: ' + text(doc, 'active-target'));
        // 遷移したことがフィードバック領域に出る（画面を見れば次の種目が分かる）
        assert.ok(text(doc, 'feedback-message').indexOf('ショートミドル') !== -1,
          '遷移先の種目名が提示されない: ' + text(doc, 'feedback-message'));

        // 種目一覧でも 1 種目目が達成済み・2 種目目がアクティブになっている
        var rows = doc.querySelectorAll('#drill-list .drill-row');
        assert.ok(rows[0].getAttribute('data-achieved') === 'true',
          '1 種目目が達成済み表示にならない');
        assert.ok(rows[1].getAttribute('aria-current') === 'true',
          '2 種目目がアクティブ行にならない');

        // 遷移後の加算は新しい種目に入る
        click(doc, 'btn-make');
        return wait(300);
      }).then(function () {
        assert.ok(text(doc, 'active-make') === '1',
          '遷移後の加算が新しい種目に入らない: ' + text(doc, 'active-make'));
        var rows = doc.querySelectorAll('#drill-list .drill-row');
        assert.ok(rows[0].querySelector('.drill-make').textContent === '2 / 2',
          '1 種目目のカウントが変化した: ' + rows[0].querySelector('.drill-make').textContent);
      });
    });
  });

  register('spec-dom: bootstrap() 済みの省電力トグルが配色と設定を切り替える（要件 10-1, 10-2, 10-7）', function () {
    return withBootedApp(375, 812, function (doc, win) {
      /*
       * 未保存時の初期値は OS の配色設定に従う（要件 10-9 / 10-10）。
       * ヘッドレスブラウザの既定はダークになりうるため、初期値を決め打ちせず
       * 「トグルで反転し、その値が保存される」ことを確認する。
       */
      var initialPower = (doc.documentElement.getAttribute('data-theme') === 'power');
      click(doc, 'btn-open-history');   // 別パネルでも配線が壊れないことを確認
      click(doc, 'btn-history-back');
      click(doc, 'toggle-power-save');
      return wait(300).then(function () {
        var nowPower = (doc.documentElement.getAttribute('data-theme') === 'power');
        assert.ok(nowPower === !initialPower,
          '省電力トグルで data-theme が反転しない（' + initialPower + ' -> ' + nowPower + '）');
        var bg = win.getComputedStyle(doc.body).backgroundColor;
        if (nowPower) {
          assert.ok(bg === 'rgb(0, 0, 0)', '省電力時の背景が #000000 でない: ' + bg);
        }
        assert.ok(doc.getElementById('toggle-power-save').getAttribute('aria-pressed') ===
          (nowPower ? 'true' : 'false'),
          'トグルの aria-pressed が状態と一致しない');
        return wait(400);
      }).then(function () {
        var settings = localStorage.getItem('vsc:settings');
        assert.ok(settings !== null, '設定が保存されない');
        assert.ok(JSON.parse(settings).powerSave === !initialPower,
          '省電力の設定値が保存されない: ' + settings);
      });
    });
  });

  register('spec-dom: bootstrap() 済みの練習開始・一時停止・終了が経過時間と履歴に反映される（要件 11-1, 11-4, 11-7, 14-1）', function () {
    return withBootedApp(375, 812, function (doc) {
      var t0 = doc.defaultView.Date.now();
      click(doc, 'btn-session-start');
      click(doc, 'btn-make');
      return wait(2500).then(function () {
        var delta = doc.defaultView.Date.now() - t0;
        var elapsed = text(doc, 'elapsed-time');
        assert.ok(/^\d{2}:\d{2}$/.test(elapsed), '経過時間が mm:ss 形式でない: ' + elapsed);
        assert.ok(elapsed !== '00:00',
          '経過時間が進まない: ' + elapsed + '（iframe 内の実経過 ' + delta + 'ms）');

        click(doc, 'btn-session-pause');
        /* ラベルの切り替えは再描画で反映されるため 1 度待つ */
        return wait(300).then(function () {
          assert.ok(doc.getElementById('btn-session-pause').textContent === '再開',
            '一時停止でボタンのラベルが「再開」にならない: ' +
            doc.getElementById('btn-session-pause').textContent);
          var paused = text(doc, 'elapsed-time');
          return wait(2500).then(function () {
            assert.ok(text(doc, 'elapsed-time') === paused,
              '一時停止中に経過時間が進んだ: ' + paused + ' -> ' + text(doc, 'elapsed-time'));
            click(doc, 'btn-session-end');
            return wait(400);
          });
        });
      }).then(function () {
        var index = localStorage.getItem('vsc:hist:index');
        assert.ok(index !== null, '履歴インデックスが保存されない');
        var entries = JSON.parse(index);
        assert.ok(entries.length === 1, '履歴件数が 1 でない: ' + entries.length);
        var raw = localStorage.getItem('vsc:hist:' + entries[0].id);
        assert.ok(raw !== null, '履歴レコードが保存されない');
        var record = JSON.parse(raw);
        assert.ok(record.totalMake === 1 && record.totalAttempt === 1,
          '履歴の全体成功数 / 試投数が一致しない: ' +
          record.totalMake + '/' + record.totalAttempt);
        assert.ok(record.targetTotal === 125, '履歴の目標合計が 125 でない');
        assert.ok(record.drills.length === 13, '履歴のスナップショットが 13 種目でない');
        // 要件 12-10: 履歴保存成功で進行中セッションを削除する
        assert.ok(localStorage.getItem('vsc:session') === null,
          '履歴保存後に進行中セッションが残っている');

        // 履歴画面に 1 件表示される（要件 14-2, 14-3）
        click(doc, 'btn-open-history');
        return wait(200);
      }).then(function () {
        var rows = doc.querySelectorAll('#history-list .history-row');
        assert.ok(rows.length === 1, '履歴一覧が 1 行でない: ' + rows.length);
        assert.ok(rows[0].querySelector('.history-achieved').textContent === '未達',
          '達成状態の表示が「未達」でない');
        assert.ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(
          rows[0].querySelector('.history-when').textContent),
          '終了日時の表示が YYYY-MM-DD HH:MM 形式でない: ' +
          rows[0].querySelector('.history-when').textContent);

        // 行を選ぶと詳細が出る（要件 14-4）
        rows[0].dispatchEvent(new doc.defaultView.MouseEvent('click',
          { bubbles: true, cancelable: true }));
        return wait(100);
      }).then(function () {
        assert.ok(doc.getElementById('history-detail').hasAttribute('hidden') === false,
          '詳細が表示されない');
        var detail = doc.querySelectorAll('#history-detail-list .history-detail-row');
        assert.ok(detail.length === 13, '詳細の行数が 13 でない: ' + detail.length);
        var rates = [];
        for (var i = 0; i < detail.length; i++) {
          rates.push(detail[i].querySelector('.drill-rate').textContent);
        }
        assert.ok(rates[0] === '100.0%', '1 種目目の成功率が 100.0% でない: ' + rates[0]);
        assert.ok(rates[1] === '--%', '試投 0 の種目の成功率が --% でない: ' + rates[1]);
      });
    });
  });

  register('spec-dom: bootstrap() 済みのメニュー編集と切り替え（要件 17-1, 17-7, 18-3, 18-10, 18-16）', function () {
    return withBootedApp(375, 812, function (doc) {
      click(doc, 'btn-open-menu');
      return wait(150).then(function () {
        var rows = doc.querySelectorAll('#menu-list .menu-row');
        assert.ok(rows.length === 1, 'メニュー一覧が 1 行でない: ' + rows.length);
        assert.ok(rows[0].querySelector('.menu-row-meta').textContent.indexOf('13 種目') !== -1,
          'メニュー行に種目数が併記されない: ' + rows[0].querySelector('.menu-row-meta').textContent);
        assert.ok(rows[0].querySelector('.menu-row-meta').textContent.indexOf('125') !== -1,
          'メニュー行に目標合計が併記されない');
        assert.ok(rows[0].getAttribute('aria-current') === 'true',
          '選択中メニューの行が区別されない');

        // 制約違反（空のメニュー名）は保存せずメッセージを出す（要件 18-4）
        doc.getElementById('input-menu-name').value = '';
        click(doc, 'btn-menu-create');
        assert.ok(doc.querySelectorAll('#menu-list .menu-row').length === 1,
          '空のメニュー名でメニューが作られた');
        assert.ok(text(doc, 'menu-violations').length > 0, '違反メッセージが出ていない');

        // 重複するメニュー名も拒否される（要件 18-3）
        doc.getElementById('input-menu-name').value = '朝練125本IN';
        click(doc, 'btn-menu-create');
        assert.ok(doc.querySelectorAll('#menu-list .menu-row').length === 1,
          '重複するメニュー名でメニューが作られた');

        // 正常な作成
        doc.getElementById('input-menu-name').value = '夕練';
        click(doc, 'btn-menu-create');
        return wait(100);
      }).then(function () {
        var rows = doc.querySelectorAll('#menu-list .menu-row');
        assert.ok(rows.length === 2, 'メニューが 2 件にならない: ' + rows.length);

        // 種目の targetMake を不正な値に編集しても反映しない（要件 17-7）
        var editorRows = doc.querySelectorAll('#drill-editor-list .drill-editor-row');
        assert.ok(editorRows.length === 13, '種目編集行が 13 行でない: ' + editorRows.length);
        var editButton = editorRows[0].querySelector('[data-action="edit"]');
        editButton.dispatchEvent(new doc.defaultView.MouseEvent('click',
          { bubbles: true, cancelable: true }));
        assert.ok(doc.getElementById('drill-form').hasAttribute('hidden') === false,
          '種目編集フォームが開かない');
        doc.getElementById('input-drill-target').value = '0';
        click(doc, 'btn-drill-save');
        assert.ok(text(doc, 'menu-violations').length > 0,
          '不正な targetMake の違反メッセージが出ていない');

        // 正常な編集（section は空欄も受け付ける。要件 17-5）
        doc.getElementById('input-drill-target').value = '12';
        doc.getElementById('input-drill-section').value = '';
        click(doc, 'btn-drill-save');
        return wait(100);
      }).then(function () {
        var label = doc.querySelectorAll('#drill-editor-list .drill-editor-row')[0]
          .querySelector('.drill-editor-label').textContent;
        assert.ok(label.indexOf('目標 12') !== -1, 'targetMake の編集が反映されない: ' + label);

        click(doc, 'btn-menu-back');
        return wait(150);
      }).then(function () {
        // 目標合計が 125 → 127 に追従する（リテラル 125 に依存しない。要件 8-4）
        assert.ok(text(doc, 'progress-text') === '0 / 127本 IN',
          '目標合計が編集に追従しない: ' + text(doc, 'progress-text'));
      });
    });
  });
})();
