import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { keccak256, stringToHex } from 'viem';

export const SOURCE_ID = 'bls:unemployment-rate:sa:first-release';
export const RELEASE_URL = 'https://www.bls.gov/news.release/empsit.t01.htm';
const TABLE_ROW = 'Unemployment rate (total, seasonally adjusted)';

// BLS labels the columns of Table A-1 with abbreviated months, for example "Oct.2026" or "Sept.2026".
const MONTH_LABELS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];

function splitPeriod(periodId) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(periodId ?? '');
  if (!match) throw new Error('Expected period must be YYYY-MM');
  return { year: Number(match[1]), month: Number(match[2]) };
}

/**
 * Fetches the current BLS Employment Situation Table A-1. The page is replaced in place each month, so it always shows the latest
 * release; parseUnemploymentRate checks that the month it shows is the one the market is about.
 * BLS blocks automated clients that do not identify themselves with a contact email in the User-Agent, so one is required.
 */
export async function fetchOfficialRelease(userAgent, fetchImpl = fetch, url = RELEASE_URL) {
  if (!/\S+@\S+\.\S+/.test(userAgent ?? '')) {
    throw new Error('Set QT_BLS_USER_AGENT to a User-Agent that includes a contact email; BLS blocks bots that do not identify themselves.');
  }
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'www.bls.gov') {
    throw new Error('Only official www.bls.gov HTTPS releases are accepted');
  }
  const response = await fetchImpl(parsedUrl, {
    redirect: 'follow',
    headers: { 'user-agent': userAgent },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404 || response.status === 410) return { published: false, status: response.status };
  if (!response.ok) throw new Error(`BLS returned HTTP ${response.status}`);
  const finalUrl = new URL(response.url || parsedUrl.href);
  if (finalUrl.protocol !== 'https:' || finalUrl.hostname !== 'www.bls.gov') {
    throw new Error('BLS redirect left the official host');
  }
  return { published: true, status: response.status, url: finalUrl.href, html: await response.text() };
}

/**
 * Reads the headline unemployment rate (total, seasonally adjusted) for the expected month from Table A-1.
 * Returns { pending: true } while the page still shows an earlier month, and throws if it shows a later month (the first print
 * of the expected month can no longer be proven from the live page) or anything unexpected.
 */
export function parseUnemploymentRate(html, expectedPeriod) {
  const { year, month } = splitPeriod(expectedPeriod);
  const $ = load(html);
  const title = $('title').text().replace(/\s+/g, ' ').trim();
  if (!/Table A-1\./.test(title) || !/Employment status of the civilian population/i.test(title)) throw new Error('Unexpected BLS release title');
  const titleMonth = /(\d{4}) M(\d{2})\b/.exec(title);
  if (!titleMonth) throw new Error('BLS release title does not state a data month');
  const shown = Number(titleMonth[1]) * 12 + Number(titleMonth[2]);
  const wanted = year * 12 + month;
  if (shown < wanted) return { pending: true, shownPeriod: `${titleMonth[1]}-${titleMonth[2]}` };
  if (shown > wanted) throw new Error('BLS page has moved past the market period; the first release can no longer be read from it');

  const tables = $('table#cps_empsit_a01').toArray();
  if (tables.length !== 1) throw new Error(`Expected one Table A-1 on the BLS page, found ${tables.length}`);
  const rows = $(tables[0]).find('tr').toArray()
    .map((row) => $(row).find('th,td').map((_, cell) => $(cell).text().replace(/\s+/g, ' ').trim()).get());

  const headerIndex = rows.findIndex((cells) => cells.length >= 6 && cells.every((cell) => /^[A-Za-z]+\.?\d{4}$/.test(cell)));
  if (headerIndex < 0) throw new Error('Could not find the month header row in Table A-1');
  const header = rows[headerIndex];
  const expectedLabel = `${MONTH_LABELS[month - 1]}${year}`;
  if (header[header.length - 1] !== expectedLabel) throw new Error(`Table A-1 seasonally adjusted column is ${header[header.length - 1]}, expected ${expectedLabel}`);

  // The first "Unemployment rate" after the TOTAL heading is the all-workers figure; the rows after it are sex and age groups.
  const totalIndex = rows.findIndex((cells, i) => i > headerIndex && cells[0] === 'TOTAL');
  if (totalIndex < 0) throw new Error('Could not find the TOTAL section of Table A-1');
  const rateRow = rows.slice(totalIndex + 1).find((cells) => cells[0] === 'Unemployment rate');
  if (!rateRow || rateRow.length !== header.length + 1) throw new Error('Could not find the total unemployment rate row in Table A-1');
  const printed = rateRow[rateRow.length - 1];
  if (!/^\d{1,2}\.\d$/.test(printed)) throw new Error(`Unemployment rate is not a one-decimal percentage: ${printed}`);
  const [whole, fraction] = printed.split('.');
  return { pending: false, printed: `${printed}%`, valueBps: Number(whole) * 100 + Number(fraction) * 10 };
}

export function makeEvidence({ url, periodId, printedValue, html, fetchedAt, fixtureMode = false }) {
  const evidence = {
    source: SOURCE_ID,
    url,
    period: periodId,
    table: 'Table A-1. Employment status of the civilian population by sex and age (seasonally adjusted)',
    row: TABLE_ROW,
    printedValue,
    responseSha256: createHash('sha256').update(html).digest('hex'),
    fetchedAt,
  };
  if (fixtureMode) evidence.fixtureMode = true;
  const canonicalJson = JSON.stringify(Object.fromEntries(
    Object.entries(evidence)
      .filter(([key]) => key !== 'fetchedAt')
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
  ));
  return { evidence, canonicalJson, evidenceHash: keccak256(stringToHex(canonicalJson)) };
}
