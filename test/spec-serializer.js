/*
 * voice-shot-counter-pwa — test/spec-serializer.js
 *
 * Property 4（セッション直列化の決定性）、Property 5（同ラウンドトリップ）、
 * Property 6（復元の冪等性）、Property 7（不正入力に対する復元の全域性）、
 * Property 8（Menu_Record のラウンドトリップ）、
 * Property 9（メニュー検証条件の網羅と不正メニューの除外）のプロパティテスト。
 *
 * 要件 16-4: ビルド工程を持たないため、本ファイルはクラシックスクリプトであり
 * `import` / `export` を含まない。tests.html から読み込まれた時点で自身の
 * テストを実行し、結果を pbt.results に積む。
 *
 * 検証対象は `window.__VSC_TEST__` 経由で公開される純粋関数のみであり、
 * DOM もブラウザ API のモックも用いない。
 *
 * ============================================================================
 * 前提とする形（app.js 2-4 / 2-5 の取り決めと同一）
 * ============================================================================
 *   menu       : {id, name, drills:[{id, section, name, targetMake}, ...]}
 *   Session_State は保存される 8 フィールドのみ（hook.SESSION_FIELDS がその
 *   キー順の唯一の定義）:
 *     schemaVersion / startedAt / elapsedSec / menuId /
 *     activeIndex / counts / operations / ended
 *
 * 不正値を注入する検証では、`serializeSession` / `serializeMenus` を通すと
 * 値が妥当な範囲へ畳まれてしまうため、`JSON.stringify` で保存データを
 * 直接組み立てる（注入した違反がそのまま復元側に渡ることを保証する）。
 */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window : globalThis;
  var pbt = G.pbt;
  var assert = G.assert;
  var hook = G.__VSC_TEST__;

  var REQUIRED = [
    'serializeSession', 'deserializeSession',
    'serializeMenus', 'deserializeMenus', 'validateMenu',
    'deriveTargetTotal', 'SESSION_FIELDS', 'SCHEMA_VERSION', 'LIMITS'
  ];
  var missing = [];
  for (var r = 0; r < REQUIRED.length; r++) {
    if (!hook || !hook[REQUIRED[r]]) { missing.push(REQUIRED[r]); }
  }
  if (missing.length > 0) {
    pbt.test('spec-serializer.js: window.__VSC_TEST__ の前提', function () {
      assert.fail('公開フックに ' + missing.join(' / ') + ' が無い');
    });
    return;
  }

  var serializeSession = hook.serializeSession;
  var deserializeSession = hook.deserializeSession;
  var serializeMenus = hook.serializeMenus;
  var deserializeMenus = hook.deserializeMenus;
  var validateMenu = hook.validateMenu;
  var deriveTargetTotal = hook.deriveTargetTotal;
  var SESSION_FIELDS = hook.SESSION_FIELDS;
  var SCHEMA_VERSION = hook.SCHEMA_VERSION;
  var LIMITS = hook.LIMITS;

  var COUNT_MAX = LIMITS.COUNT_MAX;                 // 999
  var HISTORY_MAX = LIMITS.OPERATION_HISTORY_MAX;   // 20
  var ELAPSED_MAX = LIMITS.ELAPSED_SEC_MAX;         // 86399
  var MENU_NAME_MAX = LIMITS.MENU_NAME_MAX;         // 30
  var DRILL_NAME_MAX = LIMITS.DRILL_NAME_MAX;       // 40
  var SECTION_MAX = LIMITS.DRILL_SECTION_MAX;       // 20
  var TARGET_MAKE_MAX = LIMITS.TARGET_MAKE_MAX;     // 99
  var MENU_COUNT_MAX = LIMITS.MENU_COUNT_MAX;       // 20

  var gen = pbt.gen;

  /* ========================================================================
   * 共通ユーティリティ
   * ====================================================================== */

  function isInt(v) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v;
  }

  function repeat(ch, n) {
    var out = '';
    for (var i = 0; i < n; i++) { out += ch; }
    return out;
  }

  function cloneDeep(value) {
    if (Array.isArray(value)) {
      var arr = [];
      for (var i = 0; i < value.length; i++) { arr.push(cloneDeep(value[i])); }
      return arr;
    }
    if (value !== null && typeof value === 'object') {
      var out = {};
      var keys = Object.keys(value);
      for (var k = 0; k < keys.length; k++) { out[keys[k]] = cloneDeep(value[keys[k]]); }
      return out;
    }
    return value;
  }

  /** seed から決定的なキー順の置換を作る（配列の要素順は入れ替えない）。 */
  function permuteKeys(value, seed) {
    var state = (seed >>> 0) || 1;
    function nextUnit() {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      return state / 4294967296;
    }
    function walk(v) {
      if (Array.isArray(v)) {
        var arr = [];
        for (var i = 0; i < v.length; i++) { arr.push(walk(v[i])); }
        return arr;
      }
      if (v !== null && typeof v === 'object') {
        var keys = Object.keys(v);
        for (var j = keys.length - 1; j > 0; j--) {
          var t = Math.floor(nextUnit() * (j + 1));
          var tmp = keys[j]; keys[j] = keys[t]; keys[t] = tmp;
        }
        var out = {};
        for (var m = 0; m < keys.length; m++) { out[keys[m]] = walk(v[keys[m]]); }
        return out;
      }
      return v;
    }
    return walk(value);
  }

  /* ========================================================================
   * 入力ビルダ
   * ------------------------------------------------------------------------
   * 生成器は「素材」だけを作り、妥当な menu / Session_State の組み立ては
   * ビルダで行う。縮小器が整合性を壊した素材を出しても、ビルダを通すことで
   * 必ず妥当な状態になるため、意味のない反例が報告されない。
   * ====================================================================== */

  var SECTION_SAMPLES = ['', '近距離', 'エルボー', 'ネイル', 'アウトサイド', '🏀区分', 'a'];

  var drillSpecGen = gen.record({
    gap: gen.int(0, 3),
    section: gen.frequency([
      [3, gen.oneOf(SECTION_SAMPLES)],
      [2, gen.string(null, SECTION_MAX, 0)]
    ]),
    name: gen.string(null, DRILL_NAME_MAX, 1),
    targetMake: gen.int(1, TARGET_MAKE_MAX),
    attempt: gen.int(0, COUNT_MAX),
    make: gen.int(0, COUNT_MAX)
  });

  var opSpecGen = gen.record({
    drillOffset: gen.int(0, 60),
    type: gen.oneOf(['MAKE', 'MISS'])
  });

  /** 種目素材の列から Menu_Record を組み立てる（id は単調増加・欠番あり）。 */
  function buildMenu(specs, menuName, menuId) {
    var drills = [];
    var id = 0;
    for (var i = 0; i < specs.length; i++) {
      var s = specs[i];
      id += 1 + (s.gap | 0);
      drills.push({
        id: id,
        section: s.section,
        name: s.name,
        targetMake: s.targetMake
      });
    }
    return {
      id: (typeof menuId === 'string' && menuId.length > 0) ? menuId : 'm-test',
      name: menuName,
      drills: drills
    };
  }

  /** menu と素材から妥当な Session_State（8 フィールド）を組み立てる。 */
  function buildState(menu, specs, extra) {
    var drills = menu.drills;
    var n = drills.length;
    var counts = [];
    for (var i = 0; i < n; i++) {
      var attempt = specs[i].attempt;
      var make = specs[i].make > attempt ? attempt : specs[i].make;
      counts.push({ id: drills[i].id, make: make, attempt: attempt });
    }
    var operations = [];
    var ops = extra.opSpecs || [];
    for (var j = 0; j < ops.length && j < HISTORY_MAX; j++) {
      operations.push({
        drillId: drills[ops[j].drillOffset % n].id,
        type: ops[j].type
      });
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      startedAt: extra.startedAt,
      elapsedSec: extra.elapsedSec,
      menuId: menu.id,
      activeIndex: (n > 0) ? (extra.activeIndexRaw % n) : 0,
      counts: counts,
      operations: operations,
      ended: extra.ended
    };
  }

  var sessionMaterialGen = gen.record({
    drillSpecs: gen.array(drillSpecGen, 1, 12),
    menuName: gen.string(null, MENU_NAME_MAX, 1),
    opSpecs: gen.array(opSpecGen, 0, HISTORY_MAX),
    startedAt: gen.oneOf([
      null,
      '2026-09-25T06:00:00.000Z',
      '2026-09-25T15:00:00+09:00',
      ''
    ]),
    elapsedSec: gen.int(0, ELAPSED_MAX),
    activeIndexRaw: gen.int(0, 200),
    ended: gen.bool(),
    keySeed: gen.int(1, 100000)
  });

  function materialToPair(m) {
    var menu = buildMenu(m.drillSpecs, m.menuName, 'm-test');
    var state = buildState(menu, m.drillSpecs, m);
    return { menu: menu, state: state };
  }

  /** 妥当な状態であることを主張する（Property 7 の「常に妥当な状態」）。 */
  function assertValidState(state, menu, label) {
    var drills = menu.drills;
    var n = drills.length;

    assert.ok(state !== null && typeof state === 'object' && !Array.isArray(state),
      label + ': 状態がオブジェクトでない');

    var actualKeys = Object.keys(state).slice().sort();
    var expectedKeys = SESSION_FIELDS.slice().sort();
    assert.deepEqualOk(actualKeys, expectedKeys, label + ': フィールド集合が 8 個でない');

    assert.ok(state.schemaVersion === SCHEMA_VERSION, label + ': schemaVersion が現行値でない');
    assert.ok(state.startedAt === null || typeof state.startedAt === 'string',
      label + ': startedAt が文字列でも null でもない');
    assert.ok(typeof state.menuId === 'string', label + ': menuId が文字列でない');
    assert.ok(typeof state.ended === 'boolean', label + ': ended が真偽値でない');

    assert.ok(isInt(state.elapsedSec) && state.elapsedSec >= 0 && state.elapsedSec <= ELAPSED_MAX,
      label + ': elapsedSec が 0〜' + ELAPSED_MAX + ' の整数でない: ' + state.elapsedSec);

    var maxIndex = (n > 0) ? (n - 1) : 0;
    assert.ok(isInt(state.activeIndex) && state.activeIndex >= 0 && state.activeIndex <= maxIndex,
      label + ': activeIndex が 0〜' + maxIndex + ' の整数でない: ' + state.activeIndex);

    assert.ok(Array.isArray(state.counts) && state.counts.length === n,
      label + ': counts の要素数が種目数 ' + n + ' と一致しない');

    var idSet = Object.create(null);
    for (var i = 0; i < n; i++) {
      var c = state.counts[i];
      assert.ok(c !== null && typeof c === 'object', label + ': counts[' + i + '] がオブジェクトでない');
      assert.ok(c.id === drills[i].id,
        label + ': counts[' + i + '].id が menu.drills[' + i + '].id と一致しない');
      assert.ok(isInt(c.make) && isInt(c.attempt),
        label + ': counts[' + i + '] の Make / Attempt が整数でない');
      assert.ok(c.make >= 0 && c.make <= c.attempt && c.attempt <= COUNT_MAX,
        label + ': counts[' + i + '] が 0 ≤ make ≤ attempt ≤ ' + COUNT_MAX + ' を満たさない');
      idSet[c.id] = true;
    }

    assert.ok(Array.isArray(state.operations) && state.operations.length <= HISTORY_MAX,
      label + ': operations が 0〜' + HISTORY_MAX + ' 件でない');
    for (var j = 0; j < state.operations.length; j++) {
      var op = state.operations[j];
      assert.ok(op !== null && typeof op === 'object',
        label + ': operations[' + j + '] がオブジェクトでない');
      assert.ok(idSet[op.drillId] === true,
        label + ': operations[' + j + '].drillId がメニューに存在しない');
      assert.ok(op.type === 'MAKE' || op.type === 'MISS',
        label + ': operations[' + j + '].type が MAKE / MISS でない');
    }
    return true;
  }

  /** 初期状態（要件 13-7 の定義）を組み立てる。比較の期待値として使う。 */
  function initialStateOf(menu) {
    var counts = [];
    for (var i = 0; i < menu.drills.length; i++) {
      counts.push({ id: menu.drills[i].id, make: 0, attempt: 0 });
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      startedAt: null,
      elapsedSec: 0,
      menuId: menu.id,
      activeIndex: 0,
      counts: counts,
      operations: [],
      ended: false
    };
  }

  /* ========================================================================
   * Property 4: セッション直列化の決定性（要件 13-4）
   * ====================================================================== */

  pbt.forAll('Property 4: セッション直列化の決定性',
    [sessionMaterialGen],
    function (m) {
      var pair = materialToPair(m);
      var state = pair.state;

      var a = serializeSession(state);
      var b = serializeSession(state);
      assert.ok(typeof a === 'string', '直列化が文字列を返さない');
      assert.ok(a === b, '同一状態の 2 回の直列化が文字単位で一致しない');

      // キー挿入順をランダムに入れ替えたコピー（配列要素順は不変）でも一致する
      var shuffled = permuteKeys(cloneDeep(state), m.keySeed);
      var c = serializeSession(shuffled);
      assert.ok(a === c,
        'キー挿入順を入れ替えたコピーの直列化結果が一致しない\n  ' + a + '\n  ' + c);

      // 出力に含まれるトップレベルのキーは 8 個のみ（要件 13-3）
      var parsed = JSON.parse(a);
      assert.deepEqualOk(Object.keys(parsed).slice().sort(), SESSION_FIELDS.slice().sort(),
        '出力の 8 フィールド以外を含む、または欠けている');
      return true;
    },
    { runs: 200 });

  /* ========================================================================
   * Property 5: セッション直列化のラウンドトリップ（要件 13-5, 13-3）
   * ====================================================================== */

  pbt.forAll('Property 5: セッション直列化のラウンドトリップ',
    [sessionMaterialGen],
    function (m) {
      var pair = materialToPair(m);
      var restored = assert.throwsNot(function () {
        return deserializeSession(serializeSession(pair.state), pair.menu);
      }, '復元が例外を送出した');

      assert.deepEqualOk(restored.state, pair.state,
        '8 フィールドのラウンドトリップが一致しない', { name: 'state' });
      assert.ok(restored.issues.length === 0,
        '妥当な状態の復元で issues が空でない: ' + assert.format(restored.issues));
      return true;
    },
    { runs: 200 });

  /* ========================================================================
   * Property 6: 復元の冪等性（要件 13-6）
   * ------------------------------------------------------------------------
   * 有効 / 欠落 / 値域違反 / 非 JSON / 空文字 / ランダム Unicode を各 1 割以上
   * 含む混合分布で 500 回反復する（kind は 0〜5 の一様分布）。
   * ====================================================================== */

  var JSON_KINDS = ['valid', 'missing-field', 'range-violation', 'not-json', 'empty', 'random-unicode'];

  var idempotenceGen = gen.record({
    material: sessionMaterialGen,
    kind: gen.int(0, JSON_KINDS.length - 1),
    fieldIndex: gen.int(0, SESSION_FIELDS.length - 1),
    violation: gen.int(0, 8),
    noise: gen.string(null, 40, 0)
  });

  /** 妥当な状態から保存データ文字列を組み立てる（違反はそのまま残す）。 */
  function buildJson(pair, spec) {
    var kind = JSON_KINDS[spec.kind];
    if (kind === 'valid') {
      return serializeSession(pair.state);
    }
    if (kind === 'not-json') {
      return '{"schemaVersion":1,' + spec.noise;
    }
    if (kind === 'empty') {
      return '';
    }
    if (kind === 'random-unicode') {
      return spec.noise;
    }
    var raw = cloneDeep(pair.state);
    if (kind === 'missing-field') {
      delete raw[SESSION_FIELDS[spec.fieldIndex]];
      return JSON.stringify(raw);
    }
    return JSON.stringify(injectViolation(raw, spec.violation, pair.menu.drills.length));
  }

  /**
   * 要件 13-10 が列挙する値域違反を 1 種類だけ注入する。
   * 戻り値は「注入済みの生オブジェクト」。JSON.stringify で直接文字列化する
   * （serializeSession を通すと値が畳まれて違反が消える）。
   */
  function injectViolation(raw, which, n) {
    switch (which) {
      case 0: // 種目要素数が N と一致しない
        raw.counts = raw.counts.slice(0, raw.counts.length - 1);
        return raw;
      case 1: // make > attempt
        raw.counts[0].make = raw.counts[0].attempt + 1;
        if (raw.counts[0].make > COUNT_MAX) { raw.counts[0].attempt = COUNT_MAX - 1; raw.counts[0].make = COUNT_MAX; }
        return raw;
      case 2: // attempt が 999 超
        raw.counts[0].attempt = COUNT_MAX + 1;
        raw.counts[0].make = 0;
        return raw;
      case 3: // make が 0 未満
        raw.counts[0].make = -1;
        return raw;
      case 4: // activeIndex が範囲外
        raw.activeIndex = n;
        return raw;
      case 5: // activeIndex が整数でない
        raw.activeIndex = 0.5;
        return raw;
      case 6: // elapsedSec が範囲外
        raw.elapsedSec = ELAPSED_MAX + 1;
        return raw;
      case 7: // elapsedSec が整数でない
        raw.elapsedSec = -1;
        return raw;
      default: // operations が 21 件
        raw.operations = [];
        for (var i = 0; i <= HISTORY_MAX; i++) {
          raw.operations.push({ drillId: raw.counts[0].id, type: 'MAKE' });
        }
        return raw;
    }
  }

  pbt.forAll('Property 6: 復元の冪等性',
    [idempotenceGen],
    function (spec) {
      var pair = materialToPair(spec.material);
      var json = buildJson(pair, spec);

      var first = assert.throwsNot(function () {
        return deserializeSession(json, pair.menu);
      }, '1 回目の復元が例外を送出した');

      var second = assert.throwsNot(function () {
        return deserializeSession(serializeSession(first.state), pair.menu);
      }, '2 回目の復元が例外を送出した');

      assert.deepEqualOk(second.state, first.state,
        '復元 → 変換 → 復元が 1 回の復元と一致しない（kind=' + JSON_KINDS[spec.kind] + '）',
        { name: 'state' });
      return true;
    },
    { runs: 500 });

  /* ========================================================================
   * Property 7: 不正入力に対する復元の全域性（要件 13-7〜13-10）
   * ====================================================================== */

  var totalityGen = gen.record({
    material: sessionMaterialGen,
    // -1 は「違反を注入しない」。0〜8 は要件 13-10 の値域違反、
    // 100〜102 は要件 13-8 の schemaVersion 違反。
    injection: gen.frequency([
      [2, gen.const(-1)],
      [5, gen.int(0, 8)],
      [2, gen.oneOf([100, 101, 102])]
    ]),
    garbage: gen.frequency([
      [3, gen.const(null)],
      [1, gen.string(null, 30, 0)]
    ])
  });

  pbt.forAll('Property 7: 不正入力に対する復元の全域性',
    [totalityGen],
    function (spec) {
      var pair = materialToPair(spec.material);
      var menu = pair.menu;
      var n = menu.drills.length;
      var initial = initialStateOf(menu);

      /* --- 非文字列・壊れた文字列でも例外を送出せず妥当な状態を返す --- */
      if (spec.garbage !== null) {
        var g = assert.throwsNot(function () {
          return deserializeSession(spec.garbage, menu);
        }, '壊れた文字列の復元が例外を送出した');
        assertValidState(g.state, menu, '壊れた文字列');
      }

      var raw = cloneDeep(pair.state);
      var expectInitial = true;

      if (spec.injection === -1) {
        expectInitial = false;
      } else if (spec.injection === 100) {
        delete raw.schemaVersion;
      } else if (spec.injection === 101) {
        raw.schemaVersion = 'x';
      } else if (spec.injection === 102) {
        raw.schemaVersion = SCHEMA_VERSION + 1;
      } else {
        raw = injectViolation(raw, spec.injection, n);
      }

      var json = JSON.stringify(raw);
      var result = assert.throwsNot(function () {
        return deserializeSession(json, menu);
      }, '復元が例外を送出した');

      // 常に妥当な状態を返す
      assertValidState(result.state, menu, 'injection=' + spec.injection);

      if (expectInitial) {
        assert.ok(result.issues.length >= 1,
          '違反を注入したのに issues が空である（injection=' + spec.injection + '）');
        assert.deepEqualOk(result.state, initial,
          '違反を注入したのに初期状態が返らない（injection=' + spec.injection + '）',
          { name: 'state' });
      } else {
        assert.ok(result.issues.length === 0,
          '妥当な保存データで issues が空でない: ' + assert.format(result.issues));
        assert.deepEqualOk(result.state, pair.state,
          '妥当な保存データの復元結果が一致しない', { name: 'state' });
      }
      return true;
    },
    { runs: 500 });

  /* ------------------------------------------------------------------------
   * Property 7 後段: 旧版スキーマでは既存値を保持し欠落分のみ既定値で補完する
   * （要件 13-9）
   * ---------------------------------------------------------------------- */

  var LEGACY_OPTIONAL = ['startedAt', 'elapsedSec', 'menuId', 'activeIndex', 'counts', 'operations', 'ended'];

  pbt.forAll('Property 7 後段: 旧版スキーマでの既存値保持と既定値補完',
    [gen.record({
      material: sessionMaterialGen,
      dropMask: gen.int(0, 127)
    })],
    function (spec) {
      var pair = materialToPair(spec.material);
      var menu = pair.menu;
      var initial = initialStateOf(menu);

      var raw = cloneDeep(pair.state);
      raw.schemaVersion = SCHEMA_VERSION - 1;

      var dropped = {};
      for (var i = 0; i < LEGACY_OPTIONAL.length; i++) {
        if ((spec.dropMask >> i) & 1) {
          delete raw[LEGACY_OPTIONAL[i]];
          dropped[LEGACY_OPTIONAL[i]] = true;
        }
      }

      var result = assert.throwsNot(function () {
        return deserializeSession(JSON.stringify(raw), menu);
      }, '旧版スキーマの復元が例外を送出した');

      assertValidState(result.state, menu, '旧版スキーマ');
      assert.ok(result.state.schemaVersion === SCHEMA_VERSION,
        '旧版の復元後に schemaVersion が現行値になっていない');

      for (var k = 0; k < LEGACY_OPTIONAL.length; k++) {
        var field = LEGACY_OPTIONAL[k];
        var expected = dropped[field] ? initial[field] : pair.state[field];
        assert.deepEqualOk(result.state[field], expected,
          '旧版の復元で ' + field + ' が期待値と異なる（欠落=' + (dropped[field] === true) + '）',
          { name: field });
      }
      return true;
    },
    { runs: 200 });

  /* ========================================================================
   * Property 8: Menu_Record のラウンドトリップ（要件 13-11, 13-12）
   * ====================================================================== */

  var menuMaterialGen = gen.record({
    menuSpecs: gen.array(gen.record({
      drillSpecs: gen.array(drillSpecGen, 1, 8),
      nameBody: gen.string(null, 20, 0)
    }), 1, 6),
    keySeed: gen.int(1, 100000)
  });

  /** メニュー名を index 接頭辞で一意にした妥当なメニュー集合を組み立てる。 */
  function buildMenus(menuSpecs) {
    var menus = [];
    for (var i = 0; i < menuSpecs.length; i++) {
      var name = String(i) + ':' + menuSpecs[i].nameBody;
      if (name.length > MENU_NAME_MAX) { name = name.slice(0, MENU_NAME_MAX); }
      menus.push(buildMenu(menuSpecs[i].drillSpecs, name, 'm-' + i));
    }
    return menus;
  }

  pbt.forAll('Property 8: Menu_Record のラウンドトリップ',
    [menuMaterialGen],
    function (m) {
      var menus = buildMenus(m.menuSpecs);

      // 前提: ビルダが作った集合はすべて検証を通る
      for (var i = 0; i < menus.length; i++) {
        var v = validateMenu(menus[i], { menuCount: menus.length });
        assert.ok(v.ok, 'ビルダが不正なメニューを作った: ' + assert.format(v.violations));
      }

      var j1 = serializeMenus(menus);
      var j2 = serializeMenus(menus);
      assert.ok(j1 === j2, '同一メニュー集合の 2 回の直列化が一致しない');

      var shuffled = permuteKeys(cloneDeep(menus), m.keySeed);
      assert.ok(serializeMenus(shuffled) === j1,
        'キー挿入順を入れ替えたコピーの直列化結果が一致しない');

      var restored = assert.throwsNot(function () {
        return deserializeMenus(j1);
      }, 'メニュー復元が例外を送出した');

      assert.ok(restored.issues.length === 0,
        '妥当なメニュー集合の復元で issues が空でない: ' + assert.format(restored.issues));
      assert.deepEqualOk(restored.menus, menus,
        '識別子 / メニュー名 / 種目配列の要素順と各種目の 4 フィールドが一致しない',
        { name: 'menus' });
      return true;
    },
    { runs: 200 });

  /* ========================================================================
   * Property 9: メニュー検証条件の網羅と不正メニューの除外
   * （要件 13-13, 13-14, 18-3, 18-6）
   * ====================================================================== */

  /**
   * 違反を 1 種類だけ注入する。戻り値は期待される違反コード。
   * `menus` は破壊的に書き換える（呼び出し側が複製済みの配列を渡す）。
   */
  function injectMenuViolation(menus, index, which) {
    var menu = menus[index];
    switch (which) {
      case 0:
        menu.name = '';
        return 'MENU_NAME_LENGTH';
      case 1:
        menu.name = repeat('あ', MENU_NAME_MAX + 1);
        return 'MENU_NAME_LENGTH';
      case 2:
        menu.name = menus[0].name; // index >= 1 のときのみ呼ぶ
        return 'MENU_NAME_DUPLICATE';
      case 3:
        menu.drills = [];
        return 'DRILL_COUNT_RANGE';
      case 4:
        menu.drills = [];
        for (var i = 0; i < LIMITS.DRILL_COUNT_MAX + 1; i++) {
          menu.drills.push({ id: i + 1, section: '', name: 'd', targetMake: 1 });
        }
        return 'DRILL_COUNT_RANGE';
      case 5:
        menu.drills.push({
          id: menu.drills[0].id,
          section: '',
          name: '重複 id',
          targetMake: 1
        });
        return 'DRILL_ID_DUPLICATE';
      case 6:
        menu.drills[0].name = '';
        return 'DRILL_NAME_LENGTH';
      case 7:
        menu.drills[0].name = repeat('あ', DRILL_NAME_MAX + 1);
        return 'DRILL_NAME_LENGTH';
      case 8:
        menu.drills[0].section = repeat('あ', SECTION_MAX + 1);
        return 'DRILL_SECTION_LENGTH';
      case 9:
        menu.drills[0].targetMake = 0;
        return 'TARGET_MAKE_RANGE';
      case 10:
        menu.drills[0].targetMake = TARGET_MAKE_MAX + 1;
        return 'TARGET_MAKE_RANGE';
      case 11:
        menu.drills[0].targetMake = 1.5;
        return 'TARGET_MAKE_RANGE';
      case 12:
        menu.id = '';
        return 'MENU_ID_INVALID';
      case 13:
        menu.drills = null;
        return 'DRILL_COUNT_RANGE';
      default:
        menu.drills[0].id = 0;
        return 'DRILL_ID_INVALID';
    }
  }

  pbt.forAll('Property 9: メニュー検証条件の網羅と不正メニューの除外',
    [gen.record({
      menuSpecs: gen.array(gen.record({
        drillSpecs: gen.array(drillSpecGen, 1, 5),
        nameBody: gen.string(null, 12, 0)
      }), 1, 5),
      targetRaw: gen.int(0, 40),
      which: gen.int(0, 14)
    })],
    function (spec) {
      var menus = buildMenus(spec.menuSpecs);
      var total = menus.length;
      var index = spec.targetRaw % total;
      var which = spec.which;

      // 名称重複の注入は「先に受理されたメニュー」が必要なので 2 件目以降に限る
      if (which === 2 && index === 0) { index = (total > 1) ? 1 : 0; }
      if (which === 2 && total === 1) { which = 0; }

      var injected = cloneDeep(menus);
      var expectedCode = injectMenuViolation(injected, index, which);

      // 違反コードの対応: validateMenu が当該コードを報告する
      var direct = validateMenu(injected[index], {
        otherNames: (index > 0) ? [injected[0].name] : []
      });
      assert.ok(!direct.ok, 'which=' + which + ' の注入が違反として検出されない');
      var codes = [];
      for (var c = 0; c < direct.violations.length; c++) { codes.push(direct.violations[c].code); }
      assert.ok(codes.indexOf(expectedCode) !== -1,
        'which=' + which + ' の違反コードが ' + expectedCode + ' を含まない: ' + codes.join(', '));

      // 復元では当該メニューのみが除外される（要件 13-14）
      var restored = assert.throwsNot(function () {
        return deserializeMenus(JSON.stringify(injected));
      }, 'メニュー復元が例外を送出した');

      assert.ok(restored.issues.length >= 1, '違反を注入したのに issues が空である');

      if (total === 1) {
        // 除外後 0 件 → 既定メニュー 1 件のみ
        assert.ok(restored.menus.length === 1,
          '除外後 0 件のときメニューが 1 件でない: ' + restored.menus.length);
        var fallback = restored.menus[0];
        assert.ok(validateMenu(fallback, { menuCount: 1 }).ok,
          '代替として返るメニューが検証を通らない');
        assert.ok(fallback.id !== injected[0].id || fallback.id === 'm-default',
          '除外したメニューがそのまま返っている');
      } else {
        var expected = [];
        for (var k = 0; k < total; k++) {
          if (k !== index) { expected.push(menus[k]); }
        }
        assert.deepEqualOk(restored.menus, expected,
          '違反メニュー以外が保持されていない（which=' + which + ', index=' + index + '）',
          { name: 'menus' });
      }
      return true;
    },
    { runs: 300 });

  /* ------------------------------------------------------------------------
   * Property 9 付随: メニュー数の上限（要件 18-3, 13-13）
   * ---------------------------------------------------------------------- */

  pbt.test('deserializeMenus: 21 件目以降を除外して 20 件に収める（要件 18-3）', function () {
    var menus = [];
    for (var i = 0; i < MENU_COUNT_MAX + 5; i++) {
      menus.push({
        id: 'm-' + i,
        name: 'メニュー' + i,
        drills: [{ id: 1, section: '', name: '種目', targetMake: 10 }]
      });
    }
    var restored = deserializeMenus(JSON.stringify(menus));
    assert.ok(restored.menus.length === MENU_COUNT_MAX,
      'メニュー数が ' + MENU_COUNT_MAX + ' に収まらない: ' + restored.menus.length);
    assert.ok(restored.issues.length >= 1, '上限超過が issues に記録されない');
    assert.deepEqualOk(restored.menus, menus.slice(0, MENU_COUNT_MAX),
      '先頭 20 件が保持されていない', { name: 'menus' });
    return true;
  });

  pbt.test('deriveTargetTotal: targetMake の総和でありリテラル 125 に依存しない', function () {
    assert.ok(deriveTargetTotal({ drills: [] }) === 0, '空の種目配列で 0 にならない');
    assert.ok(deriveTargetTotal({
      drills: [{ targetMake: 10 }, { targetMake: 7 }, { targetMake: 99 }]
    }) === 116, '総和が一致しない');
    // 既定メニューの総計は 125（要件 1-5）だが、算出は総和のみで行う
    assert.ok(deriveTargetTotal({ drills: hook.DRILL_MENU }) === 125,
      '既定メニューの目標合計が 125 でない');
    assert.ok(deriveTargetTotal(null) === 0, '不正な引数で 0 を返さない');
    assert.ok(deriveTargetTotal({ drills: [{ targetMake: 1.5 }, { targetMake: '9' }] }) === 0,
      '整数でない targetMake を 0 として扱わない');
    return true;
  });
})();
