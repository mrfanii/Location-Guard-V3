const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const contentFiles = fs
  .readdirSync('js/content')
  .filter((name) => name.endsWith('.js'))
  .sort();

assert.equal(manifest.content_scripts.length, 3, 'the manifest must keep its three content-script entries');
assert.deepEqual(contentFiles, ['content.js', 'main-world.js', 'statistics.js']);

for (const file of ['js/content/content.js', 'js/content/main-world.js']) {
  const source = fs.readFileSync(file, 'utf8').trimStart();
  assert.match(source, /^\(function \(\) \{/, `${file} must keep its private IIFE scope`);
}

const firstPartyFiles = [
  'js/common.js',
  'js/background.js',
  'js/background/main.js',
  'js/content/content.js',
  'js/content/main-world.js',
  'js/content/statistics.js',
  'js/gui/demo.js',
  'js/gui/faq.js',
  'js/gui/options.js',
  'js/gui/popup.js',
  'js/background/statistics.js',
];

for (const file of firstPartyFiles) {
  const source = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(source, /function r\(e,n,t\)|\[function\(require,module,exports\)|module\.exports/);
}

for (const htmlFile of ['demo.html', 'faq.html', 'options.html', 'popup.html']) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  assert.doesNotMatch(html, /common-gui\.js/);

  for (const match of html.matchAll(/<script\s+src="([^"]+)"/g)) {
    assert.equal(fs.existsSync(path.normalize(match[1])), true, `${htmlFile} references missing ${match[1]}`);
  }
}

console.log('unbundled structure smoke ok');
