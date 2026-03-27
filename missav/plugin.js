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
        "Referer": `${manifest.baseUrl}/`
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

    function decodeEscapedUrl(raw) {
        let out = String(raw || "").trim();
        if (!out) return "";

        out = out
            .replace(/\\u002F/gi, "/")
            .replace(/\\u003A/gi, ":")
            .replace(/\\\//g, "/")
            .replace(/\\x2f/gi, "/")
            .replace(/\\x3a/gi, ":")
            .replace(/&amp;/gi, "&");

        return out;
    }

    function cleanupStreamUrl(rawUrl, pageUrl) {
        const decoded = decodeEscapedUrl(rawUrl)
            .replace(/["'`]/g, "")
            .trim();

        if (!decoded || !/\.m3u8(\?|$)/i.test(decoded)) return "";

        if (decoded.startsWith("//")) return `https:${decoded}`;
        if (/^https?:\/\//i.test(decoded)) return decoded;

        try {
            return new URL(decoded, String(pageUrl || manifest.baseUrl)).toString();
        } catch (_) {
            return normalizeUrl(decoded, manifest.baseUrl);
        }
    }

    function collectM3u8Candidates(text) {
        const body = decodeEscapedUrl(text || "");
        if (!body) return [];

        const candidates = new Set();
        const patterns = [
            /(?:file|src|source|hls|playlist|video_url|play_url)\s*[:=]\s*["']([^"'\n\r]+?\.m3u8[^"'\n\r]*)["']/gi,
            /["']((?:https?:)?\/\/[^"'\s]+?\.m3u8[^"'\s]*)["']/gi,
            /["']((?:\/?[^"'\s]+?\.m3u8[^"'\s]*))["']/gi
        ];

        for (const rx of patterns) {
            let m;
            while ((m = rx.exec(body)) !== null) {
                const u = String(m[1] || "").trim();
                if (u && /\.m3u8(\?|$)/i.test(u)) candidates.add(u);
            }
        }

        return Array.from(candidates);
    }

    function candidatePriority(url) {
        const u = String(url || "").toLowerCase();
        if (u.includes("/1080p/") || u.includes("source1280")) return 100;
        if (u.includes("/720p/") || u.includes("source842")) return 90;
        if (u.includes("master.m3u8")) return 80;
        if (u.includes("playlist.m3u8")) return 70;
        return 10;
    }

    function qualityPriority(value) {
        const q = String(value || "").toLowerCase();
        if (q === "auto") return 0;
        const m = q.match(/(\d{3,4})p/);
        if (m) return parseInt(m[1], 10);
        return 1;
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

    async function expandHlsVariants(stream) {
        const baseUrl = String(stream?.url || "");
        if (!/\.m3u8(\?|$)/i.test(baseUrl)) return [stream];

        try {
            const referer = stream?.headers?.Referer || `${manifest.baseUrl}/`;
            const headers = Object.assign({}, BASE_HEADERS, stream?.headers || {}, { Referer: referer });
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
                    headers: Object.assign({}, stream?.headers || {}, { Referer: referer, "User-Agent": UA })
                }));
            }

            if (variants.length > 0) {
                // Prefer highest resolution first.
                variants.sort((a, b) => qualityPriority(b.quality) - qualityPriority(a.quality));

                const baseSource = stream.source || stream.name || "HLS";
                variants.push(new StreamResult({
                    url: baseUrl,
                    quality: "Auto",
                    source: `${baseSource} - Auto`,
                    headers: Object.assign({}, stream?.headers || {}, { Referer: referer, "User-Agent": UA })
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
            const res = await request(url, { Referer: `${manifest.baseUrl}/` });
            const html = res.body || "";
            const finalUrl = String(res?.finalUrl || res?.url || url || "");
            
            if (isCloudflareBlocked(res, finalUrl)) {
                throw new Error(`CLOUDFLARE_BLOCKED: ${finalUrl}`);
            }

            const rawStreams = [];
            const seenRaw = new Set();
            const referer = finalUrl || url || `${manifest.baseUrl}/`;

            function addStreamCandidate(candidateUrl, source) {
                const cleaned = cleanupStreamUrl(candidateUrl, referer);
                if (!cleaned || seenRaw.has(cleaned)) return;
                seenRaw.add(cleaned);

                rawStreams.push(new StreamResult({
                    url: cleaned,
                    quality: "Auto",
                    source,
                    headers: { "Referer": referer, "User-Agent": UA }
                }));
            }

            // MissAV usually has the m3u8 inside a packed script.
            // Some pages might have multiple eval blocks.
            const packedRegex = /eval\(function\(p,a,c,k,e,d\)[\s\S]*?\}\([\s\S]*?\)\)/g;
            let packedMatch;
            while ((packedMatch = packedRegex.exec(html)) !== null) {
                const unpacked = unpackJs(packedMatch[0]);
                for (const u of collectM3u8Candidates(unpacked)) {
                    addStreamCandidate(u, "MissAV Packed");
                }
            }

            // Fallback: look for m3u8 in full page HTML
            if (rawStreams.length === 0) {
                for (const u of collectM3u8Candidates(html)) {
                    addStreamCandidate(u, "MissAV Fallback");
                }
            }

            const expanded = [];
            rawStreams.sort((a, b) => candidatePriority(b.url) - candidatePriority(a.url));
            for (const s of rawStreams) {
                try {
                    const variants = await expandHlsVariants(s);
                    expanded.push(...variants);
                } catch (_) {
                    expanded.push(s);
                }
            }

            const uniq = [];
            const finalSeen = new Set();
            for (const s of expanded) {
                if (!s.url) continue;
                const key = `${s.url}|${s.quality || ""}`;
                if (finalSeen.has(key)) continue;
                finalSeen.add(key);
                uniq.push(s);
            }

            uniq.sort((a, b) => {
                const qp = qualityPriority(b.quality) - qualityPriority(a.quality);
                if (qp !== 0) return qp;
                return candidatePriority(b.url) - candidatePriority(a.url);
            });

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
