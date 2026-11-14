import { parseCorePce, makeEvidence } from './bea.mjs';

const url = process.env.BEA_RELEASE_URL;
const periodId = process.env.BEA_PERIOD_ID;
if (!url || !periodId) throw new Error('Set BEA_RELEASE_URL and BEA_PERIOD_ID');
const parsedUrl = new URL(url);
if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'www.bea.gov') throw new Error('Only official www.bea.gov HTTPS releases are accepted');
const response = await fetch(parsedUrl, { redirect: 'follow', headers: { 'user-agent': 'QTimeline-BEA-resolver/0.1' } });
if (!response.ok) throw new Error(`BEA returned HTTP ${response.status}`);
const finalUrl = new URL(response.url);
if (finalUrl.protocol !== 'https:' || finalUrl.hostname !== 'www.bea.gov') throw new Error('BEA redirect left the official host');
const html = await response.text();
const { printed, valueBps } = parseCorePce(html, periodId);
const { evidence, canonicalJson, evidenceHash } = makeEvidence({ url: response.url, periodId, printedValue: printed, html, fetchedAt: new Date().toISOString() });
console.log(JSON.stringify({ valueBps, evidence, canonicalJson, evidenceHash }, null, 2));
console.error('Evidence prepared. Signing and on-chain submission require the deployment adapter and isolated signer setup.');
