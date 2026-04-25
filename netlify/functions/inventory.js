/**
 * Nashmi Motors — Live Inventory Proxy
 *
 * Fetches the DealerCenter XML feed on every request and returns clean JSON.
 * CDN caches the response for 30 seconds so the site always shows fresh inventory.
 *
 * Fallback: if the XML feed is unreachable, serves the static public/inventory.json.
 */

const FEED_URL      = 'https://feeds.dealercenter.net/inventory/29008363/feed.xml';
const IMG_BASE      = 'https://imagescf.dealercenter.net/640/480/';
// publish = "." so public/inventory.json is served at /public/inventory.json
const SITE_URL      = process.env.URL || 'https://melodious-shortbread-85885e.netlify.app';
const STATIC_FB_URL = `${SITE_URL}/public/inventory.json`;

// ── Body type detection ──────────────────────────────────────────────────────
const BODY_MAP = {
  sedan:  ['OPTIMA','ALTIMA','MAXIMA','COROLLA','CAMRY','ACCORD','CIVIC','FIESTA',
            'FOCUS','FUSION','TAURUS','MALIBU','SONATA','A4','A6','Q50','G37',
            'FORTE','ELANTRA','SENTRA','JETTA','PASSAT','IMPREZA','SOUL'],
  suv:    ['ESCAPE','ROGUE','EXPLORER','EXPEDITION','GRAND CHEROKEE','CHEROKEE',
            'COMPASS','WRANGLER','EQUINOX','TERRAIN','TRAVERSE','QX60','QX50','FX35',
            'SPORTAGE','TUCSON','SANTA FE','Q5','Q7','X3','X5','PATHFINDER',
            'MURANO','PILOT','CR-V','RAV4','HIGHLANDER','4RUNNER','CX-5','EDGE',
            'ATLAS','TIGUAN','TRAILBLAZER','BLAZER'],
  truck:  ['F150','F-150','F250','F-250','SILVERADO','SIERRA','RAM','TACOMA','TUNDRA',
            'FRONTIER','RANGER','COLORADO','CANYON'],
  van:    ['PACIFICA','ODYSSEY','SIENNA','CARAVAN','TOWN & COUNTRY','TRANSIT',
            'TRANSIT CONNECT','PROMASTER','SPRINTER'],
};

function bodyType(model) {
  const m = (model || '').toUpperCase();
  for (const [type, keys] of Object.entries(BODY_MAP)) {
    if (keys.some(k => m.includes(k))) return type;
  }
  return 'suv';
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function tag(xml, name) {
  const rx = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i');
  const m = xml.match(rx);
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';
}

function allTags(xml, name) {
  const rx = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'gi');
  const results = [];
  let m;
  while ((m = rx.exec(xml)) !== null) {
    results.push(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim());
  }
  return results;
}

function parseInt2(s) {
  const n = parseInt((s || '').replace(/[^0-9]/g, ''), 10);
  return isNaN(n) ? null : n;
}

function normDrive(s) {
  const r = (s || '').toUpperCase();
  if (r.includes('AWD') || r.includes('ALL')) return 'AWD';
  if (r.includes('4WD') || r.includes('FOUR') || r.includes('4X4')) return '4WD';
  if (r.includes('RWD') || r.includes('REAR')) return 'RWD';
  if (r.includes('FWD') || r.includes('FRONT')) return 'FWD';
  return s || 'N/A';
}

function normFuel(s) {
  const r = (s || '').toLowerCase();
  if (r.includes('electric')) return 'Electric';
  if (r.includes('hybrid'))   return 'Hybrid';
  if (r.includes('diesel'))   return 'Diesel';
  if (r.includes('flex'))     return 'Flex';
  return 'Gasoline';
}

