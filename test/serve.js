/*
 * voice-shot-counter-pwa — test/serve.js
 *
 * `test/spec-dom.js` を実行するための最小の静的サーバー（開発用）。
 * `tests.html` は `../index.html` を同一オリジンの <iframe> に読み込むため、
 * file:// では同一オリジン制約により contentDocument へ触れない。
 *
 *   node test/serve.js [ポート]      … 既定 8731
 *   http://127.0.0.1:8731/test/tests.html
 *
 * 成果物 7 ファイルには含めない（アプリ本体は file:// でも動作する）。
 */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var PORT = Number(process.argv[2] || process.env.PORT || 8731);

var TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.css': 'text/css; charset=utf-8'
};

http.createServer(function (req, res) {
  var urlPath = decodeURIComponent(String(req.url).split('?')[0]);
  if (urlPath === '/') { urlPath = '/index.html'; }
  var abs = path.join(ROOT, path.normalize(urlPath));
  if (abs.indexOf(ROOT) !== 0) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  fs.readFile(abs, function (err, body) {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found: ' + urlPath);
      return;
    }
    var type = TYPES[path.extname(abs).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  });
}).listen(PORT, '127.0.0.1', function () {
  console.log('serving ' + ROOT + ' at http://127.0.0.1:' + PORT + '/test/tests.html');
});
