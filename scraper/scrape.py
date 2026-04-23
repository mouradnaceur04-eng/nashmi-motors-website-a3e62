"""
Nashmi Motors — Inventory Scraper
Primary:  DealerCenter XML feed  https://feeds.dealercenter.net/inventory/29008363/feed.xml
Fallback: Playwright DOM scraper (if feed is unavailable)
Run:  python scraper/scrape.py
"""

import json, re, sys, xml.etree.ElementTree as ET
from pathlib import Path

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False

FEED_URL  = "https://feeds.dealercenter.net/inventory/29008363/feed.xml"
SITE_URL  = "https://www.nashmimotors.com/inventory/"
OUT_FILE  = Path(__file__).parent.parent / "public" / "inventory.json"
IMG_BASE  = "https://imagescf.dealercenter.net/640/480/"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

# Body type lookup by model keyword
BODY_TYPES = {
    "sedan": ["OPTIMA","ALTIMA","MAXIMA","COROLLA","CAMRY","ACCORD","CIVIC","FIESTA",
              "FOCUS","FUSION","200","TAURUS","MALIBU","SONATA","A4","A6","Q50","G37",
              "FORTE","ELANTRA","SENTRA","JETTA","PASSAT","IMPREZA"],
    "suv":   ["ESCAPE","ROGUE","EXPLORER","EXPEDITION","GRAND CHEROKEE","CHEROKEE",
              "COMPASS","WRANGLER","EQUINOX","TERRAIN","TRAVERSE","QX60","QX50","FX35",
              "SOUL","SPORTAGE","TUCSON","SANTA FE","Q5","Q7","X3","X5","PATHFINDER",
              "MURANO","PILOT","CR-V","RAV4","HIGHLANDER","4RUNNER","CX-5","EDGE",
              "ATLAS","TIGUAN","TRAILBLAZER","BLAZER","ENVOY"],
    "truck": ["F150","F-150","F250","F-250","SILVERADO","SIERRA","RAM","TACOMA","TUNDRA",
              "FRONTIER","RANGER","COLORADO","CANYON"],
    "van":   ["PACIFICA","ODYSSEY","SIENNA","CARAVAN","TOWN & COUNTRY","TRANSIT",
              "TRANSIT CONNECT","PROMASTER","SPRINTER","EXPRESS","SAVANA"],
}

def get_body_type(model: str) -> str:
    m = model.upper()
    for btype, keywords in BODY_TYPES.items():
        if any(k in m for k in keywords):
            return btype
    return "suv"

def img_id_from_url(url: str) -> str | None:
    if not url:
        return None
    m = re.search(r'/(\d{6}-[a-f0-9]+)\.jpg', url)
    return m.group(1) if m else None

def normalize_drive(raw: str) -> str:
    if not raw:
        return "N/A"
    r = raw.upper()
    if "ALL"  in r or "AWD" in r: return "AWD"
    if "FOUR" in r or "4WD" in r or "4X4" in r: return "4WD"
    if "REAR" in r or "RWD" in r: return "RWD"
    if "2WD"  in r or "TWO" in r: return "2WD"
    if "FRONT" in r or "FWD" in r: return "FWD"
    return raw.strip()

def normalize_fuel(raw: str) -> str:
    if not raw:
        return "Gasoline"
    r = raw.lower()
    if "electric" in r: return "Electric"
    if "hybrid"   in r: return "Hybrid"
    if "diesel"   in r: return "Diesel"
    if "flex"     in r: return "Flex"
    return "Gasoline"

# ─────────────────────────────────────────────
# METHOD 1: XML Feed
# ─────────────────────────────────────────────