// ── Parse DealerCenter XML ───────────────────────────────────────────────────
function parseXML(xml) {
  const vehicleRx = /<vehicle[\s\S]*?<\/vehicle>/gi;
  const blocks = xml.match(vehicleRx) || [];

  return blocks.map(b => {
    const year   = tag(b, 'year');
    const make   = tag(b, 'make');
    const model  = tag(b, 'model');
    const trim   = tag(b, 'trim');
    const vin    = tag(b, 'vin');
    const miles  = parseInt2(tag(b, 'miles') || tag(b, 'mileage') || tag(b, 'odometer'));
    const price  = parseInt2(tag(b, 'price') || tag(b, 'retail_price') || tag(b, 'asking_price'));
    const sale   = parseInt2(tag(b, 'sale_price') || tag(b, 'internet_price') || tag(b, 'special_price'));
    const drive  = normDrive(tag(b, 'drivetrain') || tag(b, 'drive') || tag(b, 'drivetype'));
    const fuel   = normFuel(tag(b, 'fuel') || tag(b, 'fueltype') || tag(b, 'fuel_type'));
    const color  = tag(b, 'exterior_color') || tag(b, 'color') || tag(b, 'extcolor');
    const engine = tag(b, 'engine') || tag(b, 'enginedescription');

    const photos = [];
    function addPhoto(p) {
      if (!p) return;
      const url = p.startsWith('http') ? p : IMG_BASE + p;
      if (url && !photos.includes(url)) photos.push(url);
    }

    // Numbered tags: photo1..photo30, image1..image30 (DealerCenter standard format)
    for (let n = 1; n <= 30; n++) {
      addPhoto(tag(b, `photo${n}`));
      addPhoto(tag(b, `image${n}`));
    }
    // Generic multi-value photo/image tags
    allTags(b, 'photo').concat(allTags(b, 'image'), allTags(b, 'photo_url')).forEach(addPhoto);
    // URL attributes in any tag
    const attrRx = /(?:url|src|href)="(https?:\/\/imagescf\.dealercenter\.net\/[^"]+)"/gi;
    let am;
    while ((am = attrRx.exec(b)) !== null) {
      if (!photos.includes(am[1])) photos.push(am[1]);
    }

    const img    = photos[0] || null;
    const cfxUrl = tag(b, 'carfax_url') || tag(b, 'carfax') || '';

    const isSale      = sale && sale < price;
    const displayPrice = isSale ? sale : price;

    return {
      year, make, model, trim, vin,
      miles,
      price:    displayPrice,
      salePrice: isSale ? sale  : null,
      wasPrice:  isSale ? price : null,
      sale:      isSale,
      drive, fuel, color, engine,
      img,
      photos: photos.slice(0, 20),
      carfax:      cfxUrl || null,
      carfaxBadge: null,
      bodyType:    bodyType(model),
      id: vin || `${year}-${make}-${model}`.replace(/\s+/g, '-').toLowerCase(),
    };
  }).filter(v => v.year && v.make && v.model && v.price);
}

// ── Load static inventory for photo + badge cache via HTTP ───────────────────
async function buildStaticCache() {
  try {
    const res = await fetch(STATIC_FB_URL, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.log('Static cache HTTP error:', res.status);
      return {};
    }
    const data = await res.json();
    const cache = {};
    for (const v of (data.vehicles || [])) {
      if (v.vin) cache[v.vin] = {
        photos:      v.photos      || (v.imgUrl ? [v.imgUrl] : []),
        carfax:      v.carfax      || null,
        carfaxBadge: v.carfaxBadge || null,
        features:    v.features    || [],
      };
    }
    console.log(`Static cache loaded: ${Object.keys(cache).length} vehicles`);
    return cache;
  } catch (e) {
    console.log('Static cache unavailable:', e.message);
    return {};
  }
}

// ── Handler ──────────────────────────────────────────────────────────────────
exports.handler = async () => {
  const corsHeaders = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
  };

  // Build photo/badge cache from static file
  const staticCache = await buildStaticCache();

  let source = 'live-feed';
  let vehicles = [];

  // ── Try live XML feed first ──
  try {
    const res = await fetch(FEED_URL, {
      headers: { 'User-Agent': 'NashmiMotors-InventoryBot/1.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const parsed = parseXML(xml);
    if (parsed.length === 0) throw new Error('XML parsed but 0 vehicles');

    // Merge static photo cache into live vehicles
    vehicles = parsed.map(v => {
      const cached = staticCache[v.vin] || {};
      // app.js expects: price = original price, sale = discounted number or null
      const originalPrice = v.wasPrice || v.price || null;
      const salePrice     = (v.sale === true && v.salePrice) ? v.salePrice : null;
      return {
        vin:         v.vin,
        year:        parseInt(v.year, 10) || null,
        make:        (v.make  || '').toUpperCase(),
        model:       (v.model || '').toUpperCase(),
        type:        v.bodyType || 'suv',
        price:       originalPrice,
        sale:        salePrice,
        miles:       v.miles,
        drive:       v.drive,
        fuel:        v.fuel,
        img:         null,
        // XML photos are per-VIN and authoritative; scraped cache fills in when XML has none
        imgUrl:      v.photos.length > 0 ? v.photos[0] : ((cached.photos && cached.photos[0]) || v.img || null),
        photos:      v.photos.length > 0 ? v.photos : (cached.photos && cached.photos.length > 0 ? cached.photos : []),
        carfax:      cached.carfax      || v.carfax      || null,
        carfaxBadge: cached.carfaxBadge || v.carfaxBadge || null,
        features:    cached.features    || [],
        url:         null,
      };
    });
  } catch (liveErr) {
    // ── Fallback: static inventory.json ──
    console.log('Live feed failed, using static fallback:', liveErr.message);
    source = 'static-fallback';
    try {
      const res = await fetch(STATIC_FB_URL, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`Static fetch HTTP ${res.status}`);
      const data = await res.json();
      vehicles = data.vehicles || [];
    } catch (fbErr) {
      console.error('Static fallback also failed:', fbErr.message);
      return {
        statusCode: 503,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Inventory temporarily unavailable' }),
      };
    }
  }

  return {
    statusCode: 200,
    headers: { ...corsHeaders, 'X-Inventory-Source': source },
    body: JSON.stringify({
      updated:  new Date().toISOString(),
      count:    vehicles.length,
      source,
      vehicles,
    }),
  };
};
