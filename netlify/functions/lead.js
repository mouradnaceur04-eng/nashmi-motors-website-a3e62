/**
 * Nashmi Motors — Lead Submission Function
 *
 * Receives finance application form data, formats it as ADF XML,
 * and emails it to DealerCenter so it appears in the dealer's CRM.
 *
 * Environment variables needed (set in Netlify dashboard → Site settings → Environment variables):
 *   RESEND_API_KEY   — get free at resend.com (3,000 emails/month free)
 *   LEAD_EMAIL       — email address DealerCenter watches for ADF leads
 *                      (find in DealerCenter: Settings → Lead Sources → Web Leads email)
 *                      Default fallback: sales@nashmimotors.com
 */

const DEALER_NAME    = "Nashmi Motors";
const DEALER_EMAIL   = "sales@nashmimotors.com";
const DEALER_PHONE   = "(717) 743-5175";
const DEALER_ADDRESS = "8001 Paxton St, Harrisburg, PA 17111";

// Resend free plan restriction: onboarding@resend.dev can only send to the account owner's email.
// So we send to the owner's Gmail first; once nashmimotors.com domain is verified in Resend,
// update LEAD_EMAIL env var to 29008363@leadsprod.dealercenter.net and set OWNER_EMAIL to blank.
const LEAD_EMAIL    = process.env.LEAD_EMAIL    || "29008363@leadsprod.dealercenter.net";
const OWNER_EMAIL   = process.env.OWNER_EMAIL   || "mouradnaceur04@gmail.com";
const RESEND_API_KEY = process.env.RESEND_API_KEY;

// ─── Build ADF XML ──────────────────────────────────────────────────────────
function buildADF(d) {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, '');

  // Parse vehicle interest into year/make/model if possible
  // e.g. "2020 KIA OPTIMA — $14,995 (on sale)"
  let vYear = '', vMake = '', vModel = '';
  const vStr = (d['Vehicle Interest'] || '').replace(/—.*/, '').trim();
  const vParts = vStr.split(' ');
  if (vParts.length >= 3 && /^\d{4}$/.test(vParts[0])) {
    vYear  = vParts[0];
    vMake  = vParts[1];
    vModel = vParts.slice(2).join(' ');
  }

  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const comments = [
    d['Employment Status']  ? `Employment: ${d['Employment Status']}`        : '',
    d['Employer']           ? `Employer: ${d['Employer']}`                   : '',
    d['Monthly Income']     ? `Monthly Income: $${d['Monthly Income']}`      : '',
    d['Time at Job']        ? `Time at Job: ${d['Time at Job']}`             : '',
    d['Housing Status']     ? `Housing: ${d['Housing Status']}`              : '',
    d['Time at Address']    ? `Time at Address: ${d['Time at Address']}`     : '',
    d['Down Payment']       ? `Down Payment: ${d['Down Payment']}`           : '',
    d['Trade In']           ? `Trade-In: ${d['Trade In']}`                   : '',
    d['Additional Notes']   ? `Notes: ${d['Additional Notes']}`              : '',
    `Source: Nashmi Motors Website`,
  ].filter(Boolean).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<?adf version="1.0"?>
<adf>
  <prospect>
    <requestdate>${esc(now)}</requestdate>
    <vehicle interest="finance" status="used">
      ${vYear  ? `<year>${esc(vYear)}</year>`   : '<year></year>'}
      ${vMake  ? `<make>${esc(vMake)}</make>`   : '<make></make>'}
      ${vModel ? `<model>${esc(vModel)}</model>` : '<model></model>'}
    </vehicle>
    <customer>
      <contact primarycontact="1">
        <name part="full">${esc((d['First Name'] || '') + ' ' + (d['Last Name'] || ''))}</name>
        <email>${esc(d['Email'] || '')}</email>
        <phone type="voice">${esc(d['Phone'] || '')}</phone>
        <address>
          <street>${esc(d['Street Address'] || '')}</street>
          <city>${esc(d['City'] || '')}</city>
          <regioncode>${esc(d['State'] || '')}</regioncode>
          <postalcode>${esc(d['ZIP'] || '')}</postalcode>
          <country>US</country>
        </address>
      </contact>
    </customer>
    <vendor>
      <vendorname>${esc(DEALER_NAME)}</vendorname>
      <contact>
        <name part="full">${esc(DEALER_NAME)}</name>
        <email>${esc(DEALER_EMAIL)}</email>
        <phone>${esc(DEALER_PHONE)}</phone>
      </contact>
    </vendor>
    <provider>
      <name part="full">Nashmi Motors Website</name>
      <service>Finance Application</service>
      <url>https://nashmimotors.com/apply.html</url>
    </provider>
    <comments>${esc(comments)}</comments>
  </prospect>
