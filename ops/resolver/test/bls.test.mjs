import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseUnemploymentRate, makeEvidence, fetchOfficialRelease, SOURCE_ID } from '../src/bls.mjs';

const real = await readFile(new URL('./fixtures/bls-empsit-a01-2026-10.html', import.meta.url), 'utf8');

// A reduced table with the same shape as the live one, so each rule is tested on its own.
const reduced = (title, header, total) => `<html><head><title>Table A-1. Employment status of the civilian population by sex and age - ${title}</title></head><body>
<table id="cps_empsit_a01"><tr><th>Employment status</th><th>Not seasonally adjusted</th><th>Seasonally adjusted</th></tr>
<tr>${header.map((h) => `<th>${h}</th>`).join('')}</tr>
<tr><th>TOTAL</th><td></td></tr>
<tr><th>Unemployment rate</th>${total.map((v) => `<td>${v}</td>`).join('')}</tr>
<tr><th>Men, 20 years and over</th><td></td></tr>
<tr><th>Unemployment rate</th>${total.map(() => '<td>9.9</td>').join('')}</tr></table></body></html>`;
const header = ['Oct.2025', 'Sept.2026', 'Oct.2026', 'Oct.2025', 'June2026', 'July2026', 'Aug.2026', 'Sept.2026', 'Oct.2026'];
const row = ['-', '4.0', '3.9', '-', '4.2', '4.1', '4.1', '4.2', '4.1'];

test('reads the real October 2026 Table A-1 as the seasonally adjusted headline rate', () => {
  assert.deepEqual(parseUnemploymentRate(real, '2026-10'), { pending: false, printed: '4.1%', valueBps: 410 });
});

test('converts a one-decimal percentage to integer basis points', () => {
  const html = reduced('2026 M10 Results', header, [...row.slice(0, -1), '4.2']);
  assert.deepEqual(parseUnemploymentRate(html, '2026-10'), { pending: false, printed: '4.2%', valueBps: 420 });
  const high = reduced('2026 M10 Results', header, [...row.slice(0, -1), '10.3']);
  assert.equal(parseUnemploymentRate(high, '2026-10').valueBps, 1030);
});

test('reads the all-workers row, not a sex or age group row below it', () => {
  const html = reduced('2026 M10 Results', header, row);
  assert.equal(parseUnemploymentRate(html, '2026-10').valueBps, 410);
});

test('reports pending while the page still shows an earlier month', () => {
  const html = reduced('2026 M10 Results', header, row);
  assert.deepEqual(parseUnemploymentRate(html, '2026-11'), { pending: true, shownPeriod: '2026-10' });
});

test('refuses a page that has already moved past the market month', () => {
  const html = reduced('2026 M12 Results', header.map((h) => h.replace('Oct.', 'Dec.')), row);
  assert.throws(() => parseUnemploymentRate(html, '2026-11'), /moved past the market period/);
});

test('refuses a seasonally adjusted column that is not the expected month', () => {
  const html = reduced('2026 M11 Results', header, row);
  assert.throws(() => parseUnemploymentRate(html, '2026-11'), /expected Nov\.2026/);
});

test('refuses an unexpected page or a value that is not a one-decimal percentage', () => {
  assert.throws(() => parseUnemploymentRate('<html><head><title>Access Denied</title></head></html>', '2026-10'), /Unexpected BLS release title/);
  const html = reduced('2026 M10 Results', header, [...row.slice(0, -1), '4.15']);
  assert.throws(() => parseUnemploymentRate(html, '2026-10'), /one-decimal percentage/);
  const missing = reduced('2026 M10 Results', header, [...row.slice(0, -1), '-']);
  assert.throws(() => parseUnemploymentRate(missing, '2026-10'), /one-decimal percentage/);
  assert.throws(() => parseUnemploymentRate(real, '2026/10'), /YYYY-MM/);
});

