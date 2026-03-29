(function() {
    /**
     * @type {import('@skystream/sdk').Manifest}
     */
    // manifest is injected at runtime

    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
    const LOCALE_FALLBACKS = ["en", "id"];

    const BASE_HEADERS = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
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

    function extractDm(pathOrUrl) {
        const text = String(pathOrUrl || "");
        const m = text.match(/\/(dm\d+)\//i);
        return m ? m[1].toLowerCase() : "";
    }

    function extractLocale(pathOrUrl) {
        const text = String(pathOrUrl || "");
        const m = text.match(/\/(en|id|ja|ko|zh|cn|ms|th|de|fr|vi|fil|pt)\//i);
        return m ? m[1].toLowerCase() : "";
    }

    function stripLeadingLocale(path) {
        return String(path || "").replace(/^\/(?:en|id|ja|ko|zh|cn|ms|th|de|fr|vi|fil|pt)(?=\/|$)/i, "") || "/";
    }

    function toSourceUrl(path, locale = "en", dm = "") {
        const base = String(manifest.baseUrl || "").replace(/\/+$/, "");
        const raw = String(path || "").trim();
        if (!raw) return `${base}/${dm ? `${dm}/` : ""}${locale}`;
        if (/^https?:\/\//i.test(raw)) return raw;
        if (/^\/dm\d+\//i.test(raw)) return `${base}${raw}`;
        if (raw === "/") return `${base}/${dm ? `${dm}/` : ""}${locale}`;
        const suffix = stripLeadingLocale(raw);
        return `${base}/${dm ? `${dm}/` : ""}${locale}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
    }

    function toSourceUrlFromInput(input) {
        const raw = String(input || "").trim();
        if (!raw) return toSourceUrl("/", "en", "");
        if (!/^https?:\/\//i.test(raw)) return toSourceUrl(raw.startsWith("/") ? raw : `/${raw}`, "en", "");

        try {
            const u = new URL(raw);
            const segs = u.pathname.split("/").filter(Boolean);
            if (segs[0] && /^dm\d+$/i.test(segs[0])) return u.toString();
            return u.toString();
        } catch (_) {}
        return raw;
    }

    function parseYear(text) {
        const m = String(text || "").match(/\b(19\d{2}|20\d{2})\b/);
        return m ? parseInt(m[1], 10) : null;
    }

    function extractVideoId(input) {
        const raw = String(input || "").trim();
        if (!raw) return "";
        if (!/^https?:\/\//i.test(raw)) return raw.replace(/^\/+|\/+$/g, "");

        const noHash = raw.split("#")[0];
        const [basePart, queryPart = ""] = noHash.split("?");
        if (queryPart) {
            const parts = queryPart.split("&");
            for (const part of parts) {
                const [k, v = ""] = part.split("=");
                if (k === "id" && v) {
                    try { return decodeURIComponent(v).trim(); } catch (_) { return v.trim(); }
                }
            }
        }

        const path = basePart.replace(/^https?:\/\/[^/]+/i, "");
        const segs = path.split("/").filter(Boolean);
        return segs.length ? segs[segs.length - 1] : "";
    }

    function decodeEscapedUrl(raw) {
        return String(raw || "")
            .trim()
            .replace(/\\u002F/gi, "/")
            .replace(/\\u003A/gi, ":")
            .replace(/\\\//g, "/")
            .replace(/\\x2f/gi, "/")
            .replace(/\\x3a/gi, ":")
            .replace(/&amp;/gi, "&");
    }

    function cleanupStreamUrl(rawUrl, pageUrl) {
        const decoded = decodeEscapedUrl(rawUrl).replace(/["'`]/g, "").trim();
        if (!decoded || !/\.m3u8(\?|$)/i.test(decoded)) return "";

        if (decoded.startsWith("//")) return `https:${decoded}`;
        if (/^https?:\/\//i.test(decoded)) return decoded;

        try {
            return new URL(decoded, String(pageUrl || manifest.baseUrl)).toString();
        } catch (_) {
            return "";
        }
    }

    function unpackJs(packed) {
        try {
            let match = packed.match(/}\s*\(\s*'((?:\\.|[^'])*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:\\.|[^'])*)'\.split\('\|'\)/);
            if (!match) {
                match = packed.match(/}\s*\(\s*"((?:\\.|[^"])*)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*"((?:\\.|[^"])*)"\.split\("\|"\)/);
            }
            if (!match) return packed;

            let p = String(match[1] || "")
                .replace(/\\'/g, "'")
                .replace(/\\"/g, '"')
                .replace(/\\\\/g, "\\");
            const a = parseInt(match[2], 10);
            let c = parseInt(match[3], 10);
            const k = String(match[4] || "")
                .replace(/\\'/g, "'")
                .replace(/\\"/g, '"')
                .replace(/\\\\/g, "\\")
                .split("|");

            const e = (n) => (n < a ? "" : e(parseInt(n / a, 10))) + ((n = n % a) > 35 ? String.fromCharCode(n + 29) : n.toString(36));
            const dict = {};
            while (c--) dict[e(c)] = k[c] || e(c);

            return p.replace(/\b\w+\b/g, (w) => dict[w] || w);
        } catch (_) {
            return packed;
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

    function streamQualityFromUrl(url) {
        const u = String(url || "").toLowerCase();
        if (u.includes("/2160p/") || u.includes("/4k/")) return "2160p";
        if (u.includes("/1440p/")) return "1440p";
        if (u.includes("/1080p/") || u.includes("source1280")) return "1080p";
        if (u.includes("/720p/") || u.includes("source842")) return "720p";
        if (u.includes("/480p/")) return "480p";
        if (u.includes("/360p/")) return "360p";
        return "Auto";
    }

    function qualityPriority(value) {
        const q = String(value || "").toLowerCase();
        if (q === "auto") return 0;
        if (q === "4k" || q === "uhd" || q === "2160p") return 2160;
        const m = q.match(/(\d{3,4})p/);
        return m ? parseInt(m[1], 10) : 1;
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

    function uniqueStrings(values) {
        const out = [];
        const seen = new Set();
        for (const value of values || []) {
            const v = String(value || "").trim();
            if (!v || seen.has(v)) continue;
            seen.add(v);
            out.push(v);
        }
        return out;
    }

    function buildDetailCandidates(inputUrl) {
        const raw = String(inputUrl || "").trim();
        const id = extractVideoId(raw);
        const localeFromInput = extractLocale(raw) || "en";
        const dmFromInput = extractDm(raw);
        const dmCandidates = uniqueStrings([dmFromInput, "", "dm78", "dm32", "dm263", "dm628", "dm515", "dm291"]);
        const localeCandidates = uniqueStrings([localeFromInput, "en", "id", "ja"]);

        const candidates = [];
        if (raw) candidates.push(raw);
        if (id) {
            for (const dm of dmCandidates) {
                for (const locale of localeCandidates) {
                    candidates.push(toSourceUrl(`/${id}`, locale, dm));
                }
            }
        } else if (raw) {
            for (const dm of dmCandidates) {
                for (const locale of localeCandidates) {
                    candidates.push(toSourceUrlFromInput(toSourceUrl(raw, locale, dm)));
                }
            }
        }
        return uniqueStrings(candidates);
    }

    function isCloudflareBlocked(response, targetUrl) {
        const body = String(response?.body || "");
        const title = (body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || "").toLowerCase();
        const urlText = String(targetUrl || "").toLowerCase();
        if (/cloudflare/i.test(body) && /attention required|verify you are human|just a moment|cf-ray|cf-chl/i.test(body)) return true;
        if (title.includes("just a moment") || title.includes("attention required")) return true;
        if (urlText.includes("/cdn-cgi/challenge-platform/")) return true;
        return false;
    }

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

    function isLikelyVideoId(id) {
        const normalized = String(id || "").toLowerCase();
        if (!normalized) return false;
        if (["home", "new", "contact", "tags", "genres"].includes(normalized)) return false;
        if (/^(about|faq|terms|privacy|dmca|advertise|support)$/.test(normalized)) return false;
        if (normalized.includes("/") || normalized.includes("?")) return false;
        return /^[a-z0-9]+(?:-[a-z0-9]+)+(?:-uncensored-leak)?$/i.test(normalized);
    }

    function shouldSkipCard(href, title, posterUrl) {
        const hrefText = String(href || "").toLowerCase();
        const titleText = String(title || "").trim().toLowerCase();
        if (!posterUrl) return true;
        if (!titleText || ["home", "recent update", "contact"].includes(titleText)) return true;
        if (/\/(?:new|contact|dmca|about|faq|terms|privacy|support)(?:[/?#]|$)/i.test(hrefText)) return true;
        if (/\/(?:search|tags?|genres?|actresses?)\b/i.test(hrefText)) return true;
        return false;
    }

    function parseVideoCard(el) {
        if (!el) return null;

        const titleEl = el.querySelector(".my-2 a") || el.querySelector("h2.text-secondary a") || el.querySelector("a[href]");
        const href = normalizeUrl(getAttr(titleEl, "href"), manifest.baseUrl);
        if (!href) return null;

        const id = extractVideoId(href);
        if (!isLikelyVideoId(id)) return null;

        const img = el.querySelector("img");
        const posterUrl = normalizeUrl(getAttr(img, "data-src", "src"), manifest.baseUrl);
        const title = textOf(titleEl) || getAttr(img, "alt") || id;
        if (shouldSkipCard(href, title, posterUrl)) return null;

        const code = textOf(el.querySelector(".absolute.top-1.left-1"));
        const duration = textOf(el.querySelector(".absolute.bottom-1.right-1"));
        const quality = textOf(el.querySelector(".absolute.top-1.right-1"));
        const description = [code, quality, duration].filter(Boolean).join(" | ");

        return new MultimediaItem({
            title,
            url: `${String(manifest.baseUrl || "").replace(/\/+$/, "")}/en/${id}`,
            posterUrl,
            description,
            type: "movie",
            contentType: "movie"
        });
    }

    function collectItems(doc) {
        const selectors = [
            ".thumbnail",
            "div.grid.grid-cols-2 > div",
            "div.thumbnail.group"
        ];

        const items = [];
        for (const sel of selectors) {
            const nodes = Array.from(doc.querySelectorAll(sel));
            for (const node of nodes) {
                const item = parseVideoCard(node);
                if (item) items.push(item);
            }
            if (items.length >= 24) break;
        }
        return uniqueByUrl(items);
    }

    async function fetchListByPaths(paths, locales = LOCALE_FALLBACKS, dmCandidates = [""]) {
        for (const path of paths) {
            try {
                for (const dm of dmCandidates) {
                    for (const locale of locales) {
                        const url = toSourceUrl(path, locale, dm);
                        const doc = await loadDoc(url);
                        const items = collectItems(doc);
                        if (items.length > 0) return items;
                    }
                }
            } catch (_) {}
        }
        return [];
    }

    function parseDetailRows(doc) {
        const rows = {};
        const section = doc.querySelector(".space-y-2");
        if (!section) return rows;

        const blocks = Array.from(section.querySelectorAll("div.text-secondary"));
        for (const div of blocks) {
            const labelSpan = div.querySelector("span");
            if (!labelSpan) continue;

            const label = textOf(labelSpan).replace(/[：:]+/g, "").trim().toLowerCase();
            if (!label) continue;

            const links = Array.from(div.querySelectorAll("a")).map((a) => textOf(a)).filter(Boolean);
            if (links.length > 0) {
                rows[label] = links;
                continue;
            }

            const timeEl = div.querySelector("time");
            if (timeEl) {
                rows[label] = textOf(timeEl);
                continue;
            }

            let text = textOf(div);
            const labelText = textOf(labelSpan);
            if (labelText && text.startsWith(labelText)) {
                text = text.slice(labelText.length).replace(/^[：: ]+/, "").trim();
            }
            rows[label] = text;
        }

        return rows;
    }

    function pickScalar(rows, labels) {
        for (const rawLabel of labels) {
            const label = String(rawLabel || "").toLowerCase();
            const v = rows[label];
            if (Array.isArray(v) && v.length > 0) return String(v[0]);
            if (typeof v === "string" && v) return v;
        }
        return "";
    }

    function pickList(rows, labels) {
        for (const rawLabel of labels) {
            const label = String(rawLabel || "").toLowerCase();
            const v = rows[label];
            if (Array.isArray(v)) return v;
            if (typeof v === "string" && v) return [v];
        }
        return [];
    }

    async function expandHlsVariants(stream) {
        const baseUrl = String(stream?.url || "");
        if (!/\.m3u8(\?|$)/i.test(baseUrl)) return [stream];

        try {
            const referer = stream?.headers?.Referer || `${manifest.baseUrl}/`;
            const headers = Object.assign({}, stream?.headers || {}, { Referer: referer, "User-Agent": UA });
            const res = await request(baseUrl, headers);
            const text = String(res?.body || "");
            if (!/#EXT-X-STREAM-INF/i.test(text)) return [stream];

            const lines = text.split(/\r?\n/);
            const variants = [];
            const seen = new Set();

            for (let i = 0; i < lines.length; i += 1) {
                const line = String(lines[i] || "").trim();
                if (!/^#EXT-X-STREAM-INF:/i.test(line)) continue;
                const nextLine = String(lines[i + 1] || "").trim();
                if (!nextLine || nextLine.startsWith("#")) continue;

                const resMatch = line.match(/RESOLUTION=\d+x(\d+)/i);
                const quality = resMatch?.[1] ? `${resMatch[1]}p` : "Auto";

                const variantUrl = resolveUrl(baseUrl, nextLine);
                if (!variantUrl || seen.has(variantUrl)) continue;
                seen.add(variantUrl);

                variants.push(new StreamResult({
                    url: variantUrl,
                    quality,
                    source: `MissAV - ${quality}`,
                    headers
                }));
            }

            if (variants.length === 0) return [stream];
            variants.sort((a, b) => qualityPriority(b.quality) - qualityPriority(a.quality));
            variants.push(new StreamResult({
                url: baseUrl,
                quality: "Auto",
                source: "MissAV - Auto",
                headers
            }));
            return variants;
        } catch (_) {
            return [stream];
        }
    }

    async function getHome(cb) {
        try {
            const dmCandidates = ["", "dm32", "dm263", "dm628", "dm515", "dm291"];
            const sections = [
                { name: "Recommended", paths: ["/en", "/"] },
                { name: "Recent", paths: ["/en/new?page=1", "/new?page=1"] },
                { name: "Trending", paths: ["/en/today-hot?page=1", "/today-hot?page=1"] },
                { name: "Uncensored", paths: ["/uncensored-leak?sort=monthly_views", "/search/uncensored?page=1"] }
            ];
            const data = {};
            for (const section of sections) {
                try {
                    const items = await fetchListByPaths(section.paths, LOCALE_FALLBACKS, dmCandidates);
                    if (items.length > 0) data[section.name] = items.slice(0, 24);
                } catch (_) {}
            }

            if (Object.keys(data).length === 0) {
                cb({
                    success: false,
                    errorCode: "HOME_EMPTY",
                    message: "No items found from source pages (likely blocked by Cloudflare)."
                });
                return;
            }

            cb({ success: true, data });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: String(e?.message || e) });
        }
    }

    async function search(query, cb) {
        try {
            const normalized = normalizeSearchQuery(query);
            const encoded = encodeURIComponent(normalized);
            let items = [];
            const candidates = ["", "dm32", "dm263"];
            for (const dm of candidates) {
                for (const locale of LOCALE_FALLBACKS) {
                    try {
                        const doc = await loadDoc(toSourceUrl(`/search/${encoded}?page=1`, locale, dm));
                        items = collectItems(doc);
                        if (items.length > 0) break;
                    } catch (_) {}
                }
                if (items.length > 0) break;
            }
            cb({ success: true, data: items });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String(e?.message || e) });
        }
    }

    async function load(url, cb) {
        try {
            const candidates = buildDetailCandidates(url);
            let target = toSourceUrlFromInput(url);
            let doc = null;
            let lastErr = null;
            for (const candidate of candidates) {
                try {
                    const parsed = await loadDoc(candidate);
                    const h1 = textOf(parsed.querySelector("h1.text-base")) || textOf(parsed.querySelector("h1"));
                    if (!h1) continue;
                    doc = parsed;
                    target = candidate;
                    break;
                } catch (e) {
                    lastErr = e;
                }
            }
            if (!doc) throw (lastErr || new Error("DETAIL_NOT_FOUND"));

            const title = textOf(doc.querySelector("h1.text-base")) || textOf(doc.querySelector("h1"));
            const posterUrl = normalizeUrl(
                getAttr(doc.querySelector("meta[property='og:image']"), "content") || getAttr(doc.querySelector("img"), "data-src", "src"),
                manifest.baseUrl
            );

            const rows = parseDetailRows(doc);
            const releaseDate = pickScalar(rows, ["release date", "date", "發行日期", "発売日"]);
            const durationText = pickScalar(rows, ["duration", "length", "長度", "时长", "時間"]);
            const studio = pickScalar(rows, ["studio", "maker", "發行商", "メーカー", "製作商"]);
            const label = pickScalar(rows, ["label", "標籤", "レーベル"]);
            const genres = pickList(rows, ["genre", "genres", "類型", "ジャンル"]);
            const actresses = pickList(rows, ["actress", "actresses", "女優", "出演者", "演員"]);
            const tagsExtra = pickList(rows, ["tags", "tag", "標籤"]);

            const tags = uniqueStrings([...(genres || []), ...(tagsExtra || [])]);
            const actors = uniqueStrings(actresses || []);
            const year = parseYear(releaseDate);
            const duration = durationText ? String(durationText) : null;
            const description = [
                releaseDate ? `Release Date: ${releaseDate}` : "",
                duration ? `Duration: ${duration}` : "",
                studio ? `Studio: ${studio}` : "",
                label ? `Label: ${label}` : ""
            ].filter(Boolean).join(" | ");

            const cleanTitle = title || extractVideoId(target) || "MissAV";
            const item = new MultimediaItem({
                title: cleanTitle,
                url: target,
                posterUrl,
                description,
                type: "movie",
                contentType: "movie",
                year,
                duration,
                tags,
                actors,
                episodes: [new Episode({
                    name: cleanTitle,
                    url: target,
                    season: 1,
                    episode: 1,
                    posterUrl
                })]
            });

            cb({ success: true, data: item });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: String(e?.message || e) });
        }
    }

    async function loadStreams(url, cb) {
        try {
            const target = toSourceUrlFromInput(url);

            const res = await request(target, { Referer: `${manifest.baseUrl}/` });
            const html = String(res?.body || "");
            const finalUrl = String(res?.finalUrl || res?.url || target || "");

            if (isCloudflareBlocked(res, finalUrl)) {
                throw new Error(`CLOUDFLARE_BLOCKED: ${finalUrl}`);
            }

            const referer = finalUrl || target || `${manifest.baseUrl}/`;
            const streams = [];
            const seen = new Set();

            const addStream = (rawUrl, sourceName) => {
                const cleaned = cleanupStreamUrl(rawUrl, referer);
                if (!cleaned || seen.has(cleaned)) return;
                seen.add(cleaned);
                streams.push(new StreamResult({
                    url: cleaned,
                    quality: streamQualityFromUrl(cleaned),
                    source: sourceName,
                    headers: { Referer: referer, "User-Agent": UA }
                }));
            };

            const packedRegex = /eval\(function\(p,a,c,k,e,d\)[\s\S]*?\}\([\s\S]*?\)\)/g;
            let packed;
            while ((packed = packedRegex.exec(html)) !== null) {
                const unpacked = unpackJs(packed[0]);
                for (const u of collectM3u8Candidates(unpacked)) addStream(u, "MissAV Packed");
            }

            if (streams.length === 0) {
                for (const u of collectM3u8Candidates(html)) addStream(u, "MissAV Fallback");
            }

            if (streams.length === 0) {
                throw new Error("STREAM_NOT_FOUND");
            }

            const expanded = [];
            for (const stream of streams) {
                const variants = await expandHlsVariants(stream);
                expanded.push(...variants);
            }

            const output = uniqueByUrl(expanded)
                .sort((a, b) => qualityPriority(b.quality) - qualityPriority(a.quality));

            cb({ success: true, data: output });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: String(e?.message || e) });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
