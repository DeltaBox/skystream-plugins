(function() {
    /**
     * @type {import('@skystream/sdk').Manifest}
     */
    // manifest is injected at runtime

    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

    const BASE_HEADERS = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": `${manifest.baseUrl}/`
    };

    const EXCLUDE_PATHS = [
        "/genre", "/country", "/negara", "/tahun", "/year", "/page/",
        "/privacy", "/dmca", "/faq", "/request", "/wp-",
        "/author", "/category", "/tag", "/feed", "javascript:"
    ];

    const TRUSTED_NAV_HOST_MARKERS = [
        "anichin",
        "layarkaca",
        "lk21"
    ];

    // --- Helpers ---
    function normalizeUrl(url, base) {
        if (!url) return "";
        const raw = String(url).trim();
        if (!raw) return "";
        if (raw.startsWith("//")) return `https:${raw}`;
        if (/^https?:\/\//i.test(raw)) return raw;
        if (raw.startsWith("/")) return `${base}${raw}`;
        return `${base}/${raw}`;
    }

    function resolveUrl(base, next) {
        try {
            return new URL(String(next || ""), String(base || manifest.baseUrl)).toString();
        } catch (_) {
            return normalizeUrl(next, manifest.baseUrl);
        }
    }

    function hostnameOf(url) {
        try {
            return new URL(String(url || "")).hostname.toLowerCase();
        } catch (_) {
            return "";
        }
    }

    function isTrustedNavigationUrl(url) {
        const host = hostnameOf(url);
        if (!host) return false;
        const manifestHost = hostnameOf(manifest.baseUrl);
        if (host === manifestHost) return true;
        if (host.endsWith(`.${manifestHost}`)) return true;
        return TRUSTED_NAV_HOST_MARKERS.some((marker) => host.includes(marker));
    }

    function extractHeader(headers, key) {
        const want = String(key || "").toLowerCase();
        const map = headers && typeof headers === "object" ? headers : {};
        for (const k of Object.keys(map)) {
            if (String(k).toLowerCase() === want) return String(map[k] || "");
        }
        return "";
    }

    function isCloudflareBlocked(response, targetUrl) {
        const body = String(response?.body || "");
        const headerServer = extractHeader(response?.headers, "server").toLowerCase();
        const title = (body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || "").toLowerCase();
        const urlText = String(targetUrl || "").toLowerCase();
        if (/cloudflare/i.test(body) && /attention required|verify you are human|just a moment|cf-ray|cf-chl/i.test(body)) return true;
        if (title.includes("just a moment") || title.includes("attention required")) return true;
        if (headerServer.includes("cloudflare") && /checking your browser|verify you are human/i.test(body)) return true;
        if (urlText.includes("/cdn-cgi/challenge-platform/")) return true;
        return false;
    }

    function htmlDecode(text) {
        if (!text) return "";
        return String(text)
            .replace(/&amp;/g, "&")
            .replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'")
            .replace(/&apos;/g, "'")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
    }

    function textOf(el) {
        return htmlDecode((el?.textContent || "").replace(/\s+/g, " ").trim());
    }

    function getAttr(el, ...attrs) {
        if (!el) return "";
        for (const attr of attrs) {
            const v = el.getAttribute(attr);
            if (v && String(v).trim()) return String(v).trim();
        }
        return "";
    }

    function pathOf(url) {
        try {
            return new URL(url).pathname.toLowerCase();
        } catch (_) {
            return String(url || "").toLowerCase();
        }
    }

    function isContentPath(url) {
        const path = pathOf(url);
        if (!path || path === "/") return false;
        return !EXCLUDE_PATHS.some((p) => path.includes(p));
    }

    function cleanTitle(raw) {
        let t = htmlDecode(String(raw || "")).replace(/\s+/g, " ").trim();
        t = t.replace(/^(nonton|streaming)\s+(movie|series|film|donghua|anime)\s+/i, "");
        t = t.replace(/^(nonton|streaming)\s+/i, "");
        t = t.replace(/\s+subtitle\s+indonesia.*$/i, "");
        t = t.replace(/\s+sub\s+indo.*$/i, "");
        return t.trim();
    }

    function fixImageQuality(url) {
        if (!url) return "";
        return url.replace(/-(\d+)x(\d+)\.(jpe?g|png|webp)$/i, ".$3");
    }

    function extractQuality(text) {
        const t = String(text || "").toLowerCase();
        if (t.includes("2160") || t.includes("4k")) return "4K";
        if (t.includes("1080")) return "1080p";
        if (t.includes("720")) return "720p";
        if (t.includes("480")) return "480p";
        if (t.includes("360")) return "360p";
        if (t.includes("cam")) return "CAM";
        if (t.includes("sd")) return "SD";
        if (t.includes("hd")) return "HD";
        return "Auto";
    }

    function normalizeSearchQuery(query) {
        let q = String(query || "").trim();
        try { q = decodeURIComponent(q); } catch (_) {}
        q = q.replace(/\+/g, " ");
        q = q.replace(/^["']|["']$/g, "");
        return q.trim();
    }

    function scoreResult(item, query) {
        const title = (item.title || "").toLowerCase();
        const q = query.toLowerCase();
        const qWords = q.split(/\s+/).filter(w => w.length > 0);
        if (title.includes(q)) return 3;
        const allMatch = qWords.every(word => title.includes(word));
        if (allMatch) return 2;
        const anyMatch = qWords.some(word => title.includes(word));
        if (anyMatch) return 1;
        return 0;
    }

    function uniqueByUrl(items) {
        const out = [];
        const seen = new Set();
        for (const it of items) {
            if (!it || !it.url || seen.has(it.url)) continue;
            seen.add(it.url);
            out.push(it);
        }
        return out;
    }

    // --- Network ---
    async function request(url, headers = BASE_HEADERS) {
        return http_get(url, { headers });
    }

    async function loadDoc(url, headers = BASE_HEADERS) {
        if (!isTrustedNavigationUrl(url)) {
            throw new Error(`BLOCKED_REDIRECT_HOST: ${url}`);
        }
        const res = await request(url, headers);
        const finalUrl = String(res?.finalUrl || res?.url || url || "");
        if (!isTrustedNavigationUrl(finalUrl)) {
            throw new Error(`BLOCKED_REDIRECT_HOST: ${finalUrl}`);
        }
        if (isCloudflareBlocked(res, finalUrl)) {
            throw new Error(`CLOUDFLARE_BLOCKED: ${finalUrl}`);
        }
        return await parseHtml(res.body);
    }

    // --- Parsers ---
    function parseItemFromElement(el) {
        if (!el) return null;
        
        const anchor = el.querySelector(".bsx a, a[title], a[href*='episode'], a[href*='season']");
        const href = normalizeUrl(getAttr(anchor, "href"), manifest.baseUrl);
        if (!href) return null;
        if (!isContentPath(href)) return null;

        const img = el.querySelector("img");
        const title = cleanTitle(getAttr(anchor, "title") || textOf(el.querySelector(".tt")) || getAttr(img, "alt"));
        if (!title || title === "Unknown") return null;

        const posterUrl = fixImageQuality(normalizeUrl(getAttr(img, "src", "data-src"), manifest.baseUrl));

        let type = "series";
        const typeText = textOf(el.querySelector(".typez, .type, .status"));
        if (typeText.toLowerCase().includes("movie")) type = "movie";

        return new MultimediaItem({
            title,
            url: href,
            posterUrl,
            type,
            contentType: type
        });
    }

    // --- Fetch Functions ---
    async function fetchSection(path, maxPages = 1, page = 1) {
        const all = [];
        for (let p = page; p <= maxPages; p += 1) {
            try {
                let url;
                if (p <= 1 && page <= 1) {
                    url = `${manifest.baseUrl}${path}`;
                } else {
                    const hasQuery = path.includes('?');
                    if (hasQuery) {
                        url = `${manifest.baseUrl}${path}&page=${p}`;
                    } else {
                        url = `${manifest.baseUrl}${path}page=${p}/`;
                    }
                }
                const doc = await loadDoc(url);
                
                // Try different selectors based on page structure
                let items = [];
                
                // First try: standard listupd articles
                items = Array.from(doc.querySelectorAll("div.listupd article"))
                    .map(parseItemFromElement)
                    .filter(Boolean);
                
                // Second try: bsx divs (alternative structure)
                if (items.length === 0) {
                    items = Array.from(doc.querySelectorAll("div.bsx"))
                        .map(parseItemFromElement)
                        .filter(Boolean);
                }
                
                // Third try: any article with anchor
                if (items.length === 0) {
                    items = Array.from(doc.querySelectorAll("article"))
                        .map(parseItemFromElement)
                        .filter(Boolean);
                }

                if (items.length === 0 && p > 1) break;
                all.push(...items);
                if (all.length >= 36) break;
            } catch (e) {
                if (p === 1) return [];
                break;
            }
        }
        return uniqueByUrl(all);
    }

    // --- Core Functions ---
    async function getHome(cb) {
        try {
            const sections = [
                { name: "🔥 Popular", path: "/anime/?order=popular" },
                { name: "🆕 Latest Updates", path: "/anime/?order=update" },
                { name: "📺 Ongoing", path: "/anime/?status=ongoing&order=update" },
                { name: "✅ Completed", path: "/anime/?status=completed&order=update" },
                { name: "🎬 Movies", path: "/anime/?type=movie&order=update" }
            ];

            const data = {};
            for (const sec of sections) {
                try {
                    const items = await fetchSection(sec.path, 1, 1);
                    if (items && items.length > 0) {
                        data[sec.name] = items.slice(0, 20);
                    }
                } catch (e) {
                    // Skip failed sections
                }
            }

            // Fallback to homepage if all sections fail
            if (Object.keys(data).length === 0) {
                const items = await fetchSection("/", 1, 1);
                if (items && items.length > 0) data["🏠 Terbaru"] = items.slice(0, 20);
            }

            cb({ success: true, data });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: String(e?.message || e) });
        }
    }

    async function search(query, cb) {
        try {
            const normalizedQuery = normalizeSearchQuery(query);
            const encoded = encodeURIComponent(normalizedQuery);
            const url = `${manifest.baseUrl}/?s=${encoded}`;

            const doc = await loadDoc(url);
            const items = Array.from(doc.querySelectorAll("div.listupd article"))
                .map(parseItemFromElement)
                .filter(Boolean);

            const out = items.filter(it => scoreResult(it, normalizedQuery) > 0);
            out.sort((a, b) => scoreResult(b, normalizedQuery) - scoreResult(a, normalizedQuery));

            cb({ success: true, data: uniqueByUrl(out) });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String(e?.message || e) });
        }
    }

    async function load(url, cb) {
        try {
            const doc = await loadDoc(url);

            const title = cleanTitle(textOf(doc.querySelector("h1.entry-title")));
            const posterUrl = fixImageQuality(normalizeUrl(getAttr(doc.querySelector(".ime img, meta[property='og:image']"), "src", "content"), manifest.baseUrl));
            const description = textOf(doc.querySelector("div.entry-content, .desc"));

            const episodes = Array.from(doc.querySelectorAll(".eplister li")).map((ep, idx) => {
                const a = ep.querySelector("a");
                const epTitle = textOf(ep.querySelector(".epl-title"));
                const epSub = textOf(ep.querySelector(".epl-sub span"));
                return new Episode({
                    name: `Episode ${idx + 1} - ${epTitle} ${epSub}`.trim(),
                    url: normalizeUrl(getAttr(a, "href"), manifest.baseUrl),
                    season: 1,
                    episode: idx + 1,
                    posterUrl
                });
            }).reverse();

            const type = textOf(doc.querySelector(".spe")).toLowerCase().includes("movie") ? "movie" : "series";

            const item = new MultimediaItem({
                title,
                url,
                posterUrl,
                description,
                type,
                contentType: type,
                episodes: episodes
            });

            cb({ success: true, data: item });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: String(e?.message || e) });
        }
    }

    // --- Extractors ---
    async function resolveOkRu(url, label = "OK.ru") {
        try {
            const embedUrl = url.replace("/video/", "/videoembed/");
            const res = await request(embedUrl);
            const html = res.body || "";
            const cleanHtml = html.replace(/\\&quot;/g, '"').replace(/\\\\/g, "\\");
            const videosMatch = cleanHtml.match(/"videos":\s*(\[[^\]]*\])/);
            if (!videosMatch) return [];
            const videos = JSON.parse(videosMatch[1]);
            return videos.map(v => {
                const videoUrl = v.url.startsWith("//") ? `https:${v.url}` : v.url;
                return new StreamResult({
                    url: videoUrl,
                    quality: extractQuality(v.name),
                    source: `${label} - ${v.name}`,
                    headers: { "User-Agent": UA }
                });
            }).reverse();
        } catch (_) { return []; }
    }

    async function resolveDailymotion(url, label = "Dailymotion") {
        try {
            const id = url.match(/\/video\/([a-zA-Z0-9]+)/)?.[1] || url.match(/\/embed\/video\/([a-zA-Z0-9]+)/)?.[1] || url.split("video=")[1];
            if (!id) return [];
            const metaUrl = `https://www.dailymotion.com/player/metadata/video/${id}`;
            const res = await request(metaUrl);
            const json = JSON.parse(res.body || "{}");
            if (json.qualities && json.qualities.auto) {
                return [new StreamResult({
                    url: json.qualities.auto[0].url,
                    quality: "Auto",
                    source: label,
                    headers: { "User-Agent": UA }
                })];
            }
        } catch (_) {}
        return [];
    }

    async function resolveRumble(url, label = "Rumble") {
        try {
            const res = await request(url);
            const html = res.body || "";
            const m3u8Match = html.match(/"url":"(https?:\/\/.*?\.m3u8)"/);
            if (m3u8Match) {
                return [new StreamResult({
                    url: m3u8Match[1].replace(/\\\//g, "/"),
                    quality: "Auto",
                    source: label,
                    headers: { "User-Agent": UA }
                })];
            }
        } catch (_) {}
        return [];
    }

    async function resolveBuzzHeavier(url, label = "BuzzHeavier") {
        try {
            const res = await request(url);
            const html = res.body || "";
            const evalMatch = html.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\)/);
            if (evalMatch) {
                try {
                    const unpacked = unpackJs(evalMatch[0]);
                    const m3u8 = unpacked.match(/file:\s*["']([^"']*?m3u8[^"']*?)["']/)?.[1];
                    if (m3u8) {
                        return [new StreamResult({
                            url: m3u8,
                            quality: "Auto",
                            source: label,
                            headers: { "Referer": url, "User-Agent": UA }
                        })];
                    }
                } catch (_) {}
            }
            const m3u8 = html.match(/["'](https?:\/\/[^"']*?\.m3u8[^"']*?)["']/)?.[1];
            if (m3u8) {
                return [new StreamResult({
                    url: m3u8,
                    quality: "Auto",
                    source: label,
                    headers: { "Referer": url, "User-Agent": UA }
                })];
            }
        } catch (_) {}
        return [];
    }

    async function resolveEfekStream(url, label, referer = "") {
        try {
            const res = await request(url, {
                "User-Agent": UA,
                "Referer": referer || manifest.baseUrl + "/"
            });
            const html = res.body || "";
            const evalMatch = html.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\)/);
            if (evalMatch) {
                try {
                    const unpacked = unpackJs(evalMatch[0]);
                    const m3u8 = unpacked.match(/file:\s*["']([^"']*?m3u8[^"']*?)["']/)?.[1];
                    if (m3u8) {
                        return [new StreamResult({
                            url: m3u8,
                            quality: "Auto",
                            source: label,
                            headers: { "Referer": url, "User-Agent": UA }
                        })];
                    }
                } catch (_) {}
            }
            const m3u8 = html.match(/["'](https?:\/\/[^"']*?\.m3u8[^"']*?)["']/)?.[1];
            if (m3u8) {
                return [new StreamResult({
                    url: m3u8,
                    quality: "Auto",
                    source: label,
                    headers: { "Referer": url, "User-Agent": UA }
                })];
            }
        } catch (_) {}
        return [];
    }

    async function resolveStreamRuby(url, label = "StreamRuby") {
        try {
            const id = url.match(/embed-([a-zA-Z0-9]+)\.html/)?.[1];
            if (!id) return [];
            const domain = new URL(url).origin;
            const res = await http_post(`${domain}/dl`, {
                headers: { "Referer": url, "Content-Type": "application/x-www-form-urlencoded" },
                body: `op=embed&file_code=${id}&auto=1`
            });
            const html = res.body || "";
            let script = html;
            const packedMatch = html.match(/eval\(function\(p,a,c,k,e,d\){[\s\S]*?}\)/);
            if (packedMatch) {
                try {
                    script = unpackJs(packedMatch[0]);
                } catch (_) {}
            }
            const m3u8 = script.match(/file:\s*["']([^"']*?m3u8[^"']*?)["']/)?.[1];
            if (m3u8) {
                return [new StreamResult({
                    url: m3u8,
                    quality: "Auto",
                    source: label,
                    headers: { "Referer": domain, "User-Agent": UA }
                })];
            }
        } catch (_) {}
        return [];
    }

    async function resolveVidguard(url, label = "Vidguard") {
        try {
            const embedUrl = url.replace("/d/", "/e/").replace("/v/", "/e/");
            const res = await request(embedUrl);
            const html = res.body || "";
            const evalMatch = html.match(/<script[^>]*>([\s\S]*?eval\(function\(p,a,c,k,e,d\)[\s\S]*?\))<\/script>/);
            if (!evalMatch) return [];
            const packed = evalMatch[1];
            let unpacked = "";
            try {
                unpacked = unpackJs(packed);
            } catch (_) {
                return [];
            }
            const svgMatch = unpacked.match(/svg\s*=\s*(\{[\s\S]*?\});/);
            if (!svgMatch) return [];
            const svgObj = JSON.parse(svgMatch[1]);
            if (!svgObj.stream) return [];
            const decodedUrl = decodeVidguardStream(svgObj.stream);
            return [new StreamResult({
                url: decodedUrl,
                quality: "Auto",
                source: label,
                headers: { "Referer": embedUrl, "User-Agent": UA }
            })];
        } catch (_) {
            return [];
        }
    }

    function unpackJs(packed) {
        const paramsMatch = packed.match(/eval\(function\(p,a,c,k,e,d\)\{.*?"(.*?)",(\d+),(\d+),.*?\.split\("\|"\)/);
        if (!paramsMatch) return packed;
        const payload = paramsMatch[1];
        const radix = parseInt(paramsMatch[2], 10);
        const dict = payload.split("|");
        let result = "";
        for (let i = 0; i < dict.length; i++) {
            const key = i.toString(radix);
            const val = dict[i] || key;
            result += (val || key);
        }
        return result;
    }

    function decodeVidguardStream(encodedUrl) {
        try {
            const sigMatch = encodedUrl.match(/[?&]sig=([^&]+)/);
            if (!sigMatch) return encodedUrl;
            const sig = sigMatch[1];
            let decoded = "";
            for (let i = 0; i < sig.length; i += 2) {
                const hex = sig.substring(i, i + 2);
                const charCode = parseInt(hex, 16) ^ 2;
                decoded += String.fromCharCode(charCode);
            }
            decoded = atob(decoded);
            decoded = decoded.replace(/=+$/, "");
            let chars = decoded.split("");
            for (let i = 0; i < chars.length - 1; i += 2) {
                const temp = chars[i];
                chars[i] = chars[i + 1];
                chars[i + 1] = temp;
            }
            decoded = chars.join("");
            decoded = decoded.slice(0, -5);
            return encodedUrl.replace(sig, decoded);
        } catch (_) {
            return encodedUrl;
        }
    }

    async function resolvePlayerLink(playerLink, label, referer = "") {
        let link = playerLink || "";
        if (!link || link.includes("about:blank")) return [];

        if (!link.startsWith("http") && !link.startsWith("//") && link.length > 10) {
            try {
                const decoded = atob(link);
                if (decoded.includes("<iframe")) {
                    const m = decoded.match(/src=["'](.*?)["']/);
                    if (m) link = m[1];
                } else if (decoded.startsWith("http") || decoded.startsWith("//")) {
                    link = decoded;
                }
            } catch (_) {}
        }

        link = normalizeUrl(link, manifest.baseUrl);
        if (!link.startsWith("http")) return [];

        if (link.includes("anichin.stream") || link.includes("rumble.com")) {
            const rumbleId = link.match(/[?&]id=([a-zA-Z0-9]+)/)?.[1] || link.match(/\/embed\/([a-zA-Z0-9]+)/)?.[1];
            const rumbleUrl = rumbleId ? `https://rumble.com/embed/${rumbleId}/` : link;
            return await resolveRumble(rumbleUrl, label || "Rumble");
        }
        if (link.includes("ok.ru")) return await resolveOkRu(link, label || "OK.ru");
        if (link.includes("dailymotion.com") || link.includes("geo.dailymotion.com")) return await resolveDailymotion(link, label || "Dailymotion");
        if (link.includes("ruby") || link.includes("streamruby") || link.includes("svilla") || link.includes("svanila")) {
            return await resolveStreamRuby(link, label || "StreamRuby");
        }
        if (link.includes("vidguard") || link.includes("bembed.net") || link.includes("listeamed.net") || link.includes("vgfplay.com")) {
            return await resolveVidguard(link, label || "Vidguard");
        }
        if (link.includes("buzzheavier.com")) return await resolveBuzzHeavier(link, label);
        if (link.includes("efek.stream")) return await resolveEfekStream(link, label, referer);

        return [new StreamResult({
            url: link,
            quality: "Auto",
            source: label || "Player",
            headers: { "Referer": referer || manifest.baseUrl + "/", "User-Agent": UA }
        })];
    }

    async function expandHlsVariants(stream) {
        const baseUrl = String(stream?.url || "");
        if (!/\.m3u8(\?|$)/i.test(baseUrl)) return [stream];
        try {
            const headers = Object.assign({}, BASE_HEADERS, stream?.headers || {});
            const res = await request(baseUrl, headers);
            const text = String(res?.body || "");
            if (!/#EXT-X-STREAM-INF/i.test(text)) return [stream];

            const lines = text.split(/\r?\n/);
            const variants = [];
            const seenVariantUrl = new Set();

            for (let i = 0; i < lines.length; i += 1) {
                const line = lines[i];
                if (!/^#EXT-X-STREAM-INF:/i.test(line)) continue;
                const nextLine = (lines[i + 1] || "").trim();
                if (!nextLine || nextLine.startsWith("#")) continue;

                const resMatch = line.match(/RESOLUTION=\d+x(\d+)/i);
                const quality = resMatch?.[1] ? `${resMatch[1]}p` : "Auto";

                const variantUrl = resolveUrl(baseUrl, nextLine);
                if (!variantUrl || seenVariantUrl.has(variantUrl)) continue;
                seenVariantUrl.add(variantUrl);

                const baseSource = stream.source || stream.name || "HLS";
                variants.push(new StreamResult({
                    url: variantUrl,
                    quality,
                    source: `${baseSource} - ${quality}`,
                    headers: stream.headers || { "Referer": manifest.baseUrl + "/", "User-Agent": UA }
                }));
            }

            if (variants.length > 0) {
                const baseSource = stream.source || stream.name || "HLS";
                variants.unshift(new StreamResult({
                    url: baseUrl,
                    quality: "Auto",
                    source: `${baseSource} - Auto`,
                    headers: stream.headers || { "Referer": manifest.baseUrl + "/", "User-Agent": UA }
                }));
                return variants;
            }
            return [stream];
        } catch (_) {
            return [stream];
        }
    }

    async function loadStreams(url, cb) {
        try {
            const doc = await loadDoc(url);
            const rawStreams = [];

            const options = Array.from(doc.querySelectorAll(".mobius option, .mirror option"));
            for (const opt of options) {
                const val = getAttr(opt, "value");
                if (val && val.length > 5) {
                    const label = textOf(opt) || "Server";
                    let decodedUrl = val;
                    try {
                        const decoded = atob(val);
                        if (decoded && decoded.includes("<iframe")) {
                            const iframeMatch = decoded.match(/src=["'](.*?)["']/);
                            if (iframeMatch && iframeMatch[1]) {
                                decodedUrl = iframeMatch[1];
                            }
                        } else if (decoded && decoded.startsWith("http")) {
                            decodedUrl = decoded;
                        }
                    } catch (_) {}

                    try {
                        const results = await resolvePlayerLink(decodedUrl, label, url);
                        rawStreams.push(...results);
                    } catch (_) {}
                }
            }

            if (rawStreams.length === 0) {
                const ifr = doc.querySelector("iframe[src], .video-content iframe");
                if (ifr) {
                    const results = await resolvePlayerLink(getAttr(ifr, "src"), "Embed", url);
                    rawStreams.push(...results);
                }
            }

            const expanded = [];
            for (const s of rawStreams) {
                try {
                    const variants = await expandHlsVariants(s);
                    expanded.push(...variants);
                } catch (_) {
                    expanded.push(s);
                }
            }

            const uniq = [];
            const seen = new Set();
            for (const s of expanded) {
                if (!/\.(m3u8|mp4)(\?|$)/i.test(String(s.url || ""))) continue;
                const key = `${s.url}|${s.quality || ""}`;
                if (!s.url || seen.has(key)) continue;
                seen.add(key);
                uniq.push(s);
            }

            cb({ success: true, data: uniq });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: String(e?.message || e) });
        }
    }

    // Export
    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
