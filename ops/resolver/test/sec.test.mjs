import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { keccak256, stringToHex } from 'viem';
import {
  ANTHROPIC_CIK, IPO_SOURCE_ID, documentUrl, findFirstFinalProspectus, makeIpoEvidence, parseOfferPrice, submissionsUrl,
} from '../src/sec.mjs';
import { buildIpoReport, ipoSourceId } from '../src/ipo-report.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/sec/${name}`, import.meta.url), 'utf8');

test('parses the printed offering price from real 424B4 cover pages', () => {
  const circle = parseOfferPrice(fixture('circle-424b4-ipo-cover.html'), { company: /circle internet group/i, ticker: 'CRCL' });
  assert.deepEqual(circle, { printed: '$31.00', priceCents: 3100 });
  const figma = parseOfferPrice(fixture('figma-424b4-ipo-cover.html'), { company: /figma,?\s+inc/i, ticker: 'FIG' });
  assert.deepEqual(figma, { printed: '$33.00', priceCents: 3300 });
});

test('refuses a prospectus for the wrong company or ticker', () => {
  assert.throws(() => parseOfferPrice(fixture('circle-424b4-ipo-cover.html')), /expected company/);
  assert.throws(() => parseOfferPrice(fixture('circle-424b4-ipo-cover.html'), { company: /circle internet group/i, ticker: 'ANT' }), /expected ticker/);
});

test('holds back ambiguous, missing, over-precise and implausible prices', () => {
  const page = (body) => `<html><body>Anthropic, PBC ${body}</body></html>`;
  assert.throws(() => parseOfferPrice(page('The initial public offering price is $74.00 per share. The initial public offering price is $78.00 per share.')), /found 2/);
  assert.throws(() => parseOfferPrice(page('The price will be set after the roadshow.')), /found 0/);
  assert.throws(() => parseOfferPrice(page('The initial public offering price is $74.005 per share.')), /two decimal places/);
  assert.throws(() => parseOfferPrice(page('The initial public offering price is $0.50 per share.')), /plausible range/);
  assert.throws(() => parseOfferPrice(page('The initial public offering price is $999,999,999.00 per share.')), /plausible range/);
  assert.deepEqual(parseOfferPrice(page('The initial public offering price is $1,234.50 per share. Initial public offering price $ 1,234.50 $ 1,000,000')), { printed: '$1,234.50', priceCents: 123450 });
});

test('ignores prices that appear only deep in the document', () => {
  const filler = 'x '.repeat(20_000);
  const html = `<html><body>Anthropic, PBC Prospectus. ${filler} The initial public offering price is $50.00 per share.</body></html>`;
  assert.throws(() => parseOfferPrice(html), /found 0/);
});

test('first final prospectus is chosen by acceptance time, never a later follow-on offering', () => {
  const submissions = JSON.parse(fixture('circle-submissions-trimmed.json'));
  const first = findFirstFinalProspectus(submissions, { cik: '0001876042', company: /circle/i });
  assert.equal(first.accession, '0001193125-25-135795');
  assert.equal(first.filingDate, '2025-06-05');
  assert.equal(first.primaryDocument, 'd737521d424b4.htm');
  assert.equal(documentUrl({ cik: '0001876042', ...first }), 'https://www.sec.gov/Archives/edgar/data/1876042/000119312525135795/d737521d424b4.htm');
});

test('no 424B4 yet is a quiet no-op and a mismatched record is an error', () => {
  const none = { cik: 2130357, name: 'Anthropic, PBC', filings: { recent: { form: ['S-1', 'S-1/A', 'FWP'], accessionNumber: ['a', 'b', 'c'], filingDate: ['', '', ''], acceptanceDateTime: ['', '', ''], primaryDocument: ['', '', ''] } } };
  assert.equal(findFirstFinalProspectus(none), undefined);
  assert.throws(() => findFirstFinalProspectus({ ...none, cik: 1876042 }), /different CIK/);
  assert.throws(() => findFirstFinalProspectus({ ...none, name: 'Someone Else Inc' }), /different company/);
  assert.throws(() => findFirstFinalProspectus({ cik: 2130357, name: 'Anthropic, PBC', filings: {} }), /no recent filings/);
});

test('EDGAR URLs are built only from validated identifiers', () => {
  assert.equal(submissionsUrl(ANTHROPIC_CIK), 'https://data.sec.gov/submissions/CIK0002130357.json');
  assert.throws(() => documentUrl({ cik: ANTHROPIC_CIK, accession: '../../etc', primaryDocument: 'a.htm' }), /accession/);
  assert.throws(() => documentUrl({ cik: ANTHROPIC_CIK, accession: '0001628280-26-000001', primaryDocument: '../evil.htm' }), /primary document/);
  assert.throws(() => documentUrl({ cik: ANTHROPIC_CIK, accession: '0001628280-26-000001', primaryDocument: 'doc.pdf' }), /primary document/);
});

test('evidence is canonical, independent of fetch time, and bound to the exact filing bytes', () => {
  const base = { url: 'https://www.sec.gov/Archives/edgar/data/2130357/000162828026999999/ant424b4.htm', accession: '0001628280-26-999999', filingDate: '2026-11-19', acceptedAt: '2026-11-19T13:41:00.000Z', printed: '$74.00', priceCents: 7400, html: '<html>cover</html>' };
  const a = makeIpoEvidence({ ...base, fetchedAt: '2026-11-19T13:50:00Z' });
  const b = makeIpoEvidence({ ...base, fetchedAt: '2026-11-19T18:00:00Z' });
  assert.equal(a.evidenceHash, b.evidenceHash);
  assert.equal(a.evidenceHash, keccak256(stringToHex(a.canonicalJson)));
  assert.equal(JSON.parse(a.canonicalJson).source, IPO_SOURCE_ID);
  assert.ok(Buffer.byteLength(a.canonicalJson) < 4096, 'evidence must fit the contract limit');
  const changed = makeIpoEvidence({ ...base, html: '<html>different</html>', fetchedAt: 'x' });
  assert.notEqual(changed.evidenceHash, a.evidenceHash);
});

test('the signed report carries the price in cents, the IPO source id, and binds to market period and state', () => {
  const periodId = keccak256(stringToHex('ANT-IPO-PRICE-2026-11'));
  const market = { periodId, activated: true, status: 3, deadline: 1_795_786_200n };
  const report = buildIpoReport({ marketId: `0x${'11'.repeat(32)}`, market, period: 'ANT-IPO-PRICE-2026-11', priceCents: 7400, evidenceHash: `0x${'22'.repeat(32)}` });
  assert.equal(report.valueBps, 7400);
  assert.equal(report.sourceId, ipoSourceId());
  assert.notEqual(report.sourceId, keccak256(stringToHex('bea:core-pce:mom:first-release')), 'must not be a valid Core PCE report');
  assert.equal(report.signatureExpiry, market.deadline);
  assert.throws(() => buildIpoReport({ marketId: report.marketId, market, period: 'other', priceCents: 7400, evidenceHash: report.evidenceHash }), /period/);
  assert.throws(() => buildIpoReport({ marketId: report.marketId, market: { ...market, status: 4 }, period: 'ANT-IPO-PRICE-2026-11', priceCents: 7400, evidenceHash: report.evidenceHash }), /terminal/);
  assert.throws(() => buildIpoReport({ marketId: report.marketId, market, period: 'ANT-IPO-PRICE-2026-11', priceCents: 0, evidenceHash: report.evidenceHash }), /positive/);
});
