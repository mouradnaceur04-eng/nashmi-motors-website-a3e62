// Nashmi Motors — app.js
// Inventory is fetched live from /.netlify/functions/inventory (30-second CDN cache)
// which proxies the DealerCenter XML feed in real time.

let inventory = [];

async function loadInventory() {
  // Try live Netlify function first (real-time DealerCenter data, 30s CDN cache)
  // Fall back to static JSON for local dev where the function isn't running
  const endpoints = [
    '/.netlify/functions/inventory',
    'public/inventory.json',
  ];
  for (const url of endpoints) {
    try {
      const res  = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      inventory  = data.vehicles || [];
      if (inventory.length > 0) { onInventoryLoaded(); return; }
    } catch (e) {
      // try next endpoint
    }
  }
  // Final fallback: hardcoded vehicles
  console.warn('All inventory endpoints failed, using built-in fallback.');
  inventory = FALLBACK_INVENTORY;
  onInventoryLoaded();
}

// Called once inventory is ready — each page sets this before calling loadInventory()
let onInventoryLoaded = () => {};

// ─── Render helpers ────────────────────────────────────────────────────────────

function fmtPrice(n) {
  if (!n && n !== 0) return 'Call for Price';
  return '$' + Number(n).toLocaleString();
}

function fmtMiles(n) {
  return n ? Number(n).toLocaleString() + ' mi' : 'N/A';
}

function carCard(c) {
  const displayPrice = c.sale || c.price;
  const detailUrl    = `vehicle.html?vin=${encodeURIComponent(c.vin || '')}`;
  const imgHtml = c.imgUrl
    ? `<img src="${c.imgUrl}" alt="${c.year} ${c.make} ${c.model}" loading="lazy">`
    : `<div class="car-no-photo"><span>📷</span><p>Photos Coming Soon</p></div>`;
  const saleBadge = c.sale ? `<div class="car-badge">Sale</div>` : '';
  const oldPrice  = c.sale ? `<span class="car-old-price">${fmtPrice(c.price)}</span>` : '';
  const savings   = c.sale ? `<span class="car-savings">Save ${fmtPrice(c.price - c.sale)}</span>` : '';
  // "SHOW ME THE CARFAX" badge — real SVG from CarFax's CDN, same source as nashmimotors.com
  const CFX_CDN = 'https://partnerstatic.carfax.com/img/valuebadge/';
  const isOneOwner = (c.carfaxBadge || '').toLowerCase().includes('1own');
  const smtcSvg  = isOneOwner ? '1own.svg' : 'showme.svg';
  const cfBtn = c.carfax
    ? `<a href="${c.carfax}" target="_blank" rel="noopener" class="smtc-badge" title="Show Me The CARFAX Report" onclick="event.stopPropagation()">
        <img src="${CFX_CDN}${smtcSvg}" alt="Show Me The CARFAX" loading="lazy">
      </a>`
    : '';

  // CarFax value badge overlay on photo — real SVG from CarFax CDN
  let cfxBadgeHtml = '';
  if (c.carfaxBadge) {
    const badge = c.carfaxBadge.toLowerCase();
    const svg = badge.includes('1own') && badge.includes('great') ? '1own_great.svg'
              : badge.includes('1own') && badge.includes('good')  ? '1own_good.svg'
              : badge.includes('1own') && badge.includes('fair')  ? '1own_fair.svg'
              : badge.includes('great') ? 'great.svg'
              : badge.includes('good')  ? 'good.svg'
              : 'fair.svg';
    const imgTag = `<img src="${CFX_CDN}${svg}" alt="${c.carfaxBadge}" loading="lazy" style="height:36px;display:block">`;
    cfxBadgeHtml = c.carfax
      ? `<div class="cfx-badge-wrap" onclick="event.preventDefault();event.stopPropagation();window.open('${c.carfax}','_blank')" role="link" tabindex="0" title="${c.carfaxBadge}">${imgTag}</div>`
      : `<div class="cfx-badge-wrap">${imgTag}</div>`;
  }

  return `
<div class="car-card" data-type="${c.type}" data-make="${c.make}" data-drive="${c.drive}" data-price="${displayPrice || 0}">
  <a href="${detailUrl}" class="car-img-wrap">
    ${imgHtml}
    ${saleBadge}
    ${cfxBadgeHtml}
  </a>
  <div class="car-info">
    <h3 class="car-title"><a href="${detailUrl}">${c.year} ${c.make} ${c.model}</a></h3>
    <div class="car-price-row">
      <span class="car-price">${fmtPrice(displayPrice)}</span>
      ${oldPrice}
      ${savings}
    </div>
    <div class="car-meta">
      <span>${fmtMiles(c.miles)}</span>
      <span>${c.drive || 'N/A'}</span>
      <span>${c.fuel || 'Gas'}</span>
    </div>
    <div class="car-actions">
      <a href="${detailUrl}" class="btn btn-primary car-btn">View Details</a>
      ${cfBtn}
    </div>
  </div>
</div>`;
}

