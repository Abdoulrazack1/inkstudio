// Unit tests for InkStudio's pure logic (audit §10.3.4).
// Run with: node --test
const test = require('node:test');
const assert = require('node:assert');
const P = require('../src/pure.js');

test('escapeHtml neutralizes an XSS payload', () => {
  assert.strictEqual(
    P.escapeHtml('<img src=x onerror="alert(1)">'),
    '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'
  );
  assert.strictEqual(P.escapeHtml("a&b<c>'\""), 'a&amp;b&lt;c&gt;&#39;&quot;');
  assert.strictEqual(P.escapeHtml(null), '');
  assert.strictEqual(P.escapeHtml(42), '42');
});

test('autoChunkCount maps duration → tiles, clamped 6..200', () => {
  assert.strictEqual(P.autoChunkCount(0.1), 6);   // clamped up
  assert.strictEqual(P.autoChunkCount(1), 10);
  assert.strictEqual(P.autoChunkCount(3), 30);
  assert.strictEqual(P.autoChunkCount(8), 80);
  assert.strictEqual(P.autoChunkCount(25), 200);  // clamped down
  assert.strictEqual(P.autoChunkCount(0), 6);
});

test('remapTime shifts timestamps onto the kept ranges', () => {
  // Kept: [0,2] and [6,8]; removed the silence 2..6 and 8..end
  const ranges = [[0, 2], [6, 8]];
  assert.strictEqual(P.remapTime(0, ranges), 0);
  assert.strictEqual(P.remapTime(1, ranges), 1);      // inside first kept range
  assert.strictEqual(P.remapTime(4, ranges), 2);      // in the removed gap → next kept start
  assert.strictEqual(P.remapTime(7, ranges), 3);      // 2 (first) + 1 into second
  assert.strictEqual(P.remapTime(100, ranges), 4);    // past the end = total kept
});

test('captionStamp formats SRT vs VTT timestamps', () => {
  assert.strictEqual(P.captionStamp(0), '00:00:00,000');
  assert.strictEqual(P.captionStamp(6), '00:00:06,000');
  assert.strictEqual(P.captionStamp(65.5), '00:01:05,500');
  assert.strictEqual(P.captionStamp(3661.25, true), '01:01:01.250');
});

test('toSRT produces a valid, sorted SubRip document', () => {
  const srt = P.toSRT([
    { start: 6, end: 8, text: 'Deux' },
    { start: 0, end: 2, text: 'Un' },
  ]);
  assert.strictEqual(
    srt,
    '1\n00:00:00,000 --> 00:00:02,000\nUn\n\n2\n00:00:06,000 --> 00:00:08,000\nDeux\n'
  );
});

test('toVTT starts with WEBVTT and uses dot milliseconds', () => {
  const vtt = P.toVTT([{ start: 0, end: 2, text: 'Salut' }]);
  assert.ok(vtt.startsWith('WEBVTT\n\n'));
  assert.ok(vtt.includes('00:00:00.000 --> 00:00:02.000'));
});

test('validateProjectShape accepts a well-formed project', () => {
  const r = P.validateProjectShape({
    app: 'inkstudio',
    state: { canvasW: 1080, canvasH: 1920, scenes: [{ name: 'S', layers: [] }] },
  });
  assert.strictEqual(r.ok, true);
});

test('validateProjectShape rejects hostile / malformed projects', () => {
  assert.strictEqual(P.validateProjectShape(null).ok, false);
  assert.strictEqual(P.validateProjectShape({ app: 'evil', state: {} }).ok, false);
  assert.strictEqual(P.validateProjectShape({ app: 'inkstudio' }).ok, false);
  assert.strictEqual(P.validateProjectShape({ app: 'inkstudio', state: { canvasW: 999999, canvasH: 100 } }).ok, false);
  assert.strictEqual(P.validateProjectShape({ app: 'inkstudio', state: { scenes: 'nope' } }).ok, false);
  assert.strictEqual(P.validateProjectShape({ app: 'inkstudio', state: { scenes: [{ layers: [{ imageDataURL: { evil: 1 } }] }] } }).ok, false);
  assert.strictEqual(P.validateProjectShape({ app: 'inkstudio', state: { scenes: new Array(600).fill({ layers: [] }) } }).ok, false);
});
