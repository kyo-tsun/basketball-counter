/*
 * voice-shot-counter-pwa — test/spec-count.js
 *
 * Property 1（Undo ラウンドトリップ）、Property 2（連続 Undo による初期状態への
 * 完全復帰）、Property 3（カウントの不変条件）のプロパティテスト。
 *
 * 要件 16-4: ビルド工程を持たないため、本ファイルはクラシックスクリプトであり
 * `import` / `export` を含まない。tests.html から読み込まれた時点で自身の
 * テストを実行し、結果を pbt.results に積む。
 *
 * 検証対象は `window.__VSC_TEST__` 経由で公開される純粋関数のみであり、
 * DOM もブラウザ API のモックも用いない。
 *
 * ============================================================================
 * counts の形（app.js 2-2 の取り決めと同一）
 * ============================================================================
 *   counts  : [{id:integer, make:0..999, attempt:0..999}, ...]  配列順 = メニュー順
 *   history : [{drillId:integer, type:'MAKE'|'MISS'}, ...]      配列順 = 実行順、最大 20
 *   これは設計「Data Models / Session_State」の `counts` / `operations` と同一で
 *   あり、タスク 7.1 のシリアライザがそのまま読み書きする形である。
 */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window : globalThis;
  var pbt = G.pbt;
  var assert = G.assert;
  var hook = G.__VSC_TEST__;

  var REQUIRED = ['applyCount', 'undoCount', 'successRate', 'totals', 'LIMITS'];
  var missing = [];
  for (var r = 0; r < REQUIRED.length; r++) {
    if (!hook || !hook[REQUIRED[r]]) { missing.push(REQUIRED[r]); }
  }
  if (missing.length > 0) {
    pbt.test('spec-count.js: window.__VSC_TEST__ の前提', function () {
      assert.fail('公開フックに ' + missing.join(' / ') + ' が無い（タスク 21.1 が公開する）');
    });
    return;
  }

  var applyCount = hook.applyCount;
  var undoCount = hook.undoCount;
  var LIMITS = hook.LIMITS;

  var COUNT_MAX = LIMITS.COUNT_MAX;                    // 999
  var HISTORY_MAX = LIMITS.OPERATION_HISTORY_MAX;      // 20
  var DRILL_MAX = LIMITS.DRILL_COUNT_MAX;              // 50

  var gen = pbt.gen;

  /* ========================================================================
   * 共通の入力ビルダ
   * ------------------------------------------------------------------------
   * 生成器は「素材」だけを作り、妥当な状態の組み立てはプロパティ本体側の
   * ビルダで行う。縮小器（pbt.gen.bind / genericShrink）が整合性を壊した値を
   * 出しても、ビルダを通すことで必ず妥当な状態になるため、意味のない反例
   * （make > attempt など app.js 側が正規化で畳む入力）が報告されない。
   * ====================================================================== */

  /**
   * 種目素材の列から counts を組み立てる。
   * id は `1 + 累積(1 + gap)` で単調増加させ、欠番のある id 集合も作る
   * （種目 id は 1 以上でメニュー内一意であればよい。設計 Data Models / Drill）。
   */
  function buildCounts(specs) {
    var out = [];
    var id = 0;
    for (var i = 0; i < specs.length; i++) {
      var s = specs[i];
      id += 1 + (s.gap | 0);
      var attempt = s.attempt;
      var make = s.make > attempt ? attempt : s.make;
      out.push({ id: id, make: make, attempt: attempt });
    }
    return out;
  }

  function idsOf(counts) {
    var out = [];
    for (var i = 0; i < counts.length; i++) { out.push(counts[i].id); }
    return out;
  }

  /** 存在しない id（全 id の最大値より大きい値）。 */
  function missingIdFor(counts, slot) {
    var max = 0;
    for (var i = 0; i < counts.length; i++) {
      if (counts[i].id > max) { max = counts[i].id; }
    }
    return max + 1 + (slot | 0);
  }

  /** 素材 slot を「存在する id」へ写す。counts は常に 1 件以上。 */
  function existingId(counts, slot) {
    var ids = idsOf(counts);
    return ids[((slot | 0) % ids.length + ids.length) % ids.length];
  }

  /** 操作履歴の素材列から history を組み立てる（対象は必ず存在する id）。 */
  function buildHistory(counts, specs) {
    var out = [];
    var n = Math.min(specs.length, HISTORY_MAX);
    for (var i = 0; i < n; i++) {
      out.push({ drillId: existingId(counts, specs[i].slot), type: specs[i].type });
    }
    return out;
  }

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
   * 不変条件 `0 ≤ make ≤ attempt ≤ 999`（要件 4-3, 4-4）と 3 フィールド限定を主張する。
   * Property 3 の中核であり、Property 1 / 2 の各ステップでも呼ぶ。
   */
  function assertCountInvariant(counts, where) {
    assert.ok(Array.isArray(counts), where + ': counts が配列でない');
    for (var i = 0; i < counts.length; i++) {
      var c = counts[i];
      var at = where + ': counts[' + i + ']';
      assert.ok(c !== null && typeof c === 'object' && !Array.isArray(c), at + ' が要素オブジェクトでない');
      var keys = Object.keys(c).sort().join(',');
      assert.ok(keys === 'attempt,id,make', at + ' の想定外のフィールド: ' + keys);
      assert.ok(Number.isInteger(c.make), at + '.make が整数でない: ' + assert.format(c.make));
      assert.ok(Number.isInteger(c.attempt), at + '.attempt が整数でない: ' + assert.format(c.attempt));
      assert.ok(c.make >= 0, at + '.make が負: ' + c.make);
      assert.ok(c.make <= c.attempt, at + ': make > attempt (' + c.make + ' > ' + c.attempt + ')');
      assert.ok(c.attempt <= COUNT_MAX, at + '.attempt が上限超過: ' + c.attempt);
    }
    return true;
  }

  /** 操作履歴の不変条件（要件 5-1, 5-2, 5-6）。 */
  function assertHistoryInvariant(history, where) {
    assert.ok(Array.isArray(history), where + ': history が配列でない');
    assert.ok(history.length <= HISTORY_MAX,
      where + ': history が 20 件を超えた: ' + history.length);
    for (var i = 0; i < history.length; i++) {
      var e = history[i];
      var at = where + ': history[' + i + ']';
      var keys = Object.keys(e).sort().join(',');
      assert.ok(keys === 'drillId,type', at + ' の想定外のフィールド: ' + keys);
      assert.ok(Number.isInteger(e.drillId), at + '.drillId が整数でない');
      assert.ok(e.type === 'MAKE' || e.type === 'MISS', at + '.type が計数種別でない: ' + assert.format(e.type));
    }
    return true;
  }

  /* ------------------------------------------------------------------ 生成器 */

  // attempt は 0〜999 の一様分布と 995〜999 に寄せた分布の混合（Property 1 の指定）。
  var attemptGen = gen.frequency([
    [6, gen.int(0, COUNT_MAX)],
    [4, gen.int(COUNT_MAX - 4, COUNT_MAX)]
  ]);

  var drillSpecGen = gen.record({
    gap: gen.frequency([[8, gen.const(0)], [2, gen.int(1, 3)]]),
    attempt: attemptGen,
    make: gen.int(0, COUNT_MAX)
  });

  // 種目数 N は 1〜50。小さい N を厚めに引く（1 件・少数件は境界が濃い）。
  var countsSpecsGen = gen.frequency([
    [5, gen.array(drillSpecGen, 1, 6)],
    [3, gen.array(drillSpecGen, 1, 16)],
    [2, gen.array(drillSpecGen, 1, DRILL_MAX)]
  ]);

  var typeGen = gen.oneOf(['MAKE', 'MISS']);
  var slotGen = gen.int(0, DRILL_MAX + 9);

  var historySpecsGen = gen.array(
    gen.record({ slot: slotGen, type: typeGen }), 0, HISTORY_MAX);

  /* ========================================================================
   * Property 1: Undo ラウンドトリップ
   * ====================================================================== */

  // 対象種目 id: 存在する id を主に、存在しない id を低頻度で混入（Property 1 の指定）。
  var opGen = gen.record({
    type: typeGen,
    slot: slotGen,
    missing: gen.frequency([[9, gen.const(false)], [1, gen.const(true)]])
  });

  // Feature: voice-shot-counter-pwa, Property 1: Undo ラウンドトリップ — *For any* カウント状態 S と任意の計数操作 op について、S に op を適用した直後に 1 回の取り消しを適用した結果は S と一致する。op が計数上限により拒否された場合は適用結果自体が S と一致し、取り消しは適用前の履歴末尾のみを対象とする。
  // Validates: Requirements 5.10, 5.3, 4.13
  pbt.forAll('Property 1: Undo ラウンドトリップ',
    [countsSpecsGen, historySpecsGen, opGen],
    function (drillSpecs, historySpecs, op) {
      var counts = buildCounts(drillSpecs);
      var history = buildHistory(counts, historySpecs);
      var drillId = op.missing ? missingIdFor(counts, op.slot) : existingId(counts, op.slot);

      // 引数を書き換えないこと（純粋性）を確認するための適用前スナップショット。
      var countsBefore = cloneCounts(counts);
      var historyBefore = cloneHistory(history);

      var r = assert.throwsNot(function () {
        return applyCount(counts, history, op.type, drillId);
      }, 'applyCount は例外を送出しない');

      assert.deepEqualOk(counts, countsBefore, 'applyCount が引数の counts を書き換えた');
      assert.deepEqualOk(history, historyBefore, 'applyCount が引数の history を書き換えた');
      assertCountInvariant(r.counts, 'applyCount 直後');
      assertHistoryInvariant(r.history, 'applyCount 直後');

      var idx = -1;
      for (var i = 0; i < counts.length; i++) {
        if (counts[i].id === drillId) { idx = i; break; }
      }

      // 他種目の make / attempt が変化しない（要件 4-1, 4-2）。
      assert.ok(r.counts.length === counts.length, '種目数が変化した');
      for (var k = 0; k < counts.length; k++) {
        if (k === idx) { continue; }
        assert.deepEqualOk(r.counts[k], countsBefore[k],
          '他種目 counts[' + k + '] が変化した');
      }

      if (r.ok) {
        assert.ok(idx >= 0, '存在しない種目への操作を受理した: ' + drillId);
        assert.ok(r.rejected === null && r.reason === null, '受理時に拒否理由が付いた');

        // 対象種目の変化は要件どおり（成功は両方 +1、失敗は attempt のみ +1）。
        var before = countsBefore[idx];
        var after = r.counts[idx];
        assert.ok(after.attempt === before.attempt + 1,
          'attempt が 1 加算されていない: ' + before.attempt + ' -> ' + after.attempt);
        assert.ok(after.make === before.make + (op.type === 'MAKE' ? 1 : 0),
          'make の加算が種別と一致しない: ' + before.make + ' -> ' + after.make);

        // 履歴には当該操作が末尾に 1 件積まれる（要件 5-1, 5-2）。
        assert.deepEqualOk(r.history[r.history.length - 1], { drillId: drillId, type: op.type },
          '履歴末尾が当該操作でない');

        // --- ラウンドトリップ本体（要件 5-10, 5-3）---
        var u = assert.throwsNot(function () {
          return undoCount(r.counts, r.history);
        }, 'undoCount は例外を送出しない');
        assert.ok(u.ok === true, '直前の操作を取り消せない: ' + assert.format(u.reason));
        assertCountInvariant(u.counts, 'undoCount 直後');
        assertHistoryInvariant(u.history, 'undoCount 直後');

        // counts は常に S と完全に一致する（アクティブ種目と無関係に対象種目が戻る）。
        assert.deepEqualOk(u.counts, countsBefore, 'Undo 後の counts が S と一致しない');

        /* history は、適用時に 20 件上限による最古 1 件の除去が起きた場合のみ
         * 先頭 1 件を失う（要件 5-6: 除去された操作は取り消しの対象から外れ、
         * 以後どれだけ取り消しても復元されない）。19 件以下なら完全に一致する。 */
        if (historyBefore.length >= HISTORY_MAX) {
          assert.ok(r.evicted !== null, '20 件の履歴への追加で最古 1 件が除去されていない');
          assert.deepEqualOk(r.evicted, historyBefore[0], '除去された履歴要素が最古でない');
          assert.deepEqualOk(u.history, historyBefore.slice(1),
            'Undo 後の history が「最古 1 件を失った S の履歴」と一致しない');
        } else {
          assert.ok(r.evicted === null, '20 件未満の履歴で要素が除去された');
          assert.deepEqualOk(u.history, historyBefore, 'Undo 後の history が S と一致しない');
        }
      } else {
        // 拒否時は適用結果自体が S と一致する（要件 4-13）。
        assert.deepEqualOk(r.counts, countsBefore, '拒否時に counts が変化した');
        assert.deepEqualOk(r.history, historyBefore, '拒否時に history が変化した');
        assert.ok(r.entry === null, '拒否時に操作履歴要素が作られた');
        assert.ok(r.evicted === null, '拒否時に履歴要素が除去された');

        if (r.rejected === 'CEILING') {
          assert.ok(idx >= 0 && countsBefore[idx].attempt === COUNT_MAX,
            'CEILING 拒否なのに attempt が 999 でない');
        } else {
          assert.ok(r.rejected === 'UNKNOWN_DRILL',
            '想定外の拒否理由: ' + assert.format(r.rejected));
          assert.ok(idx === -1, 'UNKNOWN_DRILL 拒否なのに該当種目が存在する');
        }

        // 拒否後の取り消しは「適用前の履歴末尾」のみを対象とする。
        var u2 = undoCount(r.counts, r.history);
        if (historyBefore.length === 0) {
          assert.ok(u2.ok === false && u2.reason === 'EMPTY_HISTORY',
            '履歴 0 件の取り消しが EMPTY_HISTORY でない');
        } else {
          assert.ok(u2.ok === true, '拒否後の取り消しが受理されない');
          assert.deepEqualOk(u2.entry, historyBefore[historyBefore.length - 1],
            '取り消し対象が適用前の履歴末尾でない');
          assert.deepEqualOk(u2.history, historyBefore.slice(0, historyBefore.length - 1),
            '取り消しが履歴末尾 1 件以外を変更した');
        }
      }
      return true;
    }, { runs: 200 });

  /* ========================================================================
   * Property 2: 連続 Undo による初期状態への完全復帰
   * ====================================================================== */

  var opListGen = gen.array(gen.record({ type: typeGen, slot: slotGen }), 0, HISTORY_MAX);

  // Feature: voice-shot-counter-pwa, Property 2: 連続 Undo による初期状態への完全復帰 — *For any* 初期カウント状態 S₀ と長さ k（0 ≤ k ≤ 20）の計数操作列について、k 個の操作を順に適用した後に k 回の取り消しを適用した結果は S₀ と一致し、操作履歴は 0 件になる。
  // Validates: Requirements 5.4, 5.5, 5.6
  pbt.forAll('Property 2: 連続 Undo による初期状態への完全復帰',
    [countsSpecsGen, opListGen],
    function (drillSpecs, ops) {
      var initialCounts = buildCounts(drillSpecs);
      var s0Counts = cloneCounts(initialCounts);

      // S₀ は操作履歴 0 件の初期カウント状態（Property 2 の指定）。
      var curCounts = initialCounts;
      var curHistory = [];

      /* 受理された操作数を数える。計数上限で拒否された操作は履歴に積まれない
       * （要件 4-13）ため取り消し回数に数えない。操作列の長さは 20 以下であり、
       * 履歴 0 件から始まるので 20 件上限による最古要素の除去は起こらない
       * （＝受理された操作はすべて取り消せる。要件 5-6 との整合）。 */
      var accepted = 0;
      for (var i = 0; i < ops.length; i++) {
        var drillId = existingId(curCounts, ops[i].slot);
        var beforeCounts = cloneCounts(curCounts);
        var beforeHistory = cloneHistory(curHistory);

        var r = applyCount(curCounts, curHistory, ops[i].type, drillId);
        assertCountInvariant(r.counts, '適用 #' + i);
        assertHistoryInvariant(r.history, '適用 #' + i);
        assert.ok(r.evicted === null, '20 件以下の操作列で履歴要素が除去された（#' + i + '）');

        if (r.ok) {
          accepted++;
        } else {
          assert.ok(r.reason === 'CEILING', '想定外の拒否理由: ' + assert.format(r.reason));
          assert.deepEqualOk(r.counts, beforeCounts, '拒否時に counts が変化した（#' + i + '）');
          assert.deepEqualOk(r.history, beforeHistory, '拒否時に history が変化した（#' + i + '）');
        }
        curCounts = r.counts;
        curHistory = r.history;
      }

      assert.ok(curHistory.length === accepted,
        '履歴件数が受理された操作数と一致しない: ' + curHistory.length + ' !== ' + accepted);

      for (var u = 0; u < accepted; u++) {
        var res = undoCount(curCounts, curHistory);
        assert.ok(res.ok === true,
          '受理された操作数に満たない取り消しで拒否された（#' + u + '）: ' + assert.format(res.reason));
        assertCountInvariant(res.counts, '取り消し #' + u);
        assertHistoryInvariant(res.history, '取り消し #' + u);
        assert.ok(res.history.length === accepted - u - 1,
          '1 回の取り消しで履歴が 1 件だけ減っていない（#' + u + '）: ' + res.history.length);
        curCounts = res.counts;
        curHistory = res.history;
      }

      // 初期状態への完全復帰（要件 5-4）。
      assert.deepEqualOk(curCounts, s0Counts, '連続取り消し後の counts が S₀ と一致しない');
      assert.ok(curHistory.length === 0, '連続取り消し後の履歴が 0 件でない: ' + curHistory.length);

      // k+1 回目の取り消しは EMPTY_HISTORY を返し状態を変えない（要件 5-5）。
      var extra = undoCount(curCounts, curHistory);
      assert.ok(extra.ok === false, '履歴 0 件の取り消しが受理された');
      assert.ok(extra.reason === 'EMPTY_HISTORY',
        '履歴 0 件の拒否理由が EMPTY_HISTORY でない: ' + assert.format(extra.reason));
      assert.deepEqualOk(extra.counts, s0Counts, 'EMPTY_HISTORY 拒否で counts が変化した');
      assert.ok(extra.history.length === 0, 'EMPTY_HISTORY 拒否で history が変化した');
      return true;
    }, { runs: 200 });

  /* ========================================================================
   * Property 3: カウントの不変条件
   * ====================================================================== */

  /* 長さ 0〜200 の MAKE / MISS / UNDO 混在列。`focus` が真のときは全操作を
   * 同一種目へ向け、同一種目への連続加算が 999 の上限に達する列を意図的に作る
   * （Property 3 の生成器の指定）。 */
  var longOpListGen = gen.frequency([
    [5, gen.array(gen.record({
      kind: gen.frequency([[4, gen.const('MAKE')], [3, gen.const('MISS')], [3, gen.const('UNDO')]]),
      slot: slotGen
    }), 0, 60)],
    [5, gen.array(gen.record({
      kind: gen.frequency([[5, gen.const('MAKE')], [4, gen.const('MISS')], [1, gen.const('UNDO')]]),
      slot: slotGen
    }), 0, 200)]
  ]);

  // Feature: voice-shot-counter-pwa, Property 3: カウントの不変条件 — *For any* 初期カウント状態と任意の長さの操作列（成功・失敗・取り消しの混在）について、操作列の全ステップ実行後の各時点で、選択中メニューの全種目が `0 ≤ Make ≤ Attempt ≤ 999` を満たす。
  // Validates: Requirements 4.3, 4.4
  pbt.forAll('Property 3: カウントの不変条件',
    [countsSpecsGen, historySpecsGen, longOpListGen, gen.bool()],
    function (drillSpecs, historySpecs, ops, focus) {
      var curCounts = buildCounts(drillSpecs);
      var curHistory = buildHistory(curCounts, historySpecs);

      assertCountInvariant(curCounts, '初期状態');

      for (var i = 0; i < ops.length; i++) {
        var step = ops[i];
        var r;
        if (step.kind === 'UNDO') {
          r = assert.throwsNot(function () {
            return undoCount(curCounts, curHistory);
          }, 'undoCount は例外を送出しない（#' + i + '）');
        } else {
          var drillId = existingId(curCounts, focus ? 0 : step.slot);
          r = assert.throwsNot((function (id, kind) {
            return function () { return applyCount(curCounts, curHistory, kind, id); };
          })(drillId, step.kind), 'applyCount は例外を送出しない（#' + i + '）');
        }

        // 各ステップ直後の不変条件（要件 4-3, 4-4）。
        assertCountInvariant(r.counts, 'ステップ #' + i + ' (' + step.kind + ') 直後');
        assertHistoryInvariant(r.history, 'ステップ #' + i + ' (' + step.kind + ') 直後');
        assert.ok(r.counts.length === curCounts.length,
          'ステップ #' + i + ' で種目数が変化した');

        curCounts = r.counts;
        curHistory = r.history;
      }
      return true;
    }, { runs: 300 });

  /* 復元経路（`deserializeSession`）についても同一の不変条件が成立する、という
   * Property 3 後段の主張は復元関数の実装（タスク 7.1）を前提とする。実装済みの
   * ときだけ同じ不変条件を当てる（未実装の間は登録しない）。 */
  if (hook.deserializeSession && hook.DRILL_MENU) {
    var A = pbt.alphabets;
    var jsonishGen = gen.frequency([
      [3, gen.string(A.ascii, 40)],
      [2, gen.string(A.mixed, 40)],
      [2, gen.const('{}')],
      [1, gen.const('')],
      [1, gen.const('[]')],
      [1, gen.const('{"schemaVersion":1,"counts":[{"id":1,"make":5,"attempt":2}]}')]
    ]);

    // Feature: voice-shot-counter-pwa, Property 3: カウントの不変条件（復元経路）
    // Validates: Requirements 4.3, 4.4
    pbt.forAll('Property 3 後段: 復元直後のカウントの不変条件',
      [jsonishGen],
      function (json) {
        var menu = { id: 'm-default', name: '朝練125本IN', drills: hook.DRILL_MENU.slice() };
        var out = assert.throwsNot(function () {
          return hook.deserializeSession(json, menu);
        }, 'deserializeSession は例外を送出しない');
        assertCountInvariant(out.state.counts, '復元直後');
        assertHistoryInvariant(out.state.operations, '復元直後');
        return true;
      }, { runs: 300 });
  }
})();