test('evidence names the source and its hash ignores the retrieval time', () => {
  const a = makeEvidence({ url: 'https://www.bls.gov/news.release/empsit.t01.htm', periodId: '2026-11', printedValue: '4.2%', html: real, fetchedAt: '2026-12-04T13:31:00.000Z' });
  const b = makeEvidence({ url: 'https://www.bls.gov/news.release/empsit.t01.htm', periodId: '2026-11', printedValue: '4.2%', html: real, fetchedAt: '2026-12-04T13:46:00.000Z' });
  assert.equal(JSON.parse(a.canonicalJson).source, SOURCE_ID);
  assert.equal(a.evidenceHash, b.evidenceHash);
  assert.equal(a.evidenceHash.length, 66);
});

test('fetch needs a contact email, stays on www.bls.gov and treats a missing page as pending', async () => {
  await assert.rejects(() => fetchOfficialRelease('QTimeline-resolver/0.1'), /contact email/);
  await assert.rejects(() => fetchOfficialRelease('bot/0.1 (a@b.co)', async () => new Response('x'), 'https://example.com/x'), /Only official www\.bls\.gov HTTPS/);
  const pending = await fetchOfficialRelease('bot/0.1 (a@b.co)', async () => new Response('gone', { status: 404 }));
  assert.deepEqual(pending, { published: false, status: 404 });
  await assert.rejects(() => fetchOfficialRelease('bot/0.1 (a@b.co)', async () => new Response('denied', { status: 403 })), /HTTP 403/);
});

import { parseApiUnemployment, fetchApiRelease, makeApiEvidence, API_URL } from '../src/bls.mjs';

const apiData = [
  { year: '2026', period: 'M10', periodName: 'October', latest: 'true', value: '4.1' },
  { year: '2026', period: 'M09', periodName: 'September', value: '4.2' },
];

test('API reader converts the month to basis points and stays pending until it exists', () => {
  assert.deepEqual(parseApiUnemployment(apiData, '2026-10'), { pending: false, printed: '4.1%', valueBps: 410 });
  assert.deepEqual(parseApiUnemployment(apiData, '2026-09'), { pending: false, printed: '4.2%', valueBps: 420 });
  assert.deepEqual(parseApiUnemployment(apiData, '2026-11'), { pending: true });
});

test('API reader refuses duplicate months and values that are not one-decimal percentages', () => {
  assert.throws(() => parseApiUnemployment([...apiData, apiData[0]], '2026-10'), /more than once/);
  assert.throws(() => parseApiUnemployment([{ year: '2026', period: 'M11', value: '-' }], '2026-11'), /one-decimal percentage/);
});

test('API fetch posts the headline series, stays on api.bls.gov and surfaces failures', async () => {
  let seen;
  const ok = async (url, init) => { seen = { url: String(url), body: JSON.parse(init.body) }; return new Response(JSON.stringify({ status: 'REQUEST_SUCCEEDED', Results: { series: [{ seriesID: 'LNS14000000', data: apiData }] } })); };
  const result = await fetchApiRelease('2026-10', ok);
  assert.equal(result.published, true);
  assert.deepEqual(seen.body, { seriesid: ['LNS14000000'], startyear: '2026', endyear: '2026' });
  await assert.rejects(() => fetchApiRelease('2026-10', ok, 'https://example.com/x'), /Only the official api\.bls\.gov/);
  await assert.rejects(() => fetchApiRelease('2026-10', async () => new Response('no', { status: 500 })), /HTTP 500/);
  await assert.rejects(() => fetchApiRelease('2026-10', async () => new Response(JSON.stringify({ status: 'REQUEST_NOT_PROCESSED' }))), /request failed/);
});

test('API evidence names the same source and its own table', () => {
  const item = makeApiEvidence({ periodId: '2026-11', printedValue: '4.2%', body: '{}', fetchedAt: '2026-12-04T13:31:00.000Z' });
  const parsed = JSON.parse(item.canonicalJson);
  assert.equal(parsed.source, SOURCE_ID);
  assert.equal(parsed.url, API_URL);
  assert.match(parsed.table, /LNS14000000/);
});
