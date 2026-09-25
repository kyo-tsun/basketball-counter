/*
 * voice-shot-counter-pwa — test/spec-display.js
 *
 * Property 15（目標合計の整合性と進捗充填率の値域）、
 * Property 16（成功率の値域と丸めおよび未試投表示）、
 * Property 17（履歴並び順の全順序性）のプロパティテスト。
 *
 * 要件 16-4: ビルド工程を持たないため、本ファイルはクラシックスクリプトであり
 * `import` / `export` を含まない。tests.html から読み込まれた時点で自身の
 * テストを実行し、結果を pbt.results に積む。
 *
 * 表示する文字列と数値の算出はすべて純粋関数に閉じているため、本ファイルは
 * DOM にもブラウザ API にも触れない（DOM 層の検証は spec-dom.js が担う）。
 */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window : globalThis;
  var pbt = G.pbt;
  var assert = G.assert;
  var hook = G.__VSC_TEST__;

  var REQUIRED = [
    'deriveTargetTotal', 'progressRatio', 'aggregateBySection', 'totals',
    'successRate', 'formatRate', 'sortHistoryIndex', 'LIMITS'
  ];
  var missing = [];
  for (var r = 0; r < REQUIRED.length; r++) {
    if (!hook || !hook[REQUIRED[r]]) { missing.push(REQUIRED[r]); }
  }
  if (missing.length > 0) {
    pbt.test('spec-display.js: window.__VSC_TEST__ の前提', function () {
      assert.fail('公開フックに ' + missing.join(' / ') + ' が無い');
    });
    return;
  }

  var deriveTargetTotal = hook.deriveTargetTotal;
  var progressRatio = hook.progressRatio;
  var aggregateBySection = hook.aggregateBySection;
  var totals = hook.totals;
  var successRate = hook.successRate;
  var formatRate = hook.formatRate;
  var sortHistoryIndex = hook.sortHistoryIndex;
  var LIMITS = hook.LIMITS;

  var COUNT_MAX = LIMITS.COUNT_MAX;             // 999
  var DRILL_MAX = LIMITS.DRILL_COUNT_MAX;       // 50
  var TARGET_MAKE_MAX = LIMITS.TARGET_MAKE_MAX; // 99
  var TARGET_TOTAL_MAX = LIMITS.TARGET_TOTAL_MAX; // 9999

  var gen = pbt.gen;

  function isInt(v) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v;
  }

  /* ========================================================================
   * Property 15: 目標合計の整合性と進捗充填率の値域
   * （要件 8-4, 8-5, 8-10, 4-7, 4-8, 17-6）
   * ====================================================================== */

  // section に重複と空文字を含める（集約が 1 行にまとまることを確かめるため）
  var SECTIONS = ['', '近距離', 'エルボー', 'ネイル', 'アウトサイド', '', '🏀区分'];

  var drillSpecGen = gen.record({
    section: gen.oneOf(SECTIONS),
    targetMake: gen.int(1, TARGET_MAKE_MAX),
    attempt: gen.int(0, COUNT_MAX),
    make: gen.int(0, COUNT_MAX)
  });

  var menuCountsGen = gen.record({
    drillSpecs: gen.array(drillSpecGen, 1, DRILL_MAX),
    // 全体成功数が目標合計を下回る / 一致する / 大きく超える を作り分ける係数
    makeScale: gen.oneOf(['low', 'exact', 'over', 'zero', 'raw'])
  });

  /**
   * 素材から menu と counts を組み立てる。
   * id は 1 から連番。counts の配列順は drills の配列順と一致させる。
   * makeScale により「全体成功数が目標合計を下回る / 一致する / 超える」を作る。
   */
  function build(material) {
    var specs = material.drillSpecs;
    var drills = [];
    var counts = [];
    for (var i = 0; i < specs.length; i++) {
      var s = specs[i];
      var id = i + 1;
      drills.push({ id: id, section: s.section, name: '種目' + id, targetMake: s.targetMake });

      var make;
      if (material.makeScale === 'zero') {
        make = 0;
      } else if (material.makeScale === 'exact') {
        make = s.targetMake;
      } else if (material.makeScale === 'over') {
        make = Math.min(COUNT_MAX, s.targetMake * 3 + 5);
      } else if (material.makeScale === 'low') {
        make = Math.floor(s.targetMake / 2);
      } else {
        make = s.make;
      }
      var attempt = Math.max(make, s.attempt);
      if (attempt > COUNT_MAX) { attempt = COUNT_MAX; }
      if (make > attempt) { make = attempt; }
      counts.push({ id: id, make: make, attempt: attempt });
    }
    return { menu: { id: 'm-test', name: 'テストメニュー', drills: drills }, counts: counts };
  }

  pbt.forAll('Property 15: 目標合計の整合性と進捗充填率の値域',
    [menuCountsGen],
    function (material) {
      var pair = build(material);
      var menu = pair.menu;
      var counts = pair.counts;

      /* --- deriveTargetTotal は targetMake の総和（要件 8-4, 17-6）--- */
      var expectedTotal = 0;
      for (var i = 0; i < menu.drills.length; i++) {
        expectedTotal += menu.drills[i].targetMake;
      }
      var target = deriveTargetTotal(menu);
      assert.ok(target === expectedTotal,
        '目標合計が targetMake の総和と一致しない: ' + target + ' !== ' + expectedTotal);
      assert.ok(target >= 1 && target <= TARGET_TOTAL_MAX,
        '目標合計が 1〜' + TARGET_TOTAL_MAX + ' の範囲外: ' + target);

      /* --- progressRatio の値域と目標超過時の厳密な 100（要件 8-5）--- */
      var agg = totals(counts);
      var ratio = progressRatio(agg.make, target);
      assert.ok(typeof ratio === 'number' && isFinite(ratio),
        '充填率が有限の数値でない: ' + ratio);
      assert.ok(ratio >= 0 && ratio <= 100, '充填率が 0〜100 の範囲外: ' + ratio);
      assert.ok(Math.round(ratio * 10) === ratio * 10,
        '充填率が小数第 1 位まででない: ' + ratio);
      if (agg.make >= target) {
        assert.ok(ratio === 100,
          '全体成功数 ' + agg.make + ' が目標合計 ' + target + ' 以上なのに充填率が 100 でない: ' + ratio);
      }
      if (agg.make === 0) {
        assert.ok(ratio === 0, '全体成功数 0 で充填率が 0 でない: ' + ratio);
      }

      /* --- aggregateBySection の行数と保存則（要件 8-10, 17-6）--- */
      var rows = aggregateBySection(menu, counts);
      var distinct = [];
      for (var d = 0; d < menu.drills.length; d++) {
        if (distinct.indexOf(menu.drills[d].section) === -1) {
          distinct.push(menu.drills[d].section);
        }
      }
      assert.ok(rows.length === distinct.length,
        '集約行数が section の異なる値の個数と一致しない: ' + rows.length + ' !== ' + distinct.length);

      var rowSections = [];
      var sumMake = 0;
      var sumTarget = 0;
      for (var k = 0; k < rows.length; k++) {
        assert.ok(typeof rows[k].section === 'string', 'section が文字列でない');
        assert.ok(isInt(rows[k].make) && rows[k].make >= 0, 'make が 0 以上の整数でない');
        assert.ok(isInt(rows[k].targetMake) && rows[k].targetMake >= 0,
          'targetMake が 0 以上の整数でない');
        rowSections.push(rows[k].section);
        sumMake += rows[k].make;
        sumTarget += rows[k].targetMake;
      }
      // 行の並びは section が最初に現れた順
      assert.deepEqualOk(rowSections, distinct, '集約行の並びが初出順でない',
        { name: 'sections' });
      assert.ok(sumMake === agg.make,
        '集約行の Make 合計が全体成功数と一致しない: ' + sumMake + ' !== ' + agg.make);
      assert.ok(sumTarget === target,
        '集約行の targetMake 合計が目標合計と一致しない: ' + sumTarget + ' !== ' + target);
      return true;
    },
    { runs: 200 });

  pbt.test('progressRatio: 境界と全域性（要件 8-5）', function () {
    assert.ok(progressRatio(0, 125) === 0, '0 / 125 が 0 でない');
    assert.ok(progressRatio(125, 125) === 100, '125 / 125 が 100 でない');
    assert.ok(progressRatio(200, 125) === 100, '目標超過が 100 に打ち切られない');
    assert.ok(progressRatio(1, 3) === 33.3, '1 / 3 が 33.3 でない: ' + progressRatio(1, 3));
    assert.ok(progressRatio(2, 3) === 66.7, '2 / 3 が 66.7 でない: ' + progressRatio(2, 3));
    assert.ok(progressRatio(-5, 125) === 0, '負の成功数が 0 にならない');
    assert.ok(progressRatio(0, 0) === 0, '目標 0 かつ成功 0 が 0 にならない');
    assert.ok(progressRatio(3, 0) === 100, '目標 0 かつ成功ありが 100 にならない');
    assert.ok(progressRatio(undefined, undefined) === 0, '不正な引数で 0 を返さない');
    return true;
  });

  pbt.test('aggregateBySection: 同一 section の集約と空文字 section（要件 8-10, 17-6）', function () {
    var menu = {
      id: 'm', name: 'm', drills: [
        { id: 1, section: 'A', name: 'a1', targetMake: 10 },
        { id: 2, section: '', name: 'b1', targetMake: 5 },
        { id: 3, section: 'A', name: 'a2', targetMake: 7 },
        { id: 4, section: '', name: 'b2', targetMake: 3 }
      ]
    };
    var counts = [
      { id: 1, make: 4, attempt: 9 },
      { id: 2, make: 1, attempt: 2 },
      { id: 3, make: 6, attempt: 6 },
      { id: 4, make: 0, attempt: 0 }
    ];
    var rows = aggregateBySection(menu, counts);
    assert.deepEqualOk(rows, [
      { section: 'A', make: 10, targetMake: 17 },
      { section: '', make: 1, targetMake: 8 }
    ], '集約結果が期待と異なる', { name: 'rows' });

    // counts の配列順が drills と異なっても id で対応付ける
    var shuffled = [counts[3], counts[1], counts[2], counts[0]];
    assert.deepEqualOk(aggregateBySection(menu, shuffled), rows,
      'counts の配列順に依存している', { name: 'rows' });

    // 全域性
    assert.deepEqualOk(aggregateBySection(null, null), [], '不正な引数で空配列を返さない',
      { name: 'rows' });
    return true;
  });

  /* ========================================================================
   * Property 16: 成功率の値域と丸めおよび未試投表示（要件 4-5, 4-6, 14-4）
   * ====================================================================== */

  var rateInputGen = gen.record({
    attempt: gen.frequency([
      [3, gen.const(0)],                     // attempt = 0 の境界を高頻度に
      [4, gen.int(0, COUNT_MAX)],
      [2, gen.oneOf([1, 2, 3, 998, 999])]
    ]),
    // make は attempt に対する位置を選ぶ（0 / attempt / 中間）
    position: gen.frequency([
      [2, gen.const('zero')],
      [2, gen.const('full')],
      [3, gen.int(0, COUNT_MAX)]
    ])
  });

  pbt.forAll('Property 16: 成功率の値域と丸めおよび未試投表示',
    [rateInputGen],
    function (input) {
      var attempt = input.attempt;
      var make;
      if (input.position === 'zero') {
        make = 0;
      } else if (input.position === 'full') {
        make = attempt;
      } else {
        make = (attempt === 0) ? 0 : (input.position % (attempt + 1));
      }

      var rate = assert.throwsNot(function () {
        return successRate(make, attempt);
      }, 'successRate が例外を送出した');
      var text = assert.throwsNot(function () {
        return formatRate(make, attempt);
      }, 'formatRate が例外を送出した');

      if (attempt === 0) {
        assert.ok(rate === null, 'attempt = 0 で null を返さない: ' + rate);
        assert.ok(text === '--%', 'attempt = 0 の表示が --% でない: ' + text);
        return true;
      }

      var expected = Math.round(make / attempt * 1000) / 10;
      assert.ok(rate === expected,
        make + '/' + attempt + ' の成功率が ' + expected + ' でない: ' + rate);
      assert.ok(rate >= 0 && rate <= 100, '成功率が 0.0〜100.0 の範囲外: ' + rate);
      assert.ok(Math.round(rate * 10) === rate * 10, '成功率の小数部が 1 桁を超える: ' + rate);

      if (make === attempt) {
        assert.ok(rate === 100, 'make = attempt で 100.0 でない: ' + rate);
      }
      if (make === 0) {
        assert.ok(rate === 0, 'make = 0 で 0.0 でない: ' + rate);
      }

      assert.ok(/^\d{1,3}\.\d%$/.test(text),
        'formatRate が /^\\d{1,3}\\.\\d%$/ に一致しない: ' + text);
      assert.ok(text === rate.toFixed(1) + '%',
        'formatRate と successRate の表示が一致しない: ' + text + ' / ' + rate);
      return true;
    },
    { runs: 300 });

  pbt.test('formatRate: 境界と全域性（要件 4-5, 4-6, 14-4）', function () {
    var cases = [
      [[0, 0], '--%'],
      [[5, 0], '--%'],
      [[0, 1], '0.0%'],
      [[1, 1], '100.0%'],
      [[1, 3], '33.3%'],
      [[2, 3], '66.7%'],
      [[1, 8], '12.5%'],
      [[999, 999], '100.0%'],
      // 不正入力は畳む（全域性）
      [[10, 5], '100.0%'],
      [[-1, 4], '0.0%'],
      [[undefined, undefined], '--%']
    ];
    for (var i = 0; i < cases.length; i++) {
      var actual = formatRate(cases[i][0][0], cases[i][0][1]);
      assert.ok(actual === cases[i][1],
        assert.format(cases[i][0]) + ' -> ' + actual + '（期待 ' + cases[i][1] + '）');
    }
    return true;
  });

  /* ========================================================================
   * Property 17: 履歴並び順の全順序性（要件 14-2, 14-6, 12-6）
   * ====================================================================== */

  // endedAt の重複を高頻度に含める（候補を少数に絞る）
  var END_TIMES = [
    '2026-09-20T07:00:00+09:00',
    '2026-09-20T07:00:00+09:00',
    '2026-09-21T19:30:00+09:00',
    '2026-09-21T19:30:00+09:00',
    '2026-09-22T06:15:00+09:00',
    '2026-09-25T23:59:59+09:00'
  ];

  var historyGen = gen.record({
    timeIndexes: gen.array(gen.int(0, END_TIMES.length - 1), 0, 100),
    permuteSeed: gen.int(1, 100000)
  });

  /** id を一意にした履歴インデックスを組み立てる（id は 4 桁ゼロ埋めの文字列）。 */
  function buildEntries(timeIndexes) {
    var out = [];
    for (var i = 0; i < timeIndexes.length; i++) {
      var num = String(1000 + i);
      out.push({ id: 'h-' + num, endedAt: END_TIMES[timeIndexes[i]] });
    }
    return out;
  }

  /** seed から決定的な置換を返す（元の配列は変更しない）。 */
  function permute(list, seed) {
    var state = (seed >>> 0) || 1;
    function nextUnit() {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      return state / 4294967296;
    }
    var out = list.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(nextUnit() * (i + 1));
      var t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  }

  function idsOf(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) { out.push(list[i].id); }
    return out;
  }

  pbt.forAll('Property 17: 履歴並び順の全順序性',
    [historyGen],
    function (input) {
      var entries = buildEntries(input.timeIndexes);

      var sorted = assert.throwsNot(function () {
        return sortHistoryIndex(entries);
      }, 'sortHistoryIndex が例外を送出した');

      assert.ok(sorted.length === entries.length,
        '要素数が変化した: ' + sorted.length + ' !== ' + entries.length);

      /* --- 入力順の任意置換で結果の id 列が一致する --- */
      var shuffled = permute(entries, input.permuteSeed);
      assert.deepEqualOk(idsOf(sortHistoryIndex(shuffled)), idsOf(sorted),
        '入力順の置換で結果の id 列が変わった', { name: 'ids' });

      /* --- endedAt 降順 → id 降順に並ぶ --- */
      for (var i = 0; i + 1 < sorted.length; i++) {
        var a = Date.parse(sorted[i].endedAt);
        var b = Date.parse(sorted[i + 1].endedAt);
        assert.ok(a >= b, 'i=' + i + ': endedAt の降順を破った');
        if (a === b) {
          assert.ok(sorted[i].id > sorted[i + 1].id,
            'i=' + i + ': endedAt 同値で id の降順を破った（' +
            sorted[i].id + ' vs ' + sorted[i + 1].id + '）');
        }
      }

      /* --- 最古判定（endedAt 最小、同値では id 最小）が末尾要素と一致する --- */
      if (entries.length > 0) {
        var oldest = entries[0];
        for (var k = 1; k < entries.length; k++) {
          var ek = Date.parse(entries[k].endedAt);
          var eo = Date.parse(oldest.endedAt);
          if (ek < eo || (ek === eo && entries[k].id < oldest.id)) { oldest = entries[k]; }
        }
        assert.ok(sorted[sorted.length - 1] === oldest,
          '最古判定が末尾要素と一致しない（末尾 ' + sorted[sorted.length - 1].id +
          ' / 最古 ' + oldest.id + '）');
      }
      return true;
    },
    { runs: 200 });

  pbt.test('sortHistoryIndex: 例示と全域性（要件 14-2, 14-6）', function () {
    var entries = [
      { id: 'h-2', endedAt: '2026-09-20T07:00:00+09:00' },
      { id: 'h-9', endedAt: '2026-09-21T07:00:00+09:00' },
      { id: 'h-5', endedAt: '2026-09-20T07:00:00+09:00' }
    ];
    var sorted = sortHistoryIndex(entries);
    assert.deepEqualOk(
      [sorted[0].id, sorted[1].id, sorted[2].id],
      ['h-9', 'h-5', 'h-2'],
      '降順 → id 降順の並びでない', { name: 'ids' });

    // 引数は変更しない
    assert.deepEqualOk([entries[0].id, entries[1].id, entries[2].id],
      ['h-2', 'h-9', 'h-5'], '引数の配列が並べ替えられた', { name: 'ids' });

    // 数値の endedAt / id も扱える
    var numeric = sortHistoryIndex([
      { id: 2, endedAt: 1000 },
      { id: 10, endedAt: 1000 },
      { id: 1, endedAt: 2000 }
    ]);
    assert.deepEqualOk([numeric[0].id, numeric[1].id, numeric[2].id], [1, 10, 2],
      '数値の endedAt / id で降順にならない', { name: 'ids' });

    // 全域性
    assert.deepEqualOk(sortHistoryIndex(null), [], '不正な引数で空配列を返さない',
      { name: 'result' });
    assert.ok(sortHistoryIndex([]).length === 0, '空配列で 0 件を返さない');
    assert.ok(sortHistoryIndex([null, undefined, 1]).length === 3,
      '不正な要素を含む配列で要素数が保たれない');
    return true;
  });
})();