// ─── Search bar ────────────────────────────────────────────────────────────────

function updateModels() {
  const make = document.getElementById('s-make')?.value;
  const sel  = document.getElementById('s-model');
  if (!sel) return;
  sel.innerHTML = '<option value="">Any Model</option>';
  if (!make) return;
  const models = [...new Set(inventory.filter(c => c.make === make).map(c => c.model))].sort();
  models.forEach(m => {
    const o = document.createElement('option');
    o.value = m; o.textContent = m;
    sel.appendChild(o);
  });
}

function runSearch() {
  const make  = document.getElementById('s-make')?.value;
  const model = document.getElementById('s-model')?.value;
  const price = document.getElementById('s-price')?.value;
  const params = new URLSearchParams();
  if (make)  params.set('make', make);
  if (model) params.set('model', model);
  if (price) params.set('price', price);
  window.location.href = 'inventory.html' + (params.toString() ? '?' + params.toString() : '');
}

// ─── Sticky header & hamburger ────────────────────────────────────────────────

window.addEventListener('scroll', () => {
  document.getElementById('header')?.classList.toggle('scrolled', window.scrollY > 10);
});

document.getElementById('hamburger')?.addEventListener('click', function () {
  this.classList.toggle('open');
  document.getElementById('nav')?.classList.toggle('open');
});

// ─── Mailto helper (for forms) ────────────────────────────────────────────────

