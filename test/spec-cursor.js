/*
 * voice-shot-counter-pwa — test/spec-cursor.js
 *
 * Property 10（カーソルの境界維持と非循環）と Property 11（種目 id の安定性）の
 * プロパティテスト。
 *
 * 要件 16-4: ビルド工程を持たないため、本ファイルはクラシックスクリプトであり
 * `import` / `export` を含まない。tests.html から読み込まれた時点で自身の
 * テストを実行し、結果を pbt.results に積む。
 *
 * 検証対象は `window.__VSC_TEST__` 経由で公開される純粋関数のみであり、
 * DOM もブラウザ API のモックも用いない。
 *
 * ============================================================================
 * 前提とする形（app.js 2-2 / 2-3 の取り決めと同一）
 * ============================================================================
 *   menu    : {id, name, drills:[{id, section, name, targetMake}, ...]}
 *   counts  : [{id, make, attempt}, ...]  配列順 = drills の配列順
 *   history : [{drillId, type}, ...]      配列順 = 実行順、最大 20 件
 *
 * ============================================================================
 * タスク 21.1 への申し送り
 * ============================================================================
 * Property 11 の対象関数は設計の Property 11 表に従い `reorderDrills` /
 * `removeDrill` / `addDrill` と Count_Manager の `purgeDrill` / `addDrill` の
 * 純粋版（`purgeDrillCounts` / `addDrillCounts` / `reorderCounts`）である。
 * 設計「Components and Interfaces」の `window.__VSC_TEST__` 公開一覧には
 * これらが列挙されていないため、タスク 21.1 は公開対象にこの 6 個
 * （reorderDrills / removeDrill / addDrill / purgeDrillCounts /
 *   addDrillCounts / reorderCounts）を加える必要がある。いずれも純粋関数であり、
 * ファクトリ関数・DOM 参照・localStorage ラッパは含まないため公開方針に反しない。
 */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window : globalThis;
  var pbt = G.pbt;
  var assert = G.assert;
  var hook = G.__VSC_TEST__;

  var REQUIRED = [
    'cursorReducer', 'reindexAfterMenuChange',
    'reorderDrills', 'removeDrill', 'addDrill',
    'purgeDrillCounts', 'addDrillCounts', 'reorderCounts',
    'nextDrillId', 'LIMITS'
  ];
  var missing = [];
  for (var r = 0; r < REQUIRED.length; r++) {
    if (!hook || !hook[REQUIRED[r]]) { missing.push(REQUIRED[r]); }
  }
  if (missing.length > 0) {
    pbt.test('spec-cursor.js: window.__VSC_TEST__ の前提', function () {
      assert.fail('公開フックに ' + missing.join(' / ') + ' が無い（タスク 21.1 が公開する）');
    });
    return;
  }

  var cursorReducer = hook.cursorReducer;
  var reorderDrills = hook.reorderDrills;
  var removeDrill = hook.removeDrill;
  var addDrill = hook.addDrill;
  var purgeDrillCounts = hook.purgeDrillCounts;
  var addDrillCounts = hook.addDrillCounts;
  var reorderCounts = hook.reorderCounts;
  var LIMITS = hook.LIMITS;

  var COUNT_MAX = LIMITS.COUNT_MAX;               // 999
  var HISTORY_MAX = LIMITS.OPERATION_HISTORY_MAX; // 20
  var DRILL_MIN = LIMITS.DRILL_COUNT_MIN;         // 1
  var DRILL_MAX = LIMITS.DRILL_COUNT_MAX;         // 50

  var gen = pbt.gen;

  /* ========================================================================
   * 共通ユーティリティ
   * ====================================================================== */

  function cloneCounts(counts) {
    var out = [];
    for (var i = 0; i < counts.length; i++) {
      out.push({ id: counts[i].id, make: counts[i].make, attempt: counts[i].attempt });
    }
    return out;
  }

  function cloneHistory(history) {
    var out = [];
    for (var i = 0; i < history.length; i++) {
      out.push({ drillId: history[i].drillId, type: history[i].type });
    }
    return out;
  }

  /**
   * 種目素材の列から drills と counts を同時に組み立てる。
   * id は `1 + 累積(1 + gap)` で単調増加させ、欠番のある id 集合も作る。
   * counts の配列順は drills の配列順と一致させる（2-2 の取り決め）。
   */
  function buildMenuAndCounts(specs) {
    var drills = [];
    var counts = [];
    var id = 0;
    for (var i = 0; i < specs.length; i++) {
      var s = specs[i];
      id += 1 + (s.gap | 0);
      var attempt = s.attempt;
      var make = s.make > attempt ? attempt : s.make;
      drills.push({ id: id, section: s.section, name: s.name, targetMake: s.targetMake });
      counts.push({ id: id, make: make, attempt: attempt });
    }
    return {
      menu: { id: 'm-test', name: 'テストメニュー', drills: drills },
      counts: counts
    };
  }

  function idsOfDrills(drills) {
    var out = [];
    for (var i = 0; i < drills.length; i++) { out.push(drills[i].id); }
    return out;
  }

  function idsOfCounts(counts) {
    var out = [];
    for (var i = 0; i < counts.length; i++) { out.push(counts[i].id); }
    return out;
  }

  function countOfId(counts, id) {
    for (var i = 0; i < counts.length; i++) {
      if (counts[i].id === id) { return counts[i]; }
    }
    return null;
  }

  /* ------------------------------------------------------------------ 生成器 */

  var sectionGen = gen.oneOf(['近距離', 'エルボー', '', 'ネイル']);
  var nameGen = gen.oneOf(['ゴール下', 'フリースロー', '3P', 'ミドル']);

  var drillSpecGen = gen.record({
    gap: gen.frequency([[8, gen.const(0)], [2, gen.int(1, 3)]]),
    attempt: gen.frequency([[7, gen.int(0, COUNT_MAX)], [3, gen.int(COUNT_MAX - 4, COUNT_MAX)]]),
    make: gen.int(0, COUNT_MAX),
    section: sectionGen,
    name: nameGen,
    targetMake: gen.int(1, 99)
  });

  // 種目数 N は 1〜50。N = 1 を高頻度に含める（Property 10 / 11 の指定）。
  var menuSpecsGen = gen.frequency([
    [4, gen.array(drillSpecGen, DRILL_MIN, DRILL_MIN)],
    [3, gen.array(drillSpecGen, DRILL_MIN, 6)],
    [2, gen.array(drillSpecGen, DRILL_MIN, 16)],
    [1, gen.array(drillSpecGen, DRILL_MIN, DRILL_MAX)]
  ]);

  /* ========================================================================
   * Property 10: カーソルの境界維持と非循環
   * ------------------------------------------------------------------------
   * 対象関数は `cursorReducer(index, N, command)` のみである。設計の主張
   * 「全ステップで全種目の Make と Attempt が変化しない」は、この関数が
   * counts を引数にも戻り値にも持たないという分離（app.js 2-3 (a)）によって
   * 構造的に保証されるが、その分離が保たれていること自体をテストでも
   * 確認する（カウント状態をコマンド列と並走させ、各ステップで深い等価を主張）。
   * ====================================================================== */

  /* コマンド素材。`SELECT` の引数には範囲外の値も低頻度で混入させる
   * （out === true のとき −1 以下または N 以上の値を作る）。
   * 種別は整数の選択子から写す。文字列定数を直接生成すると縮小器が
   * 「より単純な文字列」（空文字など）へ縮めてしまい、生成器の定義域外の
   * 反例が報告されるため。 */
  var cursorCmdGen = gen.record({
    kindSeed: gen.int(0, 9),
    slot: gen.int(0, DRILL_MAX - 1),
    out: gen.frequency([[8, gen.const(false)], [2, gen.const(true)]]),
    negative: gen.bool(),
    offset: gen.int(0, 5)
  });

  /** 0〜3 = NEXT（4/10）、4〜6 = PREV（3/10）、7〜9 = SELECT（3/10）。 */
  function cursorKindOf(spec) {
    if (spec.kindSeed <= 3) { return 'NEXT'; }
    if (spec.kindSeed <= 6) { return 'PREV'; }
    return 'SELECT';
  }

  var cursorCmdListGen = gen.frequency([
    [5, gen.array(cursorCmdGen, 0, 40)],
    [5, gen.array(cursorCmdGen, 0, 200)]
  ]);

  /** コマンド素材を cursorReducer へ渡す形へ写す。 */
  function toCommand(spec, kind, n) {
    if (kind === 'NEXT' || kind === 'PREV') { return kind; }
    var target;
    if (spec.out) {
      target = spec.negative ? (-1 - spec.offset) : (n + spec.offset);
    } else {
      target = spec.slot % n;
    }
    return { type: 'SELECT', index: target };
  }

  // Feature: voice-shot-counter-pwa, Property 10: カーソルの境界維持と非循環 — *For any* 種目数 N（1 ≤ N ≤ 50）と任意の移動コマンド列について、アクティブ種目インデックスは常に 0 以上 N−1 以下に留まり、末尾および先頭で循環せず、全ステップで全種目の Make と Attempt が変化しない。
  // Validates: Requirements 6.5, 6.6, 6.7, 6.1
  pbt.forAll('Property 10: カーソルの境界維持と非循環',
    [menuSpecsGen, gen.int(0, DRILL_MAX - 1), cursorCmdListGen],
    function (drillSpecs, indexSeed, cmdSpecs) {
      var built = buildMenuAndCounts(drillSpecs);
      var n = built.menu.drills.length;

      // 移動と無関係なカウント状態（要件 6-1）。cursorReducer には渡さない。
      var counts = built.counts;
      var countsBefore = cloneCounts(counts);

      var index = indexSeed % n;
      assert.ok(Number.isInteger(index) && index >= 0 && index <= n - 1,
        '初期インデックスの生成が値域を外れた: ' + index);

      for (var i = 0; i < cmdSpecs.length; i++) {
        var spec = cmdSpecs[i];
        var kind = cursorKindOf(spec);
        var command = toCommand(spec, kind, n);
        var before = index;
        var where = 'ステップ #' + i + ' (' + kind + ' ' +
          assert.format(command) + ', N=' + n + ', i=' + before + ')';

        var res = assert.throwsNot((function (cur, cmd) {
          return function () { return cursorReducer(cur, n, cmd); };
        })(before, command), 'cursorReducer は例外を送出しない: ' + where);

        // 戻り値の形（拒否理由は 4 種のいずれか、または受理時 null）。
        var keys = Object.keys(res).sort().join(',');
        assert.ok(keys === 'index,ok,reason', where + ': 想定外のフィールド: ' + keys);
        assert.ok(typeof res.ok === 'boolean', where + ': ok が真偽値でない');

        // 要件 6-7: インデックスは常に 0 以上 N−1 以下の整数。
        assert.ok(Number.isInteger(res.index), where + ': index が整数でない: ' + assert.format(res.index));
        assert.ok(res.index >= 0 && res.index <= n - 1,
          where + ': index が値域外: ' + res.index + ' (N=' + n + ')');

        if (kind === 'NEXT') {
          if (before === n - 1) {
            // 要件 6-5: 最終種目で循環しない。N = 1 では常にここに入る。
            assert.ok(res.ok === false, where + ': 最終種目の NEXT が受理された');
            assert.ok(res.reason === 'AT_LAST',
              where + ': 拒否理由が AT_LAST でない: ' + assert.format(res.reason));
            assert.ok(res.index === before, where + ': 最終種目の NEXT でインデックスが動いた');
          } else {
            // 要件 6-3: 1 だけ増加する。
            assert.ok(res.ok === true, where + ': NEXT が拒否された: ' + assert.format(res.reason));
            assert.ok(res.reason === null, where + ': 受理時に拒否理由が付いた');
            assert.ok(res.index === before + 1, where + ': NEXT が 1 だけ増加していない: ' + res.index);
          }
        } else if (kind === 'PREV') {
          if (before === 0) {
            // 要件 6-6: 先頭種目で循環しない。N = 1 では常にここに入る。
            assert.ok(res.ok === false, where + ': 先頭種目の PREV が受理された');
            assert.ok(res.reason === 'AT_FIRST',
              where + ': 拒否理由が AT_FIRST でない: ' + assert.format(res.reason));
            assert.ok(res.index === before, where + ': 先頭種目の PREV でインデックスが動いた');
          } else {
            // 要件 6-4: 1 だけ減少する。
            assert.ok(res.ok === true, where + ': PREV が拒否された: ' + assert.format(res.reason));
            assert.ok(res.reason === null, where + ': 受理時に拒否理由が付いた');
            assert.ok(res.index === before - 1, where + ': PREV が 1 だけ減少していない: ' + res.index);
          }
        } else {
          var target = command.index;
          if (target >= 0 && target <= n - 1) {
            // 要件 6-8: 範囲内の選択は（同一種目の再選択を含めて）受理される。
            assert.ok(res.ok === true, where + ': 範囲内の SELECT が拒否された');
            assert.ok(res.index === target, where + ': SELECT 先が一致しない: ' + res.index);
          } else {
            // 範囲外の SELECT はインデックスを変えない。
            assert.ok(res.ok === false, where + ': 範囲外の SELECT が受理された');
            assert.ok(res.reason === 'OUT_OF_RANGE',
              where + ': 拒否理由が OUT_OF_RANGE でない: ' + assert.format(res.reason));
            assert.ok(res.index === before, where + ': 範囲外の SELECT でインデックスが動いた');
          }
        }

        // N = 1 では NEXT / PREV のいずれも 0 を維持する（Property 10 の指定）。
        if (n === 1) {
          assert.ok(res.index === 0, where + ': N=1 でインデックスが 0 でない: ' + res.index);
        }

        // 要件 6-1: 全ステップでカウント状態が深い等価で不変。
        assert.deepEqualOk(counts, countsBefore, where + ': カウント状態が変化した');

        index = res.index;
      }

      // コマンド列全体を通してもカウント状態は不変。
      assert.deepEqualOk(counts, countsBefore, 'コマンド列の実行後にカウント状態が変化した');
      return true;
    }, { runs: 200 });

  /* ========================================================================
   * Property 11: 種目 id の安定性
   * ====================================================================== */

  /* 操作素材。`keys` から現在の id 列の置換を導出し（決定的なランダム置換）、
   * REMOVE は残数が 1 になる手前まで、ADD は低頻度で混ぜる。
   * 種別は整数の選択子から写す（縮小器が文字列を定義域外へ縮めないように）。 */
  var menuOpGen = gen.record({
    kindSeed: gen.int(0, 9),
    slot: gen.int(0, DRILL_MAX - 1),
    keys: gen.array(gen.int(0, 999), 0, DRILL_MAX),
    targetMake: gen.int(1, 99)
  });

  /** 0〜3 = REORDER（4/10）、4〜7 = REMOVE（4/10）、8〜9 = ADD（2/10）。 */
  function menuOpKindOf(op) {
    if (op.kindSeed <= 3) { return 'REORDER'; }
    if (op.kindSeed <= 7) { return 'REMOVE'; }
    return 'ADD';
  }

  var menuOpListGen = gen.frequency([
    [6, gen.array(menuOpGen, 0, 10)],
    [4, gen.array(menuOpGen, 0, 30)]
  ]);

  var historySpecsGen = gen.array(
    gen.record({ slot: gen.int(0, DRILL_MAX - 1), type: gen.oneOf(['MAKE', 'MISS']) }),
    0, HISTORY_MAX);

  /** `keys` を並べ替え鍵として ids の置換を作る（安定・決定的）。 */
  function permuteIds(ids, keys) {
    var decorated = [];
    for (var i = 0; i < ids.length; i++) {
      decorated.push({ id: ids[i], key: keys.length > 0 ? keys[i % keys.length] : 0, at: i });
    }
    decorated.sort(function (a, b) {
      if (a.key !== b.key) { return a.key - b.key; }
      return a.at - b.at;
    });
    var out = [];
    for (var j = 0; j < decorated.length; j++) { out.push(decorated[j].id); }
    return out;
  }

  /** counts の配列順が drills の配列順と一致していること（2-2 の取り決め）。 */
  function assertAligned(menu, counts, where) {
    assert.deepEqualOk(idsOfCounts(counts), idsOfDrills(menu.drills),
      where + ': counts の配列順が drills の配列順と一致しない');
    return true;
  }

  // Feature: voice-shot-counter-pwa, Property 11: 種目 id の安定性 — *For any* メニューとカウント状態、および任意の長さの「並べ替え」「削除」操作列について、操作列の後に残存する種目の id と、当該 id に対応する Make / Attempt は操作前の値と一致する。
  // Validates: Requirements 17.2, 17.3, 17.12, 17.13
  pbt.forAll('Property 11: 種目 id の安定性',
    [menuSpecsGen, historySpecsGen, menuOpListGen],
    function (drillSpecs, historySpecs, ops) {
      var built = buildMenuAndCounts(drillSpecs);
      var menu = built.menu;
      var counts = built.counts;

      var initialIds = idsOfDrills(menu.drills);
      // 初期値の記録（id → {make, attempt}）。
      var initial = {};
      for (var i0 = 0; i0 < counts.length; i0++) {
        initial['#' + counts[i0].id] = { make: counts[i0].make, attempt: counts[i0].attempt };
      }

      // 操作履歴は必ず存在する id を対象とする（2-2 の取り決め）。
      var history = [];
      for (var h0 = 0; h0 < historySpecs.length; h0++) {
        var hid = initialIds[historySpecs[h0].slot % initialIds.length];
        history.push({ drillId: hid, type: historySpecs[h0].type });
      }

      assertAligned(menu, counts, '初期状態');

      var removedIds = {};   // 削除された id
      var addedIds = [];     // ADD で払い出された id
      /* セッション中に一度でも使った id の高水位。状態を持つ層（タスク 10.1 /
       * 10.3）が保持し、ADD のたびに addDrill の reservedIds へ渡す想定を
       * ここで再現する（app.js 2-3 (d) の申し送り）。 */
      var everUsedIds = initialIds.slice();

      for (var i = 0; i < ops.length; i++) {
        var op = ops[i];
        var kind = menuOpKindOf(op);
        var drills = menu.drills;
        var ids = idsOfDrills(drills);
        var where = '操作 #' + i + ' (' + kind + ', N=' + ids.length + ')';
        var menuBefore = JSON.parse(JSON.stringify(menu));
        var countsBefore = cloneCounts(counts);
        var historyAtStep = cloneHistory(history);

        if (kind === 'REORDER') {
          var ordered = permuteIds(ids, op.keys);
          var rr = assert.throwsNot(function () {
            return reorderDrills(menuBefore, ordered);
          }, 'reorderDrills は例外を送出しない: ' + where);
          assert.ok(rr.ok === true,
            where + ': 置換の並べ替えが拒否された: ' + assert.format(rr.reason));
          assert.deepEqualOk(idsOfDrills(rr.menu.drills), ordered,
            where + ': 並べ替え後の id 列が指定と一致しない');
          // 要件 17-2: 既存種目の id 集合が変化しない（順序のみが変わる）。
          assert.deepEqualOk(idsOfDrills(rr.menu.drills).slice().sort(function (a, b) { return a - b; }),
            ids.slice().sort(function (a, b) { return a - b; }),
            where + ': 並べ替えで id 集合が変化した');

          menu = rr.menu;
          counts = assert.throwsNot(function () {
            return reorderCounts(countsBefore, ordered);
          }, 'reorderCounts は例外を送出しない: ' + where);

          // 要件 17-3: 並べ替えの前後で各 id の Make / Attempt が不変。
          for (var c = 0; c < countsBefore.length; c++) {
            var moved = countOfId(counts, countsBefore[c].id);
            assert.ok(moved !== null, where + ': 並べ替えでカウントが失われた: id=' + countsBefore[c].id);
            assert.deepEqualOk(moved, countsBefore[c],
              where + ': 並べ替えで id=' + countsBefore[c].id + ' のカウントが変化した');
          }
          assertAligned(menu, counts, where);
          // 並べ替えは操作履歴に触れない（要件 17-3: 操作履歴を維持する）。
          assert.deepEqualOk(history, historyAtStep, where + ': 並べ替えで操作履歴が変化した');

        } else if (kind === 'REMOVE') {
          if (ids.length <= DRILL_MIN) {
            // 残数が 1 の状態からは削除しない（要件 17-4 の下限）。
            // 関数側も LAST_DRILL で拒否し、内容を変えないことを確認する。
            var reject = removeDrill(menuBefore, ids[0]);
            assert.ok(reject.ok === false && reject.reason === 'LAST_DRILL',
              where + ': 最後の種目の削除が拒否されない: ' + assert.format(reject.reason));
            assert.deepEqualOk(reject.menu, menuBefore,
              where + ': LAST_DRILL 拒否でメニューが変化した');
            continue;
          }
          var targetId = ids[op.slot % ids.length];
          var expectedIndex = ids.indexOf(targetId);
          var historyBefore = historyAtStep;

          var rm = assert.throwsNot(function () {
            return removeDrill(menuBefore, targetId);
          }, 'removeDrill は例外を送出しない: ' + where);
          assert.ok(rm.ok === true, where + ': 削除が拒否された: ' + assert.format(rm.reason));
          assert.ok(rm.index === expectedIndex,
            where + ': 削除位置が一致しない: ' + rm.index + ' !== ' + expectedIndex);
          assert.ok(rm.drill !== null && rm.drill.id === targetId,
            where + ': 削除された種目の id が一致しない');
          // 要件 17-2: 他種目の id は変化しない。
          var expectedIds = ids.slice(0, expectedIndex).concat(ids.slice(expectedIndex + 1));
          assert.deepEqualOk(idsOfDrills(rm.menu.drills), expectedIds,
            where + ': 削除後の id 列が一致しない');

          menu = rm.menu;
          var pg = assert.throwsNot(function () {
            return purgeDrillCounts(countsBefore, historyBefore, targetId);
          }, 'purgeDrillCounts は例外を送出しない: ' + where);
          counts = pg.counts;
          history = pg.history;
          removedIds['#' + targetId] = true;

          // 要件 17-12: 当該 id のカウントと操作履歴要素が残らない。
          assert.ok(countOfId(counts, targetId) === null,
            where + ': 削除した id のカウントが残った: id=' + targetId);
          for (var hh = 0; hh < history.length; hh++) {
            assert.ok(history[hh].drillId !== targetId,
              where + ': 削除した id の操作履歴要素が残った: id=' + targetId);
          }
          // 他種目の Make / Attempt は不変。
          for (var k = 0; k < countsBefore.length; k++) {
            if (countsBefore[k].id === targetId) { continue; }
            assert.deepEqualOk(countOfId(counts, countsBefore[k].id), countsBefore[k],
              where + ': 他種目 id=' + countsBefore[k].id + ' のカウントが変化した');
          }
          // 削除対象以外の履歴要素は順序ごと保存される。
          var expectedHistory = [];
          for (var e = 0; e < historyBefore.length; e++) {
            if (historyBefore[e].drillId !== targetId) { expectedHistory.push(historyBefore[e]); }
          }
          assert.deepEqualOk(history, expectedHistory,
            where + ': 削除対象以外の操作履歴が変化した');
          assertAligned(menu, counts, where);

        } else {
          /* ADD: 呼び出し側が保持する「一度でも使った id」を reservedIds に渡す。
           * 現在の counts / operations に現れる id だけでは、削除済み id を
           * 参照する履歴要素まで消えている場合（要件 17-12 の通常経路）に
           * 削除済み id が再利用され得る（app.js 2-3 (d)）。 */
          var reserved = everUsedIds.slice();
          for (var rc = 0; rc < counts.length; rc++) { reserved.push(counts[rc].id); }
          for (var rh = 0; rh < history.length; rh++) { reserved.push(history[rh].drillId); }

          var ad = assert.throwsNot(function () {
            return addDrill(menuBefore, { name: '追加種目', section: '', targetMake: op.targetMake },
              reserved);
          }, 'addDrill は例外を送出しない: ' + where);
          assert.ok(ad.ok === true, where + ': 追加が拒否された: ' + assert.format(ad.reason));
          assert.ok(Number.isInteger(ad.drill.id) && ad.drill.id >= 1,
            where + ': 払い出された id が 1 以上の整数でない: ' + assert.format(ad.drill.id));
          // 既存 id と重複しない（Property 11 の主張）。
          assert.ok(ids.indexOf(ad.drill.id) === -1,
            where + ': 払い出された id が既存 id と重複した: ' + ad.drill.id);
          // 削除済み id も再利用しない（reserved に含めているため）。
          assert.ok(!removedIds['#' + ad.drill.id],
            where + ': 払い出された id が削除済み id と重複した: ' + ad.drill.id);
          assert.ok(ad.index === ids.length,
            where + ': 追加位置が末尾でない: ' + ad.index);
          assert.deepEqualOk(idsOfDrills(ad.menu.drills), ids.concat([ad.drill.id]),
            where + ': 追加後の id 列が一致しない');

          menu = ad.menu;
          var ac = assert.throwsNot(function () {
            return addDrillCounts(countsBefore, ad.drill.id);
          }, 'addDrillCounts は例外を送出しない: ' + where);
          counts = ac.counts;
          addedIds.push(ad.drill.id);
          everUsedIds.push(ad.drill.id);

          // 要件 17-13: 追加種目は Make / Attempt 0、他種目は不変。
          assert.deepEqualOk(ac.added, { id: ad.drill.id, make: 0, attempt: 0 },
            where + ': 追加種目のカウントが 0 で始まらない');
          for (var m = 0; m < countsBefore.length; m++) {
            assert.deepEqualOk(countOfId(counts, countsBefore[m].id), countsBefore[m],
              where + ': 追加で他種目 id=' + countsBefore[m].id + ' のカウントが変化した');
          }
          assertAligned(menu, counts, where);
        }
      }

      /* ---- 操作列の後の主張（Property 11 の本文）---- */

      var finalIds = idsOfDrills(menu.drills);
      assert.ok(finalIds.length >= DRILL_MIN, '種目数が 1 未満になった: ' + finalIds.length);
      assertAligned(menu, counts, '操作列の後');

      for (var f = 0; f < finalIds.length; f++) {
        var id = finalIds[f];
        var cur = countOfId(counts, id);
        assert.ok(cur !== null, '残存 id のカウントが無い: id=' + id);
        var init = initial['#' + id];
        if (init) {
          // 残存する id の Make / Attempt は初期値と一致する。
          assert.deepEqualOk({ make: cur.make, attempt: cur.attempt }, init,
            '残存 id=' + id + ' の Make / Attempt が初期値と一致しない');
          assert.ok(!removedIds['#' + id], '削除した id が残存している: id=' + id);
        } else {
          // ADD で追加された id は Make / Attempt 0。
          assert.ok(addedIds.indexOf(id) !== -1, '由来不明の id が現れた: id=' + id);
          assert.deepEqualOk({ make: cur.make, attempt: cur.attempt }, { make: 0, attempt: 0 },
            '追加 id=' + id + ' の Make / Attempt が 0 でない');
        }
      }

      // 削除された id のカウントと操作履歴要素は残らない（要件 17-12）。
      var removedKeys = Object.keys(removedIds);
      for (var rk = 0; rk < removedKeys.length; rk++) {
        var goneId = Number(removedKeys[rk].slice(1));
        assert.ok(finalIds.indexOf(goneId) === -1, '削除した id がメニューに残った: id=' + goneId);
        assert.ok(countOfId(counts, goneId) === null, '削除した id のカウントが残った: id=' + goneId);
        for (var hq = 0; hq < history.length; hq++) {
          assert.ok(history[hq].drillId !== goneId,
            '削除した id の操作履歴要素が残った: id=' + goneId);
        }
      }

      // 残る履歴要素はすべて残存する種目を対象とする。
      for (var hf = 0; hf < history.length; hf++) {
        assert.ok(finalIds.indexOf(history[hf].drillId) !== -1,
          '操作履歴が存在しない種目を参照している: id=' + history[hf].drillId);
      }
      return true;
    }, { runs: 200 });
})();
