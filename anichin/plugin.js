(function() {
    /**
     * @type {import('@skystream/sdk').Manifest}
     */
    // var manifest is injected at runtime

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

    // Normalize query from app input per PLUGIN_WORKFLOW.md
    function normalizeSearchQuery(query) {
        let q = String(query || "").trim();
        // Decode URI encoding
        try { q = decodeURIComponent(q); } catch (_) {}
        // Replace + with space
        q = q.replace(/\+/g, " ");
        // Trim quoted input
        q = q.replace(/^["']|["']$/g, "");
        return q.trim();
    }

    // Scoring for search results
    function scoreResult(item, query) {
        const title = (item.title || "").toLowerCase();
        const q = query.toLowerCase();
        const qWords = q.split(/\s+/).filter(w => w.length > 0);

        // Phrase match (highest priority)
        if (title.includes(q)) return 3;

        // All-token match
        const allMatch = qWords.every(word => title.includes(word));
        if (allMatch) return 2;

        // Single-token match
        const anyMatch = qWords.some(word => title.includes(word));
        if (anyMatch) return 1;

        return 0;
    }

    async function resolveRecursive(url, depth = 0) {
        if (depth > 3 || !url) return url;
        try {
            const res = await request(url);
            const body = res.body || "";
            if (isCloudflareBlocked(res, url)) return "";
            const doc = await parseHtml(body);

            // 1. Check for iframe
            const ifr = doc.querySelector("iframe[src]");
            if (ifr) {
                const src = normalizeUrl(getAttr(ifr, "src"), url);
                if (src && src !== url && src.startsWith("http")) return await resolveRecursive(src, depth + 1);
            }

            // 2. Check for meta refresh
            const meta = doc.querySelector("meta[http-equiv=refresh]");
            if (meta) {
                const content = getAttr(meta, "content") || "";
                const m = content.match(/url=(.+)$/i);
                if (m && m[1]) {
                    const next = normalizeUrl(m[1].trim(), url);
                    if (next && next !== url) return await resolveRecursive(next, depth + 1);
                }
            }

            // 3. Check for location.href in scripts
            const scriptMatch = body.match(/location\.href\s*=\s*["'](.*?)["']/);
            if (scriptMatch && scriptMatch[1]) {
                const next = normalizeUrl(scriptMatch[1], url);
                if (next && next !== url) return await resolveRecursive(next, depth + 1);
            }

            return res.finalUrl || res.url || url;
        } catch (_) {
            return url;
        }
    }

    async function request(url, headers = BASE_HEADERS) {
        return http_get(url, { headers });
    }

    async function loadSiteDoc(url, headers = BASE_HEADERS) {
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

    function parseItemFromElement(el) {
        const anchor = el.querySelector(".bsx a, a[title]");
        const href = normalizeUrl(getAttr(anchor, "href"), manifest.baseUrl);
        if (!href || !isContentPath(href)) return null;
        if (!isTrustedNavigationUrl(href)) return null;

        const img = el.querySelector("img");
        const title = cleanTitle(getAttr(anchor, "title") || textOf(el.querySelector(".tt")) || getAttr(img, "alt"));
        if (!title || title === "Unknown") return null;

        const posterUrl = fixImageQuality(normalizeUrl(getAttr(img, "src", "data-src"), manifest.baseUrl));

        let type = "series";
        const typeText = textOf(el.querySelector(".typez"));
        if (typeText.toLowerCase().includes("movie")) type = "movie";

        return new MultimediaItem({
            title,
            url: href,
            posterUrl,
            type,
            contentType: type
        });
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

    async function fetchSection(path, maxPages = 1) {
        const all = [];
        for (let page = 1; page <= maxPages; page += 1) {
            try {
                const url = page <= 1 ? `${manifest.baseUrl}${path}` : `${manifest.baseUrl}${path}page/${page}/`;
                const doc = await loadSiteDoc(url);
                const items = Array.from(doc.querySelectorAll("div.listupd article, div.post-show article"))
                    .map(parseItemFromElement)
                    .filter(Boolean);

                if (items.length === 0 && page > 1) break;
                all.push(...items);
                if (all.length >= 36) break;
            } catch (_) {
                if (page === 1) return [];
                break;
            }
        }
        return uniqueByUrl(all);
    }

    globalThis.getHome = async function(cb) {
        try {
            const sections = [
                { name: "Rilisan Terbaru", path: "/anime/?order=update" },
                { name: "Series Ongoing", path: "/anime/?status=ongoing&order=update" },
                { name: "Series Completed", path: "/anime/?status=completed&order=update" },
                { name: "Movie", path: "/anime/?type=movie&order=update" }
            ];

            const data = {};
            for (const sec of sections) {
                const items = await fetchSection(sec.path);
                if (items.length > 0) {
                    data[sec.name] = items;
                }
            }

            if (Object.keys(data).length === 0) {
                // Fallback to homepage
                const items = await fetchSection("/");
                if (items.length > 0) data["Terbaru"] = items;
            }

            cb({ success: true, data });
        } catch (e) {
            cb({ success: false, message: String(e) });
        }
    };

    globalThis.search = async function(query, cb) {
        try {
            const normalizedQuery = normalizeSearchQuery(query);
            const encoded = encodeURIComponent(normalizedQuery);
            const url = `${manifest.baseUrl}/?s=${encoded}`;
            
            const doc = await loadSiteDoc(url);
            const items = Array.from(doc.querySelectorAll("div.listupd article"))
                .map(parseItemFromElement)
                .filter(Boolean);

            const out = items.filter(it => scoreResult(it, normalizedQuery) > 0);
            out.sort((a, b) => scoreResult(b, normalizedQuery) - scoreResult(a, normalizedQuery));

            cb({ success: true, data: uniqueByUrl(out) });
        } catch (e) {
            cb({ success: false, message: String(e) });
        }
    };

    globalThis.load = async function(url, cb) {
        try {
            const doc = await loadSiteDoc(url);

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
            cb({ success: false, message: String(e) });
        }
    };

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

        const quality = "Auto";
        return [new StreamResult({
            url: link,
            quality,
            source: label || "Player",
            headers: { "Referer": referer || manifest.baseUrl + "/", "User-Agent": UA }
        })];
    }

    globalThis.loadStreams = async function(url, cb) {
        try {
            const doc = await loadSiteDoc(url);
            const rawStreams = [];

            const options = Array.from(doc.querySelectorAll(".mobius option, .mirror option"));
            for (const opt of options) {
                const val = getAttr(opt, "value");
                if (val && val.length > 5) {
                    const label = textOf(opt) || "Server";
                    const results = await resolvePlayerLink(val, label, url);
                    results.forEach(r => rawStreams.push(r));
                }
            }

            if (rawStreams.length === 0) {
                const ifr = doc.querySelector("iframe[src], .video-content iframe");
                if (ifr) {
                    const results = await resolvePlayerLink(getAttr(ifr, "src"), "Embed", url);
                    results.forEach(r => rawStreams.push(r));
                }
            }

            cb({ success: true, data: rawStreams });
        } catch (e) {
            cb({ success: false, message: String(e) });
        }
    };

})();
