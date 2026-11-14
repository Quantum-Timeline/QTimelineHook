import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { keccak256, stringToHex } from 'viem';

/** Source identifier signed into every IPO price report. It must equal IpoResolutionAdapter.SOURCE_ID. */
export const IPO_SOURCE_ID = 'sec:edgar:424b4:ipo-offer-price-cents:first-filing';
export const ANTHROPIC_CIK = '0002130357';

const PRICE_PATTERN = /initial public offering price[^$]{0,160}?\$\s*([0-9][0-9,]*(?:\.[0-9]+)?)/gi;
const COVER_TEXT_CHARS = 25_000; // the cover page and summary; later sections quote other prices (e.g. over-allotment math)
const MIN_PRICE_CENTS = 100n; // $1.00
const MAX_PRICE_CENTS = 10_000_000n; // $100,000.00

export function secUserAgent(env = process.env) {
  // The SEC asks automated clients to identify themselves. Operators set QT_SEC_USER_AGENT to a real contact.
  return env.QT_SEC_USER_AGENT || 'QTimeline-IPO-resolver/0.1 (set QT_SEC_USER_AGENT with a contact)';
}

const stripZeros = (cik) => String(cik).replace(/^0+/, '');
const padCik = (cik) => stripZeros(cik).padStart(10, '0');

export function submissionsUrl(cik) {
  return `https://data.sec.gov/submissions/CIK${padCik(cik)}.json`;
}

/** Final-prospectus document URL, built only from validated EDGAR identifiers. */
export function documentUrl({ cik, accession, primaryDocument }) {
  if (!/^\d{10}-\d{2}-\d{6}$/.test(accession)) throw new Error('Unexpected EDGAR accession number format.');
  if (!/^[A-Za-z0-9._-]+\.htm$/.test(primaryDocument)) throw new Error('Unexpected EDGAR primary document name.');
  return `https://www.sec.gov/Archives/edgar/data/${stripZeros(cik)}/${accession.replaceAll('-', '')}/${primaryDocument}`;
}

async function fetchFromSec(url, allowedHost, fetchImpl, userAgent, accept) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== allowedHost) throw new Error(`Only https://${allowedHost} is accepted for this request.`);
  const response = await fetchImpl(parsed, {
    redirect: 'follow',
    headers: { 'user-agent': userAgent, accept },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404 || response.status === 410) return { found: false, status: response.status };
  if (!response.ok) throw new Error(`SEC returned HTTP ${response.status}`);
  const finalUrl = new URL(response.url || parsed.href);
  if (finalUrl.protocol !== 'https:' || !finalUrl.hostname.endsWith('sec.gov')) throw new Error('SEC redirect left the official host.');
  return { found: true, status: response.status, url: finalUrl.href, text: await response.text() };
}

export async function fetchSubmissions(cik, { fetchImpl = fetch, userAgent = secUserAgent() } = {}) {
  const result = await fetchFromSec(submissionsUrl(cik), 'data.sec.gov', fetchImpl, userAgent, 'application/json');
  if (!result.found) throw new Error('EDGAR has no submissions record for this CIK.');
  return JSON.parse(result.text);
}

export async function fetchProspectus(url, { fetchImpl = fetch, userAgent = secUserAgent() } = {}) {
  const result = await fetchFromSec(url, 'www.sec.gov', fetchImpl, userAgent, 'text/html');
  if (!result.found) throw new Error('The final prospectus document is not available yet.');
  return result;
}

/**
 * Finds the earliest final prospectus (form 424B4) in an EDGAR submissions record. "First filing" is by acceptance time, so a later
 * follow-on offering's 424B4 can never replace the IPO's. Returns undefined while no 424B4 exists (the poll is then a no-op).
 */
export function findFirstFinalProspectus(submissions, { cik = ANTHROPIC_CIK, company = /anthropic/i } = {}) {
  if (stripZeros(submissions?.cik) !== stripZeros(cik)) throw new Error('EDGAR submissions record is for a different CIK.');
  if (!company.test(String(submissions.name ?? ''))) throw new Error('EDGAR submissions record is for a different company.');
  const recent = submissions.filings?.recent;
  if (!recent || !Array.isArray(recent.form)) throw new Error('EDGAR submissions record has no recent filings list.');
  const matches = [];
  for (let i = 0; i < recent.form.length; i += 1) {
    if (recent.form[i] !== '424B4') continue;
    matches.push({
      accession: recent.accessionNumber[i],
      filingDate: recent.filingDate[i],
      acceptedAt: recent.acceptanceDateTime[i],
      primaryDocument: recent.primaryDocument[i],
    });
  }
  if (matches.length === 0) return undefined;
  matches.sort((a, b) => (a.acceptedAt < b.acceptedAt ? -1 : a.acceptedAt > b.acceptedAt ? 1 : 0));
  return matches[0];
}

function toCents(printed) {
  const unsigned = printed.replaceAll(',', '');
  const [whole, fraction = ''] = unsigned.split('.');
  if (fraction.length > 2) throw new Error('The printed offering price has more than two decimal places; refusing to round it.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
  if (cents < MIN_PRICE_CENTS || cents > MAX_PRICE_CENTS) throw new Error('The printed offering price is outside the plausible range.');
  return Number(cents);
}

/**
 * Reads the initial public offering price per share from a final prospectus cover page. Every mention on the cover must agree,
 * so an ambiguous or contradictory page is held back instead of guessed.
 */
export function parseOfferPrice(html, { company = /anthropic,?\s+pbc/i, ticker } = {}) {
  const $ = load(html);
  $('script,style').remove();
  const text = $.root().text().replace(/[​ ]/g, ' ').replace(/\s+/g, ' ').slice(0, COVER_TEXT_CHARS);
  if (!company.test(text)) throw new Error('The prospectus cover does not name the expected company.');
  if (ticker && !new RegExp(`(?:symbol|ticker)[^A-Za-z]{0,20}[“"']?${ticker}\\b`, 'i').test(text)) throw new Error('The prospectus cover does not name the expected ticker.');
  const prices = new Set();
  for (const match of text.matchAll(PRICE_PATTERN)) prices.add(match[1]);
  if (prices.size !== 1) throw new Error(`Expected one unambiguous initial public offering price, found ${prices.size}.`);
  const [printedNumber] = [...prices];
  return { printed: `$${printedNumber}`, priceCents: toCents(printedNumber) };
}

export function makeIpoEvidence({ url, accession, filingDate, acceptedAt, printed, priceCents, html, fetchedAt, cik = ANTHROPIC_CIK }) {
  const evidence = {
    source: IPO_SOURCE_ID,
    company: 'Anthropic, PBC',
    cik: padCik(cik),
    form: '424B4',
    accession,
    filingDate,
    acceptedAt,
    url,
    printedPrice: printed,
    priceCents,
    responseSha256: createHash('sha256').update(html).digest('hex'),
    fetchedAt,
  };
  const canonicalJson = JSON.stringify(Object.fromEntries(
    Object.entries(evidence)
      .filter(([key]) => key !== 'fetchedAt')
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  ));
  return { evidence, canonicalJson, evidenceHash: keccak256(stringToHex(canonicalJson)) };
}