def fetch_xml_feed() -> list[dict] | None:
    """Try to pull inventory from the DealerCenter XML feed. Returns None if unavailable."""
    if not HAS_REQUESTS:
        print("  requests not installed — skipping XML feed")
        return None
    try:
        print(f"  Fetching {FEED_URL} …")
        r = requests.get(FEED_URL, headers=HEADERS, timeout=30)
        r.raise_for_status()
        print(f"  Got {len(r.content):,} bytes (HTTP {r.status_code})")
    except Exception as e:
        print(f"  XML feed unavailable: {e}")
        return None

    try:
        root = ET.fromstring(r.content)
    except ET.ParseError as e:
        print(f"  XML parse error: {e}")
        return None

    # Print root tag + first child tag so we know the schema
    first_child = next(iter(root), None)
    print(f"  Root: <{root.tag}>  First child: <{first_child.tag if first_child is not None else 'none'}>")

    # Try to detect schema: ADF, generic <vehicle>, <item>, <listing>, etc.
    vehicles = []
    items = (
        root.findall('.//vehicle') or
        root.findall('.//Vehicle') or
        root.findall('.//item')    or
        root.findall('.//listing') or
        root.findall('.//car')     or
        list(root)                  # fall back to direct children
    )

    print(f"  Found {len(items)} vehicle elements")
    if not items:
        return None

    def t(el, *tags):
        """Find first matching tag (case-insensitive search across common aliases)."""
        for tag in tags:
            for variant in [tag, tag.lower(), tag.upper(), tag.capitalize()]:
                found = el.find(variant)
                if found is not None and found.text:
                    return found.text.strip()
        return ""

    def find_photos(el) -> list:
        """Return ALL image URLs. First tries <photos> container, then numbered tags, then iteration."""
        photos, seen = [], set()
        # Numbered tags: photo1, photo2, ... image1, image2, ...
        for i in range(1, 40):
            for tag in [f"photo{i}", f"image{i}", f"img{i}", f"photo_{i}", f"image_{i}",
                        f"Photo{i}", f"Image{i}"]:
                node = el.find(tag)
                if node is not None:
                    url = (node.get("url") or node.get("src") or node.text or "").strip()
                    if url and url not in seen:
                        seen.add(url); photos.append(url)
        if photos:
            return photos
        # Container-style <photos><photo url="..."/></photos>
        for container_tag in ["photos","images","Photos","Images"]:
            container = el.find(container_tag)
            if container is not None:
                for child in container:
                    url = (child.get("url") or child.get("src") or child.text or "").strip()
                    if url and url not in seen:
                        seen.add(url); photos.append(url)
        if photos:
            return photos
        # Fall back: scan all attributes/text for DealerCenter image URLs
        for node in el.iter():
            for attr in ["url", "src", "href"]:
                url = node.get(attr, "")
                if url and ("imagescf.dealercenter" in url) and url not in seen:
                    seen.add(url); photos.append(url)
            if node.text:
                t2 = node.text.strip()
                if "imagescf.dealercenter" in t2 and t2 not in seen:
                    seen.add(t2); photos.append(t2)
        return photos

    # Keep backward-compat alias used below
    def find_photo(el) -> str:
        return (find_photos(el) or [""])[0]

    def find_features(el) -> list:
        """Return list of features/options from XML."""
        for tag in ["features","options","Options","Features","equipment","Equipment",
                    "OptionList","option_list","Packages","packages"]:
            node = el.find(tag)
            if node is not None:
                # Could be comma/newline-separated text, or child elements
                children = list(node)
                if children:
                    feats = [c.text.strip() for c in children if c.text and c.text.strip()]
                    if feats:
                        return feats
                if node.text:
                    items = [f.strip() for f in re.split(r'[,\n|;]', node.text) if f.strip() and len(f.strip()) > 2]
                    if items:
                        return items
        return []

    def find_price(el) -> tuple:
        """Return (price, sale_price)."""
        raw_price = t(el,"price","Price","asking_price","retail_price","RetailPrice","internet_price")
        raw_sale  = t(el,"sale_price","SalePrice","special_price","SpecialPrice","sale","discounted_price")
        def to_int(s):
            if not s: return None
            n = re.sub(r'[^\d]','',s)
            return int(n) if n and int(n) > 100 else None
        p = to_int(raw_price)
        s = to_int(raw_sale)
        if p and s and s < p: return p, s
        if p: return p, None
        if s: return s, None
        return None, None

    for el in items:
        vin        = t(el, "vin","VIN","Vin")
        year       = t(el, "year","Year","model_year","ModelYear")
        make       = t(el, "make","Make")
        model      = t(el, "model","Model")
        stock      = t(el, "stock","StockNumber","stock_number","Stock")
        miles_raw  = t(el, "miles","mileage","Mileage","Miles","odometer","Odometer")
        drive_raw  = t(el, "drivetrain","Drivetrain","drive","Drive","DriveType","drive_type")
        fuel_raw   = t(el, "fuel","FuelType","fuel_type","Fuel")
        carfax     = t(el, "carfax","CarFax","carfax_url","CarFaxURL")
        url_raw    = t(el, "url","URL","link","Link","detail_url","DetailURL")
        badge_raw  = t(el, "carfax_badge","CarFaxBadge","carfax_value","CarFaxValue","value_badge")

        if not (vin or (year and make and model)):
            continue

        make  = make.upper()  if make  else ""
        model = model.upper() if model else ""

        miles_str = re.sub(r'[^\d]','', miles_raw)
        miles = int(miles_str) if miles_str.isdigit() else None

        try:
            year_int = int(year)
        except (ValueError, TypeError):
            year_int = None

        price, sale = find_price(el)
        all_photos  = find_photos(el)
        photo_url   = all_photos[0] if all_photos else ""
        img_id      = img_id_from_url(photo_url)
        features    = find_features(el)

        # Build detail URL — use dealer site if feed doesn't include one
        if not url_raw and vin:
            make_slug  = make.lower().replace(' ','-')
            model_slug = model.lower().replace(' ','-')
            url_raw = f"https://www.nashmimotors.com/inventory/{make_slug}/{model_slug}/"

        # Normalise carfax badge from XML feed
        xml_badge = None
        if re.search(r'great', badge_raw or '', re.I):   xml_badge = "Great Value"
        elif re.search(r'good',  badge_raw or '', re.I): xml_badge = "Good Value"
        elif re.search(r'fair',  badge_raw or '', re.I): xml_badge = "Fair Value"

        vehicles.append({
            "vin":    vin    or None,
            "stock":  stock  or None,
            "year":   year_int,
            "make":   make,
            "model":  model,
            "type":   get_body_type(model),
            "price":  price,
            "sale":   sale,
            "miles":  miles,
            "drive":  normalize_drive(drive_raw),
            "fuel":   normalize_fuel(fuel_raw),
            "img":    img_id,
            "imgUrl": (IMG_BASE + img_id + ".jpg") if img_id else (photo_url or None),
            "photos": [(IMG_BASE + img_id_from_url(p) + ".jpg") if img_id_from_url(p) else p
                       for p in all_photos if p],
            "url":         url_raw or None,
            "carfax":      carfax or None,
            "carfaxBadge": xml_badge,
            "features":    features,
        })

    print(f"  Parsed {len(vehicles)} vehicles from XML feed")
    return vehicles if vehicles else None


