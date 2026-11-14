import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseCorePce, makeEvidence } from '../src/bea.mjs';

const release = `<html><head><title>Personal Income and Outlays, October 2026</title></head><body>
<table><caption>Percent Change From Preceding Month</caption>
<tr><th></th><th>September</th><th>October</th></tr>
<tr><td>PCE price index excluding food and energy</td><td>0.2</td><td>0.3</td></tr></table></body></html>`;

test('parses only the target month and monthly core PCE row', () => {
  assert.deepEqual(parseCorePce(release, '2026-10'), { printed: '0.3%', valueBps: 30 });
});

test('rejects a release whose publication month differs from the market period', () => {
  assert.throws(() => parseCorePce(release, '2026-11'), /period does not match/);
});

test('compares the printed percentage as integer basis points without float rounding', () => {
  const html = release.replace('<td>0.3</td>', '<td>0.29</td>');
  assert.deepEqual(parseCorePce(html, '2026-10'), { printed: '0.29%', valueBps: 29 });
  assert.throws(() => parseCorePce(release.replace('<td>0.3</td>', '<td>0.125</td>'), '2026-10'), /unambiguous monthly Core PCE/);
});

test('evidence hash input has stable canonical field ordering', () => {
  const item = makeEvidence({ url: 'https://www.bea.gov/news/2026/example', periodId: '2026-10', printedValue: '0.3%', html: release, fetchedAt: '2026-11-25T13:31:00.000Z' });
  assert.match(item.canonicalJson, /^\{"period":/);
  assert.equal(JSON.parse(item.canonicalJson).responseSha256.length, 64);
});

test('fixture evidence records its mock status inside the signed canonical payload', () => {
  const item = makeEvidence({ url: 'https://www.bea.gov/news/2026/example', periodId: '2026-10', printedValue: '0.3%', html: release, fetchedAt: '2026-11-25T13:31:00.000Z', fixtureMode: true });
  assert.equal(JSON.parse(item.canonicalJson).fixtureMode, true);
  assert.equal(item.evidenceHash.length, 66);
});

test('production parser reads an official historical release below the threshold', async () => {
  const html = await readFile(new URL('./fixtures/bea-pio-2026-07.html', import.meta.url), 'utf8');
  assert.deepEqual(parseCorePce(html, '2026-07'), { printed: '0.2%', valueBps: 20 });
});

test('production parser reads an official historical release at the threshold', async () => {
  const html = await readFile(new URL('./fixtures/bea-pio-2026-09.html', import.meta.url), 'utf8');
  assert.deepEqual(parseCorePce(html, '2026-09'), { printed: '0.3%', valueBps: 30 });
});

test('builds the canonical official BEA PIO URL for a monthly period', async () => {
  const { officialReleaseUrl } = await import('../src/bea.mjs');
  assert.equal(officialReleaseUrl('2026-10'), 'https://www.bea.gov/news/2026/personal-income-and-outlays-october-2026');
});

test('treats only an unpublished official release as a pending poll', async () => {
  const { fetchOfficialRelease } = await import('../src/bea.mjs');
  const pending = await fetchOfficialRelease('https://www.bea.gov/news/2026/personal-income-and-outlays-october-2026', async () => new Response('not published', { status: 404 }));
  assert.deepEqual(pending, { published: false, status: 404 });
  await assert.rejects(() => fetchOfficialRelease('https://example.com/release', async () => new Response('no')), /Only official www\.bea\.gov HTTPS/);
});

test('canonical BEA evidence hash does not change with retrieval timestamp', () => {
  const first = makeEvidence({ url: 'https://www.bea.gov/news/2026/example', periodId: '2026-10', printedValue: '0.3%', html: release, fetchedAt: '2026-11-25T13:31:00.000Z' });
  const retry = makeEvidence({ url: 'https://www.bea.gov/news/2026/example', periodId: '2026-10', printedValue: '0.3%', html: release, fetchedAt: '2026-11-25T13:46:00.000Z' });
  assert.equal(retry.evidenceHash, first.evidenceHash);
  assert.notEqual(retry.evidence.fetchedAt, first.evidence.fetchedAt);
});
