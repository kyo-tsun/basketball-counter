/*
 * voice-shot-counter-pwa — test/run-node.js
 *
 * tests.html と同じ読み込み順を Node で再現する開発用ランナー。
 * ブラウザを開かずに spec-*.js を実行して合否を確認するためだけに存在し、
 * 成果物 7 ファイルには含めない（sw.js の PRECACHE にも列挙しない）。
 *
 *   node test/run-node.js            … 全 spec を実行
 *   node test/run-node.js spec-count.js spec-serializer.js
 *                                    … 指定した spec のみ実行
 *   VSC_SEED=12345 node test/run-node.js
 *                                    … baseSeed を固定して再現
 *
 * DOM を持たないため spec-dom.js は対象外（tests.html を静的サーバー経由で開く）。
 * app.js は `typeof window !== 'undefined'` を見て window.__VSC_TEST__ に公開する
 * ため、最小の window スタブだけを用意して同一ファイルをそのまま読み込む。
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var TEST_DIR = __dirname;
var ROOT_DIR = path.resolve(TEST_DIR, '..');

var SPEC_FILES = [
  'spec-count.js',
  'spec-serializer.js',
  'spec-cursor.js',
  'spec-timer.js',
  'spec-command.js',
  'spec-display.js',
  'spec-unit.js'
];

var requested = process.argv.slice(2);
var specs = requested.length > 0 ? requested : SPEC_FILES;

/* ---- 最小の window スタブ -------------------------------------------------
 * app.js / pbt.js / spec-*.js が触るのは window へのプロパティ代入と参照のみ。
 * DOM も localStorage も提供しない（純粋関数のテストはどちらも使わない）。
 * ------------------------------------------------------------------------ */
var sandbox = {
  console: console,
  Date: Date,
  Math: Math,
  JSON: JSON,
  Object: Object,
  Array: Array,
  String: String,
  Number: Number,
  Boolean: Boolean,
  RegExp: RegExp,
  Error: Error,
  isFinite: isFinite,
  isNaN: isNaN,
  parseInt: parseInt,
  parseFloat: parseFloat,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  Promise: Promise
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
sandbox.self = sandbox;
/*
 * tests.html と同じ規約で読み込み元を記録する。app.js はこの変数の存在を見て
 * `__VSC_TEST__.shell`（副作用シェルのファクトリ）を公開するため、
 * 設定しないと 10.5 以降の単体テストが前提を満たせない。
 */
sandbox.__VSC_LOAD_CONTEXT__ = 'run-node.js';

var context = vm.createContext(sandbox);

function run(file) {
  var abs = path.isAbsolute(file) ? file : path.join(TEST_DIR, file);
  if (!fs.existsSync(abs)) { return false; }
  var code = fs.readFileSync(abs, 'utf8');
  vm.runInContext(code, context, { filename: abs });
  return true;
}

run(path.join(TEST_DIR, 'pbt.js'));
run(path.join(TEST_DIR, 'assert.js'));
run(path.join(ROOT_DIR, 'app.js'));

var pbt = sandbox.pbt;
if (!pbt) {
  console.error('pbt.js を読み込めなかった。');
  process.exit(1);
}

var seed = process.env.VSC_SEED;
if (seed !== undefined && typeof pbt.setBaseSeed === 'function') {
  pbt.setBaseSeed(Number(seed) >>> 0);
}

var hookKeys = sandbox.__VSC_TEST__ ? Object.keys(sandbox.__VSC_TEST__) : [];
console.log('window.__VSC_TEST__ の公開数: ' + hookKeys.length);

var missing = [];
for (var i = 0; i < specs.length; i++) {
  if (!run(specs[i])) { missing.push(specs[i]); }
}

/*
 * tests.html と同じ規約で非同期テストを実行する。
 * spec-*.js は Promise を返す関数を globalThis.__VSC_DEFERRED__ に積む。
 */
function runDeferred() {
  var deferred = Array.isArray(sandbox.__VSC_DEFERRED__) ? sandbox.__VSC_DEFERRED__ : [];
  var index = 0;
  function next() {
    if (index >= deferred.length) { return Promise.resolve(); }
    var fn = deferred[index++];
    return Promise.resolve().then(fn).catch(function (e) {
      console.log('FAIL  非同期テスト #' + index + ': ' + ((e && e.message) ? e.message : e));
    }).then(next);
  }
  return next();
}

runDeferred().then(function () {
  var failed = pbt.consoleReport();
  if (missing.length > 0) {
    console.log('未作成の spec: ' + missing.join(', '));
  }
  process.exit(failed > 0 ? 1 : 0);
});