function formToMailto(form, subject) {
  const lines = [];
  for (const [k, v] of new FormData(form).entries()) {
    if (v?.toString().trim()) lines.push(`${k}: ${v}`);
  }
  return `mailto:sales@nashmimotors.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
}

// ─── Fallback inventory (shown if JSON fetch fails) ───────────────────────────
// This is the last-known inventory — keeps the site working even if the scraper is down.

const FALLBACK_INVENTORY = [
  { vin:"1FAFP55284A197003", year:2004, make:"FORD",     model:"TAURUS",               type:"sedan", price:null,  sale:null,  miles:68431,  drive:"FWD", fuel:"Flex",     img:null, imgUrl:null, url:"https://www.nashmimotors.com/inventory/ford/taurus/tw3/",                     carfax:null },
  { vin:"1FMYU03152KD52361", year:2002, make:"FORD",     model:"ESCAPE",               type:"suv",   price:4995,  sale:null,  miles:150695, drive:"2WD", fuel:"Gasoline", img:null, imgUrl:null, url:"https://www.nashmimotors.com/inventory/ford/escape/a1033/",                   carfax:"https://www.carfax.com/vehiclehistory/ar20/MOa9z0iTa64nkDNsN-VnMKdY3qRUq0b1F-iB9YyeWe--6i1qqRDrBDoxztVpDXfKdce8u9USpRtYqQ2yVte3iajX3vGUZSDLer0" },
  { vin:"JN8AS5MV7CW394605", year:2012, make:"NISSAN",   model:"ROGUE",                type:"suv",   price:5995,  sale:null,  miles:146441, drive:"AWD", fuel:"Gasoline", img:null, imgUrl:null, url:"https://www.nashmimotors.com/inventory/nissan/rogue/a1038/",                  carfax:null },
  { vin:"5XXGM4A74DG145701", year:2013, make:"KIA",      model:"OPTIMA",               type:"sedan", price:5995,  sale:null,  miles:125490, drive:"FWD", fuel:"Gasoline", img:"202604-b67a2027fd0541a2b950f2e5e20d9b72", imgUrl:"https://imagescf.dealercenter.net/640/480/202604-b67a2027fd0541a2b950f2e5e20d9b72.jpg", url:"https://www.nashmimotors.com/inventory/kia/optima/a1034/",    carfax:"https://www.carfax.com/vehiclehistory/ar20/-DJDP7tczx8kUU3gT_oUKKEngYGUxgOYZWghT", carfaxBadge:"Good Value" },
  { vin:"3FADP4BJ2KM108166", year:2019, make:"FORD",     model:"FIESTA",               type:"sedan", price:6995,  sale:null,  miles:90319,  drive:"FWD", fuel:"Gasoline", img:"202604-039a484af9f5493d9a9d5c051585aa6f", imgUrl:"https://imagescf.dealercenter.net/640/480/202604-039a484af9f5493d9a9d5c051585aa6f.jpg", url:"https://www.nashmimotors.com/inventory/ford/fiesta/r1002/",   carfax:null },
  { vin:"1FMCU0GD6HUB33923", year:2017, make:"FORD",     model:"ESCAPE",               type:"suv",   price:8995,  sale:7995,  miles:123212, drive:"FWD", fuel:"Gasoline", img:"202603-de7f64126bdd4473984fc245269cbf86", imgUrl:"https://imagescf.dealercenter.net/640/480/202603-de7f64126bdd4473984fc245269cbf86.jpg", url:"https://www.nashmimotors.com/inventory/ford/escape/a1024/",   carfax:"https://www.carfax.com/vehiclehistory/ar20/nOrh0vlCkocW9BPQ6qfX6w2n8uU1GkQBIH3e9" },
  { vin:"5N1AT2MV1FC890556", year:2015, make:"NISSAN",   model:"ROGUE",                type:"suv",   price:8995,  sale:null,  miles:139501, drive:"AWD", fuel:"Gasoline", img:null, imgUrl:null, url:"https://www.nashmimotors.com/inventory/nissan/rogue/a1040/",                  carfax:null },
  { vin:"1C4RJFCG1EC247856", year:2014, make:"JEEP",     model:"GRAND CHEROKEE",       type:"suv",   price:8995,  sale:null,  miles:173710, drive:"4WD", fuel:"Flex",     img:null, imgUrl:null, url:"https://www.nashmimotors.com/inventory/jeep/grand-cherokee/a1039/",           carfax:null },
  { vin:"1FMCU9HD0JUB66196", year:2018, make:"FORD",     model:"ESCAPE",               type:"suv",   price:10995, sale:9995,  miles:99203,  drive:"4WD", fuel:"Gasoline", img:"202603-a20d08755c204b30905a7dbb89efa304", imgUrl:"https://imagescf.dealercenter.net/640/480/202603-a20d08755c204b30905a7dbb89efa304.jpg", url:"https://www.nashmimotors.com/inventory/ford/escape/a1025/",   carfax:"https://www.carfax.com/vehiclehistory/ar20/SEDj8Ek0DyZN1rgYCKGlBtv3lJpIqiU75kjVU", carfaxBadge:"Great Value" },
  { vin:"2C4RC1BG0HR503978", year:2017, make:"CHRYSLER", model:"PACIFICA",             type:"van",   price:9995,  sale:null,  miles:131087, drive:"FWD", fuel:"Gasoline", img:null, imgUrl:null, url:"https://www.nashmimotors.com/inventory/chrysler/pacifica/a1032/",             carfax:null },
  { vin:"2T1BURHE1GC506793", year:2016, make:"TOYOTA",   model:"COROLLA",              type:"sedan", price:10995, sale:null,  miles:93004,  drive:"FWD", fuel:"Gasoline", img:"202604-31b69fca67994ce3ae2fef2e1efd93df", imgUrl:"https://imagescf.dealercenter.net/640/480/202604-31b69fca67994ce3ae2fef2e1efd93df.jpg", url:"https://www.nashmimotors.com/inventory/toyota/corolla/r1011/", carfax:"https://www.carfax.com/vehiclehistory/ar20/rlYJaSN70TsYHgheHYnbnicogGzGuNiswfjcv" },
  { vin:"1FTFW1ET7BFC33259", year:2011, make:"FORD",     model:"F150 SUPERCREW CAB",   type:"truck", price:10995, sale:null,  miles:166862, drive:"4WD", fuel:"Gasoline", img:"202604-98d761fdfd6343498219fde07c02beb0", imgUrl:"https://imagescf.dealercenter.net/640/480/202604-98d761fdfd6343498219fde07c02beb0.jpg", url:"https://www.nashmimotors.com/inventory/ford/f150-supercrew-cab/a1035/", carfax:"https://www.carfax.com/vehiclehistory/ar20/lrJeOmF1ZJWBCTMbn99IAhnOdIMqOHUbxfhcC" },
  { vin:"5N1DL0MM3KC505596", year:2019, make:"INFINITI", model:"QX60",                 type:"suv",   price:11995, sale:null,  miles:137835, drive:"AWD", fuel:"Gasoline", img:null, imgUrl:null, url:"https://www.nashmimotors.com/inventory/infiniti/qx60/a1042/",                carfax:"https://www.carfax.com/vehiclehistory/ar20/TRZr7scIRL8HJoXSngEQL418KSEFqiRw-lJ0W" },
  { vin:"1C4RJFBG3EC471289", year:2014, make:"JEEP",     model:"GRAND CHEROKEE",       type:"suv",   price:11995, sale:null,  miles:90100,  drive:"4WD", fuel:"Flex",     img:null, imgUrl:null, url:"https://www.nashmimotors.com/inventory/jeep/grand-cherokee/a1043/",           carfax:"https://www.carfax.com/vehiclehistory/ar20/it0aN2TY534kzY7udLVZ6zVIKnaCVAEiFhqjy" },
  { vin:"WA1ANAFY6J2019757", year:2018, make:"AUDI",     model:"Q5",                   type:"suv",   price:11995, sale:null,  miles:131931, drive:"AWD", fuel:"Gasoline", img:null, imgUrl:null, url:"https://www.nashmimotors.com/inventory/audi/q5/a1041/",                      carfax:"https://www.carfax.com/vehiclehistory/ar20/pLUvCtAn0QsUjU16SNikq7QGDwxhRXFskntD8" },
  { vin:"KNDJ23AU3P7884308", year:2023, make:"KIA",      model:"SOUL",                 type:"suv",   price:13995, sale:null,  miles:42418,  drive:"FWD", fuel:"Gasoline", img:null, imgUrl:null, url:"https://www.nashmimotors.com/inventory/kia/soul/r1001/",                      carfax:"https://www.carfax.com/vehiclehistory/ar20/1h-7maQmXn6QVElPezj9A70WSQXoKjQiyZcHD" },
  { vin:"5XXGT4L33LG422253", year:2020, make:"KIA",      model:"OPTIMA",               type:"sedan", price:15995, sale:14995, miles:52350,  drive:"FWD", fuel:"Gasoline", img:"202604-4b79213e173641bcb114456c4c6ea9f9", imgUrl:"https://imagescf.dealercenter.net/640/480/202604-4b79213e173641bcb114456c4c6ea9f9.jpg", url:"https://www.nashmimotors.com/inventory/kia/optima/a1014/", carfax:"https://www.carfax.com/vehiclehistory/ar20/NQ8F464oaGruFzc_CsMJ7wydQC85bu9OrJsSp", carfaxBadge:"Great Value" },
  { vin:"1GTV2MEC9GZ177324", year:2016, make:"GMC",      model:"SIERRA 1500 DOUBLE CAB", type:"truck", price:15995, sale:null, miles:169485, drive:"4WD", fuel:"Gasoline", img:null, imgUrl:null, url:"https://www.nashmimotors.com/inventory/gmc/sierra-1500-double-cab/a1036/",  carfax:"https://www.carfax.com/vehiclehistory/ar20/GcaICloidDStF_Cno2nqOU8nmuyDE5ZI-2ilR" },
];