</adf>`.trim();
}

// ─── Build readable email body ──────────────────────────────────────────────
function buildEmailHtml(d, adfXml) {
  const rows = Object.entries(d)
    .filter(([k, v]) => v && String(v).trim())
    .map(([k, v]) => `<tr><td style="padding:6px 12px;font-weight:600;color:#374151;white-space:nowrap;font-size:13px">${k}</td><td style="padding:6px 12px;color:#111827;font-size:13px">${v}</td></tr>`)
    .join('');

  const dealerCenterEmail = process.env.LEAD_EMAIL || "29008363@leadsprod.dealercenter.net";
  const forwardBanner = process.env.RESEND_FROM_DOMAIN ? '' : `
  <div style="background:#fef3c7;border-left:4px solid #d97706;padding:16px 24px;font-size:13px;color:#92400e">
    <strong>Action needed:</strong> Forward this email (with the ADF XML below) to
    <a href="mailto:${dealerCenterEmail}" style="color:#b45309;font-weight:600">${dealerCenterEmail}</a>
    to log this lead in DealerCenter CRM.
  </div>`;

  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#f5f7fa;padding:24px">
<div style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
  <div style="background:#4a7c59;padding:24px 32px">
    <h1 style="color:#fff;margin:0;font-size:20px">New Finance Application</h1>
    <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px">Submitted from NashmiMotors.com — ${new Date().toLocaleString('en-US',{timeZone:'America/New_York'})}</p>
  </div>
  ${forwardBanner}
  <div style="padding:32px">
    <table style="width:100%;border-collapse:collapse">
      <thead><tr><th colspan="2" style="text-align:left;padding:6px 12px;background:#f5f7fa;color:#6b7280;font-size:11px;letter-spacing:0.8px;text-transform:uppercase">Applicant Details</th></tr></thead>
      ${rows}
    </table>
  </div>
  <div style="padding:0 32px 32px">
    <p style="font-size:12px;color:#9ca3af;margin-bottom:8px">ADF XML (for DealerCenter import):</p>
    <pre style="background:#f5f7fa;padding:16px;border-radius:8px;font-size:10px;overflow-x:auto;white-space:pre-wrap;color:#374151">${adfXml.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>
  </div>
</div>
</body></html>`;
}

// ─── Handler ────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // Parse body
  let data;
  try {
    data = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  // Validate required fields
  const required = ['First Name', 'Last Name', 'Phone', 'Email'];
  for (const field of required) {
    if (!data[field]?.trim()) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: `Missing required field: ${field}` }),
      };
    }
  }

  if (!RESEND_API_KEY) {
    // No API key set — log the lead and return success anyway (dev mode)
    console.log('LEAD (no Resend key):', JSON.stringify(data, null, 2));
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: true, dev: true }),
    };
  }

  const isCarFinder = data['_type'] === 'Car Finder Request';
  const adfXml  = isCarFinder ? '' : buildADF(data);
  const htmlBody = buildEmailHtml(data, adfXml);
  const name     = `${data['First Name']} ${data['Last Name']}`;
  const vehicle  = data['Make'] && data['Model']
    ? `${data['Year'] || ''} ${data['Make']} ${data['Model']}`.trim()
    : (data['Vehicle Interest'] || 'Not specified');
  const subjectPrefix = isCarFinder ? '[Car Finder]' : '[Finance Lead]';

  // Send via Resend
  try {
    // Resend free plan: onboarding@resend.dev can only deliver to the account owner's email.
    // We send to OWNER_EMAIL (Gmail) now. Once nashmimotors.com domain is verified in Resend,
    // set LEAD_EMAIL env var and the system will automatically route to DealerCenter.
    const useVerifiedDomain = process.env.RESEND_FROM_DOMAIN; // e.g. "sales@nashmimotors.com"
    const fromAddr = useVerifiedDomain
      ? `Nashmi Motors <${useVerifiedDomain}>`
      : `Nashmi Motors Website <onboarding@resend.dev>`;

    // Recipients — when using verified domain we can send anywhere; otherwise owner only
    const toList = useVerifiedDomain
      ? [LEAD_EMAIL, "sales@nashmimotors.com"]
      : [OWNER_EMAIL];

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    fromAddr,
        to:      toList,
        subject: `${subjectPrefix} ${name} — ${vehicle}`,
        html:    htmlBody,
        // Plain text fallback includes the raw ADF XML so DealerCenter can parse it
        text:    `New finance application from ${name}\nPhone: ${data['Phone']}\nEmail: ${data['Email']}\nVehicle: ${vehicle}\n\nForward ADF XML to: ${LEAD_EMAIL}\n\n${adfXml}`,
        // Tag the email as ADF so DealerCenter's email parser recognises it
        headers: {
          'X-Lead-Source':   'Nashmi Motors Website',
          'X-ADF-Version':   '1.0',
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Resend error:', err);
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Email send failed' }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    console.error('Function error:', err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Server error' }),
    };
  }
};
