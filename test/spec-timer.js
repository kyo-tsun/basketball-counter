/*
 * voice-shot-counter-pwa — test/spec-timer.js
 *
 * Property 12（経過時間の単調非減少と上限飽和）のプロパティテスト。
 *
 * 要件 16-4: ビルド工程を持たないため、本ファイルはクラシックスクリプトであり
 * `import` / `export` を含まない。tests.html から読み込まれた時点で自身の
 * テストを実行し、結果を pbt.results に積む。
 *
 * 検証対象は純粋関数 `elapsedFrom` / `formatElapsed` のみである。
 * 現在時刻は引数で受け取るため、タイマーのモックも Date の差し替えも不要。
 */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window : globalThis;
  var pbt = G.pbt;
  var assert = G.assert;
  var hook = G.__VSC_TEST__;

  var REQUIRED = ['elapsedFrom', 'formatElapsed', 'LIMITS'];
  var missing = [];
  for (var r = 0; r < REQUIRED.length; r++) {
    if (!hook || !hook[REQUIRED[r]]) { missing.push(REQUIRED[r]); }
  }
  if (missing.length > 0) {
    pbt.test('spec-timer.js: window.__VSC_TEST__ の前提', function () {
      assert.fail('公開フックに ' + missing.join(' / ') + ' が無い');
    });
    return;
  }

  var elapsedFrom = hook.elapsedFrom;
  var formatElapsed = hook.formatElapsed;
  var LIMITS = hook.LIMITS;

  var ELAPSED_MAX = LIMITS.ELAPSED_SEC_MAX; // 86399

  var gen = pbt.gen;

  function isInt(v) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v;
  }

  /* ========================================================================
   * Property 12: 経過時間の単調非減少と上限飽和（要件 11-9, 11-3, 11-8）
   * ------------------------------------------------------------------------
   * 現在時刻の増分に「正の値・0・負の値（時計の後退）・86400 秒を超える巨大
   * ジャンプ」を混在させ、一時停止累計時間も列として与える。
   * ====================================================================== */

  // ミリ秒単位の増分。0 と負値と巨大ジャンプを意図的に高頻度で混ぜる。
  var deltaGen = gen.frequency([
    [4, gen.int(0, 3000)],                       // 通常の進み（0 を含む）
    [2, gen.int(-3000, 0)],                      // 時計の後退
    [1, gen.int(-200000000, -1000000)],          // 大幅な後退
    [2, gen.int(86400000, 200000000)],           // 86400 秒を超える巨大ジャンプ
    [1, gen.oneOf([0, 1, -1, 999, 1000, 86399000, 86400000])]
  ]);

  var timerInputGen = gen.record({
    startedAtMs: gen.oneOf([0, 1000, 1758000000000, -5000]),
    deltas: gen.array(deltaGen, 1, 200),
    pausedDeltas: gen.array(gen.frequency([
      [5, gen.const(0)],
      [2, gen.int(0, 5000)],
      [1, gen.int(-5000, 0)]
    ]), 1, 200)
  });

  pbt.forAll('Property 12: 経過時間の単調非減少と上限飽和',
    [timerInputGen],
    function (input) {
      var startedAt = input.startedAtMs;
      var now = startedAt;
      var paused = 0;
      var last = 0;
      var series = [];
      var saturatedAt = -1;

      for (var i = 0; i < input.deltas.length; i++) {
        now += input.deltas[i];
        paused += input.pausedDeltas[i % input.pausedDeltas.length];

        var value = assert.throwsNot(function () {
          return elapsedFrom(startedAt, paused, last, now);
        }, 'elapsedFrom が例外を送出した');

        assert.ok(isInt(value), 'i=' + i + ': 整数でない: ' + value);
        assert.ok(value >= 0 && value <= ELAPSED_MAX,
          'i=' + i + ': 0〜' + ELAPSED_MAX + ' の範囲外: ' + value);
        assert.ok(value >= last,
          'i=' + i + ': 単調非減少を破った（直前 ' + last + ' → ' + value + '）');

        if (saturatedAt >= 0) {
          assert.ok(value === ELAPSED_MAX,
            'i=' + i + ': 一度 ' + ELAPSED_MAX + ' に達した後に ' + value + ' へ戻った');
        } else if (value === ELAPSED_MAX) {
          saturatedAt = i;
        }

        series.push(value);
        last = value;
      }

      // formatElapsed の形式（要件 11-3）
      for (var k = 0; k < series.length; k++) {
        var text = formatElapsed(series[k]);
        if (series[k] < 3600) {
          assert.ok(/^\d{2}:\d{2}$/.test(text),
            series[k] + ' 秒が mm:ss 形式でない: ' + text);
        } else {
          assert.ok(/^\d{1,2}:\d{2}:\d{2}$/.test(text),
            series[k] + ' 秒が h:mm:ss 形式でない: ' + text);
        }
      }
      return true;
    },
    { runs: 200 });

  /* ========================================================================
   * 例示テスト
   * ====================================================================== */

  pbt.test('formatElapsed: 境界と書式の例示（要件 11-3）', function () {
    var cases = [
      [0, '00:00'],
      [9, '00:09'],
      [59, '00:59'],
      [60, '01:00'],
      [599, '09:59'],
      [3599, '59:59'],
      [3600, '1:00:00'],
      [3661, '1:01:01'],
      [86399, '23:59:59'],
      // 値域外・非整数は 0〜86399 へ畳む（全域性）
      [86400, '23:59:59'],
      [-1, '00:00'],
      [1.9, '00:01'],
      [NaN, '00:00'],
      [undefined, '00:00'],
      ['60', '00:00']
    ];
    for (var i = 0; i < cases.length; i++) {
      var actual = formatElapsed(cases[i][0]);
      assert.ok(actual === cases[i][1],
        assert.format(cases[i][0]) + ' -> ' + actual + '（期待 ' + cases[i][1] + '）');
    }
    return true;
  });

  pbt.test('elapsedFrom: 一時停止累計と直前値の扱い（要件 11-5, 11-8, 11-9）', function () {
    var t0 = 1758000000000;

    // 一時停止累計分は経過時間から差し引く
    assert.ok(elapsedFrom(t0, 0, 0, t0 + 10000) === 10,
      '一時停止 0 のときの経過秒が 10 でない');
    assert.ok(elapsedFrom(t0, 4000, 0, t0 + 10000) === 6,
      '一時停止 4 秒分が差し引かれない');

    // 時計が後退しても直前値を下回らない
    assert.ok(elapsedFrom(t0, 0, 30, t0 - 60000) === 30,
      '時計の後退で直前値を下回った');

    // 巨大ジャンプは 86399 で飽和する
    assert.ok(elapsedFrom(t0, 0, 0, t0 + 999999999) === 86399,
      '巨大ジャンプが 86399 に飽和しない');

    // 86399 に達した後は増加しない
    assert.ok(elapsedFrom(t0, 0, 86399, t0 + 999999999) === 86399,
      '飽和後に増加した');

    // 引数が不正でも直前値を返す（全域性）
    assert.ok(elapsedFrom(null, 0, 42, t0) === 42, '開始時刻が不正なとき直前値を返さない');
    assert.ok(elapsedFrom(t0, 0, 42, undefined) === 42, '現在時刻が不正なとき直前値を返さない');
    assert.ok(elapsedFrom(undefined, undefined, undefined, undefined) === 0,
      'すべて不正なとき 0 を返さない');
    return true;
  });
})();