# ─────────────────────────────────────────────
# METHOD 1b: Playwright photo enrichment
# Runs AFTER the XML feed step.
# Visits each vehicle's nashmimotors.com detail page to grab the full
# photo gallery (XML only provides 1 photo; the DealerCenter-hosted site
# shows them all).
# ─────────────────────────────────────────────

def enrich_photos_playwright(vehicles: list) -> None:
    """
    Visit each vehicle's nashmimotors.com page via Playwright and
    collect all gallery images. Only fetches pages where photos are missing
    or only 1 photo was found (saves time on subsequent runs).
    """
    needs = [v for v in vehicles if len(v.get('photos') or []) <= 1 and v.get('url')]
    if not needs:
        print("  All vehicles already have multiple photos — skipping enrichment.")
        return

    print(f"\n  Photo enrichment: visiting {len(needs)} detail pages via Playwright…")
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("  playwright not installed — skipping photo enrichment")
        return

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(
            viewport={"width": 1440, "height": 900},
            user_agent=HEADERS["User-Agent"],
        )
        pg = ctx.new_page()

        for v in needs:
            try:
                pg.goto(v['url'], wait_until="domcontentloaded", timeout=25000)
                pg.wait_for_timeout(2500)

                raw_photos = pg.evaluate("""() => {
                    // Main gallery images — DealerCenter uses imagescf.dealercenter.net
                    const imgs = [
                        ...document.querySelectorAll('img[src*="imagescf.dealercenter"]'),
                        ...document.querySelectorAll('img[data-src*="imagescf.dealercenter"]'),
                    ].map(i => i.src || i.dataset.src || '').filter(Boolean);

                    // De-duplicate by image ID (strip size prefix to avoid dupes across sizes)
                    const seen = new Set(), result = [];
                    for (const u of imgs) {
                        const key = u.split('?')[0].split('/').slice(-1)[0]; // filename part
                        if (key && !seen.has(key)) { seen.add(key); result.push(u); }
                    }
                    return result;
                }""")

                if raw_photos:
                    processed, seen_ids = [], set()
                    for url in raw_photos:
                        iid = img_id_from_url(url)
                        if iid and iid not in seen_ids:
                            seen_ids.add(iid)
                            processed.append(IMG_BASE + iid + ".jpg")
                        elif not iid and url not in seen_ids:
                            seen_ids.add(url)
                            processed.append(url)
                    if processed:
                        v['photos'] = processed
                        v['imgUrl']  = processed[0]
                        v['img']     = img_id_from_url(processed[0])
                        print(f"    ✅ {v['year']} {v['make']} {v['model']}: {len(processed)} photos")
                    else:
                        print(f"    ⚠  {v['year']} {v['make']} {v['model']}: parsed 0 usable photos")
                else:
                    print(f"    ⚠  {v['year']} {v['make']} {v['model']}: no photos found on page")

            except Exception as e:
                print(f"    ERROR {v.get('url')}: {e}")

        browser.close()


