import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { keccak256, stringToHex } from 'viem';

export const SOURCE_ID = 'bea:core-pce:mom:first-release';

/** Extracts the printed monthly core PCE percentage from a BEA release page. */
export function parseCorePce(html, expectedPeriod) {
  const $ = load(html);
  const title = $('title').text().replace(/\s+/g, ' ').trim();
  if (!/Personal Income and Outlays/i.test(title)) throw new Error('Unexpected BEA release title');
  const periodMatch = expectedPeriod.match(/^(\d{4})-(\d{2})$/);
  if (!periodMatch) throw new Error('Expected period must be YYYY-MM');
  const month = new Date(Date.UTC(Number(periodMatch[1]), Number(periodMatch[2]) - 1, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  if (!title.includes(month) || !title.includes(periodMatch[1])) throw new Error('BEA release period does not match market');

  const candidates = [];
  $('table').each((_, table) => {
    const tableText = $(table).text().replace(/\s+/g, ' ');
    if (!/Percent Change From Preceding Month/i.test(tableText) || !/PCE price index excluding food and energy/i.test(tableText)) return;
    const rows = $(table).find('tr').toArray();
    const headers = rows.map(row => $(row).find('th,td').map((__, cell) => $(cell).text().replace(/\s+/g, ' ').trim()).get());
    const headerRow = headers.findIndex(cells => cells.some(cell => /October|November|December|January|February|March|April|May|June|July|August|September/.test(cell)));
    const targetRow = headers.findIndex(cells => cells.some(cell => /PCE price index excluding food and energy/i.test(cell)));
    if (headerRow < 0 || targetRow < 0) return;
    const col = headers[headerRow].findIndex(cell => cell === month || cell.startsWith(`${month} `));
    if (col < 0 || col >= headers[targetRow].length) return;
    const printed = headers[targetRow][col].replace(/[−–]/g, '-').replace(/%/g, '').trim();
    if (!/^-?\d+(?:\.\d+)?$/.test(printed)) return;
    const negative = printed.startsWith('-');
    const unsigned = negative ? printed.slice(1) : printed;
    const [whole, fraction = ''] = unsigned.split('.');
    if (fraction.length > 2) return;
    const bpsAbs = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    const bps = negative ? -bpsAbs : bpsAbs;
    if (!Number.isSafeInteger(bps) || bps < -2147483648 || bps > 2147483647) return;
    candidates.push({ printed: `${printed}%`, valueBps: bps });
  });
  if (candidates.length !== 1) throw new Error(`Expected one unambiguous monthly Core PCE value, found ${candidates.length}`);
  return candidates[0];
}

export function makeEvidence({ url, periodId, printedValue, html, fetchedAt, fixtureMode = false }) {
  const evidence = {
    source: SOURCE_ID,
    url,
    period: periodId,
    table: 'Percent Change From Preceding Month',
    row: 'PCE price index excluding food and energy',
    printedValue,
    responseSha256: createHash('sha256').update(html).digest('hex'),
    fetchedAt,
  };
  if (fixtureMode) evidence.fixtureMode = true;
  const canonicalJson = JSON.stringify(Object.fromEntries(Object.entries(evidence).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
  return { evidence, canonicalJson, evidenceHash: keccak256(stringToHex(canonicalJson)) };
}
