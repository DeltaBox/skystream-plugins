(function() {
    /**
     * @type {import('@skystream/sdk').Manifest}
     */
    // manifest is injected at runtime

    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

    const BASE_HEADERS = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "max-age=0",
        "Sec-Ch-Ua": '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        "Referer": `https://missav.ws/`
    };

    const EXCLUDE_PATHS = [
        "/genre", "/country", "/negara", "/tahun", "/year", "/page/",
        "/privacy", "/dmca", "/faq", "/request", "/wp-",
        "/author", "/category", "/tag", "/feed", "javascript:"
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

    function isCloudflareBlocked(response, targetUrl) {
        const body = String(response?.body || "");
        const title = (body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || "").toLowerCase();
        if (/cloudflare/i.test(body) && /attention required|verify you are human|just a moment|cf-ray|cf-chl/i.test(body)) return true;
        if (title.includes("just a moment") || title.includes("attention required")) return true;
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

    function normalizeSearchQuery(query) {
        let q = String(query || "").trim();
        try { q = decodeURIComponent(q); } catch (_) {}
        q = q.replace(/\+/g, " ");
        q = q.replace(/^["']|["']$/g, "");
        return q.trim();
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

    function unpackJs(packed) {
        try {
            const match = packed.match(/}\s*\(\s*(['"].+?['"])\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"].+?['"])\.split\(['"]\|['"]\)/);
            if (!match) return packed;

            let p = match[1];
            let a = parseInt(match[2], 10);
            let c = parseInt(match[3], 10);
            let k = match[4].slice(1, -1).split("|");

            if (p.startsWith("'") || p.startsWith("\"")) p = p.slice(1, -1);

            const e = (c) => {
                return (c < a ? "" : e(parseInt(c / a, 10))) + ((c = c % a) > 35 ? String.fromCharCode(c + 29) : c.toString(36));
            };

            const dict = {};
            while (c--) {
                dict[e(c)] = k[c] || e(c);
            }

            return p.replace(/\b\w+\b/g, (w) => dict[w] || w);
        } catch (_) {
            return packed;
        }
    }

    // --- Network ---
    async function request(url, headers = {}) {
        return http_get(url, { headers: Object.assign({}, BASE_HEADERS, headers) });
    }

    async function loadDoc(url, headers = {}) {
        const res = await request(url, headers);
        const finalUrl = String(res?.finalUrl || res?.url || url || "");
        if (isCloudflareBlocked(res, finalUrl)) {
            throw new Error(`CLOUDFLARE_BLOCKED: ${finalUrl}`);
        }
        return await parseHtml(res.body);
    }

    // --- Parsers ---
    function parseItemFromElement(el) {
        if (!el) return null;
        
        const anchor = el.querySelector("a[href*='/en/'], a[href*='/dm']");
        const href = normalizeUrl(getAttr(anchor, "href"), manifest.baseUrl);
        if (!href) return null;

        const img = el.querySelector("img");
        // Title is often in a.text-secondary or the anchor itself
        let title = textOf(el.querySelector("a.text-secondary")) || getAttr(anchor, "title") || getAttr(img, "alt");
        if (!title || title === "Unknown") return null;

        const blacklist = ["Recent update", "Contact", "Support", "DMCA", "Home"];
        if (blacklist.some(b => title.toLowerCase() === b.toLowerCase())) return null;

        const isUncensored = (getAttr(img, "alt") + getAttr(anchor, "href") + el.outerHTML).toLowerCase().includes("uncensored");
        if (isUncensored && !title.toLowerCase().startsWith("uncensored")) {
            title = `Uncensored - ${title}`;
        }

        const posterUrl = normalizeUrl(getAttr(img, "data-src", "src"), manifest.baseUrl);

        return new MultimediaItem({
            title,
            url: href,
            posterUrl,
            type: "movie",
            contentType: "movie"
        });
    }

    // --- Core Functions ---
    async function getHome(cb) {
        try {
            const sections = [
                { name: "Recommended", path: "/en" },
                { name: "New Release", path: "/en/genres/New%20Release" },
                { name: "Mature Woman", path: "/en/genres/Mature%20Woman" },
                { name: "Creampie", path: "/en/genres/Creampie" },
                { name: "Uncensored", path: "/dm628/en/uncensored-leak?sort=monthly_views" },
                { name: "Monthly Hot", path: "/dm263/en/monthly-hot?sort=views" },
                { name: "Weekly Hot", path: "/dm169/en/weekly-hot?sort=weekly_views" }
            ];

            const data = {};
            let lastError = null;
            for (const sec of sections) {
                try {
                    const doc = await loadDoc(`${manifest.baseUrl}${sec.path}`);
                    const items = Array.from(doc.querySelectorAll("div.grid.grid-cols-2 > div, div.thumbnail.group"))
                        .map(parseItemFromElement)
                        .filter(Boolean);
                    if (items.length > 0) {
                        data[sec.name] = uniqueByUrl(items).slice(0, 24);
                    }
                } catch (e) {
                    lastError = e;
                }
            }

            if (Object.keys(data).length === 0 && lastError) {
                cb({ success: false, errorCode: "HOME_EMPTY", message: String(lastError?.message || lastError) });
                return;
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
            const url = `${manifest.baseUrl}/en/search/${encoded}`;

            const doc = await loadDoc(url);
            const items = Array.from(doc.querySelectorAll("div.grid.grid-cols-2 > div"))
                .map(parseItemFromElement)
                .filter(Boolean);

            cb({ success: true, data: uniqueByUrl(items) });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String(e?.message || e) });
        }
    }

    async function load(url, cb) {
        try {
            const doc = await loadDoc(url);

            const title = textOf(doc.querySelector("h1"));
            const posterUrl = getAttr(doc.querySelector("meta[property='og:image']"), "content");
            const description = textOf(doc.querySelector("div.mb-4 .mb-1.text-secondary"));
            
            // Extract extra metadata
            const yearText = textOf(doc.querySelector("div.extra span.C a"));
            const year = parseInt(yearText, 10) || null;
            
            const tags = Array.from(doc.querySelectorAll("span:containsOwn(Genre) ~ a, .genres a"))
                .map(el => textOf(el))
                .filter(Boolean);

            const durationText = textOf(doc.querySelector("span.runtime"));
            const duration = parseInt(durationText, 10) || null;

            const actors = Array.from(doc.querySelectorAll("span:containsOwn(Actress) ~ a, .actresses a"))
                .map(el => textOf(el))
                .filter(Boolean);

            const episodes = [new Episode({
                name: title,
                url: url,
                season: 1,
                episode: 1,
                posterUrl
            })];

            const item = new MultimediaItem({
                title,
                url,
                posterUrl,
                description,
                type: "movie",
                contentType: "movie",
                year,
                duration,
                tags,
                actors,
                episodes: episodes
            });

            cb({ success: true, data: item });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: String(e?.message || e) });
        }
    }

    async function loadStreams(url, cb) {
        try {
            const res = await request(url);
            const html = res.body || "";
            const streams = [];

            const packedMatch = html.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\}\([\s\S]*?\)\)/);
            if (packedMatch) {
                const unpacked = unpackJs(packedMatch[0]);
                const m3u8Match = unpacked.match(/source=['"](.*?)['"]/);
                if (m3u8Match) {
                    const m3u8Url = m3u8Match[1];
                    streams.push(new StreamResult({
                        url: m3u8Url,
                        quality: "Auto",
                        source: "MissAV",
                        headers: { "Referer": "https://missav.com", "User-Agent": UA }
                    }));
                }
            } else {
                // Fallback attempt to find m3u8 in plain script
                const m3u8Regex = /["'](https?:\/\/[^"']*?\.m3u8[^"']*?)["']/gi;
                let match;
                while ((match = m3u8Regex.exec(html)) !== null) {
                    streams.push(new StreamResult({
                        url: match[1],
                        quality: "Auto",
                        source: "MissAV Fallback",
                        headers: { "Referer": "https://missav.com", "User-Agent": UA }
                    }));
                }
            }

            cb({ success: true, data: uniqueByUrl(streams) });
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