# ─────────────────────────────────────────────
# METHOD 2: Playwright fallback
# ─────────────────────────────────────────────

def scrape_playwright() -> list[dict]:
    """Full Playwright DOM scraper — used only if XML feed is unavailable."""
    print("\n  Falling back to Playwright DOM scraper…")
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("  ERROR: playwright not installed. Run: pip install playwright && playwright install chromium")
        return []

    def parse_price(prices):
        nums = []
        for p in prices:
            found = re.findall(r'\$?([\d,]+)', p)
            nums += [int(f.replace(',','')) for f in found if int(f.replace(',','')) > 1000]
        nums = sorted(set(nums))
        if not nums:    return None, None
        if len(nums)==1: return nums[0], None
        return max(nums), min(nums)

    def parse_title(title):
        parts = title.strip().split(' ', 2)
        if len(parts) >= 3: return int(parts[0]), parts[1], parts[2]
        if len(parts) == 2: return int(parts[0]), parts[1], ''
        return None, title, ''

    seen_vins, vehicles, page_num = set(), [], 1
    # carfax badge map: vin -> badge text, populated by network response interception
    cfx_badge_map = {}

    def handle_response(response):
        """Intercept CarFax API/widget responses to extract value badges."""
        url_lower = response.url.lower()
        # CarFax snapshot widget & value indicator API endpoints
        if 'carfax.com' not in url_lower:
            return
        try:
            if 'snapshot' in url_lower or 'value' in url_lower or 'badge' in url_lower or 'indicator' in url_lower:
                body = response.text()
                # Look for JSON with value ratings
                import json as _json
                try:
                    data = _json.loads(body)
                    # Flatten nested JSON and search for value keys
                    def find_badges(obj, depth=0):
                        if depth > 6: return
                        if isinstance(obj, dict):
                            vin  = obj.get('vin') or obj.get('VIN') or obj.get('vehicleVin') or ''
                            val  = (obj.get('value') or obj.get('rating') or obj.get('badge') or
                                    obj.get('valueIndicator') or obj.get('valueRating') or '')
                            if vin and val and re.search(r'great|good|fair', str(val), re.I):
                                badge = 'Great Value' if 'great' in str(val).lower() else \
                                        'Good Value'  if 'good'  in str(val).lower() else 'Fair Value'
                                cfx_badge_map[vin.upper()] = badge
                            for v in obj.values():
                                find_badges(v, depth+1)
                        elif isinstance(obj, list):
                            for item in obj:
                                find_badges(item, depth+1)
                    find_badges(data)
                except Exception:
                    # Not JSON — search raw text for value patterns near VINs
                    for m in re.finditer(r'([A-Z0-9]{17}).*?(great value|good value|fair value)', body, re.I):
                        vin, badge = m.group(1).upper(), m.group(2).title()
                        cfx_badge_map[vin] = badge
                    for m in re.finditer(r'(great value|good value|fair value).*?([A-Z0-9]{17})', body, re.I):
                        badge, vin = m.group(1).title(), m.group(2).upper()
                        cfx_badge_map[vin] = badge
        except Exception:
            pass

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(
            viewport={"width":1440,"height":900},
            user_agent=HEADERS["User-Agent"]
        )
        pg = ctx.new_page()
        pg.on("response", handle_response)

        # Step 1: listing pages
        while True:
            url = SITE_URL if page_num==1 else f"{SITE_URL}?page_no={page_num}"
            print(f"  Scraping listing page {page_num}…", flush=True)
            pg.goto(url, wait_until="networkidle", timeout=60000)
            pg.wait_for_timeout(5000)

            cards = pg.evaluate("""() => {
                return [...document.querySelectorAll('.vehicle-container')].map(item => {
                    const link   = item.querySelector('a[href*="/inventory/"]');
                    const imccEl = item.querySelector('[data-sn]');
                    const imgs   = [...item.querySelectorAll('img')]
                                       .map(i=>i.src).filter(s=>s.includes('imagescf.dealercenter'));
                    const prices = [...item.querySelectorAll('[class*="price"]')]
                                       .map(p=>p.innerText.trim()).filter(t=>t&&t!=='Price:');
                    const milesEl = item.querySelector('[class*="mile"],[class*="odometer"]');
                    const cfEl    = item.querySelector('a[href*="carfax.com"]');

                    // CarFax badge — DealerCenter uses partnerstatic.carfax.com/img/valuebadge/{type}.svg
                    // Badge filenames: great.svg, good.svg, 1own_good.svg, 1own_fair.svg, fair.svg, etc.
                    let carfaxBadge = null;
                    const cfxBadgeImgs = [...item.querySelectorAll('img[src*="partnerstatic.carfax.com/img/valuebadge/"]')];
                    for (const img of cfxBadgeImgs) {
                        const src = img.src || '';
                        const filename = src.split('/').pop().replace('.svg','').toLowerCase();
                        if (filename.includes('great'))     { carfaxBadge = 'Great Value'; break; }
                        if (filename.includes('good'))      { carfaxBadge = 'Good Value';  break; }
                        if (filename.includes('fair'))      { carfaxBadge = 'Fair Value';  break; }
                        // showme.svg / 1own.svg = no value rating, skip
                    }

                    return {
                        url:         link   ? link.href   : null,
                        title:       imccEl ? imccEl.dataset.title : null,
                        vin:         item.dataset.vehicleId ? item.dataset.vehicleId.replace('vehicle-id-','') : null,
                        stock:       imccEl ? imccEl.dataset.sn : null,
                        imgs:        imgs,
                        prices:      prices,
                        miles:       milesEl ? milesEl.innerText.replace(/[^\d,]/g,'').trim() : null,
                        carfax:      cfEl ? cfEl.href : null,
                        carfaxBadge: carfaxBadge,
                    };
                });
            }""")

            if not cards: break
            new_count = 0
            for c in cards:
                vin = c.get('vin') or c.get('url','')
                if not vin or vin in seen_vins or not c.get('title'): continue
                seen_vins.add(vin)
                new_count += 1
                year, make, model = parse_title(c['title'])
                price, sale = parse_price(c.get('prices') or [])
                img_id = None
                for iurl in (c.get('imgs') or []):
                    img_id = img_id_from_url(iurl)
                    if img_id: break
                miles_raw = c.get('miles','').replace(',','')
                miles = int(miles_raw) if miles_raw.isdigit() else None
                # Normalise carfax badge — from DOM first, then from network intercept map
                raw_badge = (c.get('carfaxBadge') or '').strip()
                badge = None
                if re.search(r'great', raw_badge, re.I):   badge = "Great Value"
                elif re.search(r'good',  raw_badge, re.I): badge = "Good Value"
                elif re.search(r'fair',  raw_badge, re.I): badge = "Fair Value"
                # Fallback: check network-intercepted badge map by VIN
                if not badge and c.get('vin'):
                    badge = cfx_badge_map.get((c['vin'] or '').upper())

                vehicles.append({
                    "vin": c.get('vin'), "stock": c.get('stock'),
                    "year": year, "make": make.upper() if make else make, "model": model.upper() if model else model,
                    "type": get_body_type(model or ''),
                    "price": price, "sale": sale, "miles": miles,
                    "drive": "N/A", "fuel": "Gasoline",
                    "img": img_id, "imgUrl": (IMG_BASE+img_id+".jpg") if img_id else None,
                    "photos": [(IMG_BASE+img_id_from_url(u)+".jpg") if img_id_from_url(u) else u
                               for u in (c.get('imgs') or []) if u],
                    "url": c.get('url'), "carfax": c.get('carfax'),
                    "carfaxBadge": badge,
                    "features": [],
                })
            print(f"    → {new_count} new (total {len(vehicles)})")
            if new_count == 0: break
            page_num += 1

        # Step 2: detail pages for drivetrain/fuel + all photos + features
        print("\n  Fetching detail pages for drivetrain/fuel + photos + features…")
        for v in vehicles:
            if not v.get('url'): continue
            try:
                pg.goto(v['url'], wait_until="domcontentloaded", timeout=20000)
                pg.wait_for_timeout(2500)

                detail = pg.evaluate("""() => {
                    // Drivetrain / fuel spec text
                    const rows = [...document.querySelectorAll('[class*="spec"],[class*="detail"],td,li')];
                    const specs = rows.map(r=>r.innerText.trim()).join('\\n');

                    // All gallery photos
                    const allImgs = [...document.querySelectorAll('img[src*="imagescf.dealercenter"]')]
                        .map(i => i.src).filter(Boolean);
                    // De-duplicate preserving order
                    const seen = new Set(), photos = [];
                    for (const u of allImgs) { if (!seen.has(u)) { seen.add(u); photos.push(u); } }

                    // Features — look for lists of options/features
                    const featEls = [...document.querySelectorAll('[class*="feature"],[class*="option"],[class*="equip"]')];
                    const features = featEls.flatMap(el =>
                        [...el.querySelectorAll('li,span,p')].map(e => e.innerText.trim())
                    ).filter(f => f && f.length > 2 && f.length < 60 && !/^\\d+$/.test(f));
                    // De-dup
                    const uniqueFeats = [...new Set(features)].slice(0, 30);

                    return { specs, photos, features: uniqueFeats };
                }""")

                specs = detail.get('specs', '')
                dt = re.search(r'(?i)(FWD|AWD|4WD|RWD|2WD|All.Wheel|Front.Wheel|Rear.Wheel|Four.Wheel)', specs or '')
                v['drive'] = normalize_drive(dt.group(1)) if dt else 'FWD'
                fuel = re.search(r'(?i)(electric|hybrid|diesel|gasoline|flex)', specs or '')
                v['fuel'] = normalize_fuel(fuel.group(1) if fuel else '')

                # All photos from gallery (override listing-page single photo)
                detail_photos = detail.get('photos') or []
                if detail_photos:
                    processed = []
                    seen_ids = set()
                    for url in detail_photos:
                        iid = img_id_from_url(url)
                        if iid and iid not in seen_ids:
                            seen_ids.add(iid)
                            processed.append(IMG_BASE + iid + ".jpg")
                        elif not iid and url not in seen_ids:
                            seen_ids.add(url)
                            processed.append(url)
                    if processed:
                        v['photos']  = processed
                        v['imgUrl']  = processed[0]
                        v['img']     = img_id_from_url(processed[0])

                # Features
                if detail.get('features'):
                    v['features'] = detail['features']

                # carfaxBadge already captured from listing page DOM
            except Exception as e:
                print(f"    WARN {v.get('url')}: {e}")

            photo_count = len(v.get('photos') or [])
            feat_count  = len(v.get('features') or [])
            badge_tag   = f" [{v.get('carfaxBadge')}]" if v.get('carfaxBadge') else ""
            print(f"    {v['year']} {v['make']} {v['model']} → {v['drive']} / {v['fuel']}{badge_tag} | {photo_count} photos | {feat_count} features")

        browser.close()

    if cfx_badge_map:
        print(f"\n  CarFax badges captured via network: {cfx_badge_map}")
    else:
        print("\n  No CarFax badges captured via network interception.")
        print("  Badges will appear once CarFax widget API is accessible.")

    return vehicles


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────

def main():
    print("=== Nashmi Motors Inventory Scraper ===\n")
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    print("Step 1: Trying XML feed…")
    vehicles = fetch_xml_feed()

    if vehicles:
        print("\nStep 1b: Enriching photos via Playwright (visits nashmimotors.com detail pages)…")
        enrich_photos_playwright(vehicles)
    else:
        print("\nStep 1 failed. Step 2: Full Playwright DOM scraper…")
        vehicles = scrape_playwright()

    if not vehicles:
        print("\nERROR: No vehicles found by any method.")
        sys.exit(1)

    output = {
        "updated":  __import__('datetime').datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
        "count":    len(vehicles),
        "vehicles": vehicles,
    }
    OUT_FILE.write_text(json.dumps(output, indent=2))
    print(f"\n✅ Done — {len(vehicles)} vehicles written to {OUT_FILE}")

if __name__ == "__main__":
    main()
