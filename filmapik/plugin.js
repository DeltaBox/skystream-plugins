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
        "filmapik",
        "layarkaca"
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
        t = t.replace(/^(nonton|streaming)\s+(movie|series|film)\s+/i, "");
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
            const doc = parseHtml(body);

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

    async function resolveBuzzHeavier(url, label = "BuzzServer") {
        try {
            const res = await request(url);
            const doc = parseHtml(res.body);
            const qualityText = textOf(doc.querySelector("div.max-w-2xl > span"));
            const quality = extractQuality(qualityText);

            // Get redirect from /download
            const downloadUrl = url.replace(/\/+$/, "") + "/download";
            const resDl = await http_get(downloadUrl, {
                headers: { "Referer": url, "User-Agent": UA }
            });

            // hx-redirect is often in headers
            const redirectUrl = extractHeader(resDl.headers, "hx-redirect");
            if (redirectUrl) {
                return [new StreamResult({
                    url: redirectUrl,
                    quality: quality,
                    source: `${label} - ${quality}`,
                    headers: { "User-Agent": UA }
                })];
            }
        } catch (_) {}
        return [];
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

    function safeParseFloat(text) {
        if (!text) return undefined;
        const v = parseFloat(String(text).replace(/,/g, "."));
        return isNaN(v) ? undefined : v;
    }

    function safeParseInt(text) {
        if (!text) return undefined;
        const v = parseInt(text, 10);
        return isNaN(v) ? undefined : v;
    }

    async function request(url, headers = BASE_HEADERS) {
        // console.log("HTTP GET:", url);
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
        return parseHtml(res.body);
    }

    function parseItemFromElement(el) {
        const titleAnchor = el.querySelector("div.details div.title a[href], div.data h3 a[href], h3 a[href], h2 a[href], .title a[href]");
        const a = titleAnchor || el.querySelector("a[href]");
        const href = normalizeUrl(getAttr(a, "href"), manifest.baseUrl);
        if (!href || !isContentPath(href)) return null;
        if (!isTrustedNavigationUrl(href)) return null;

        const img = el.querySelector("img[src], img[data-src], img[data-lazy-src]");

        const candidates = [
            textOf(titleAnchor),
            textOf(el.querySelector("div.details div.title")),
            getAttr(img, "alt"),
            textOf(a)
        ];

        const rawTitle = candidates.find(t => {
            if (!t || t.length < 2) return false;
            const low = t.toLowerCase();
            return !["movie", "movies", "tvshows", "tv-shows", "tv show", "tv-show"].includes(low);
        }) || "Unknown";

        const title = cleanTitle(rawTitle);
        if (!title || title === "Unknown") return null;

        const posterUrl = fixImageQuality(normalizeUrl(getAttr(img, "src", "data-src", "data-lazy-src"), manifest.baseUrl));

        const scoreText = textOf(el.querySelector("div.rating, .imdb, .tmdb, .score"));
        const score = safeParseFloat(scoreText);

        const postLabel = textOf(el.querySelector("span.post"));
        let type = "movie";
        if (
            el.querySelector("span.tvshows, span.tv, .tvshows, .tv-show") ||
            postLabel.toLowerCase().includes("tv") || postLabel.toLowerCase().includes("series") ||
            href.toLowerCase().includes("/tvshows/") || href.toLowerCase().includes("/series/")
        ) {
            type = "series";
        }

        return new MultimediaItem({
            title,
            url: href,
            posterUrl,
            type,
            contentType: type,
            score
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

    async function fetchSection(path, maxPages = 2) {
        const all = [];
        for (let page = 1; page <= maxPages; page += 1) {
            try {
                const url = page <= 1 ? `${manifest.baseUrl}${path}` : `${manifest.baseUrl}${path}page/${page}/`;
                const doc = await loadSiteDoc(url);
                const items = Array.from(doc.querySelectorAll("div.items.normal article.item, div.result-item article, article.item"))
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
                { name: "Box Office", path: "/category/box-office/" },
                { name: "Serial Terbaru", path: "/tvshows/" },
                { name: "Film Terbaru", path: "/latest/" }
            ];

            const data = {};
            for (const sec of sections) {
                const items = await fetchSection(sec.path);
                if (items.length > 0) {
                    data[sec.name] = items;
                }
            }

            cb({ success: true, data });
        } catch (e) {
            cb({ success: false, message: String(e) });
        }
    };

    // Layered search per PLUGIN_WORKFLOW.md
    globalThis.search = async function(query, cb) {
        try {
            const normalizedQuery = normalizeSearchQuery(query);
            const encoded = encodeURIComponent(normalizedQuery);
            const plusEncoded = normalizedQuery.replace(/ /g, "+");
            const dashEncoded = normalizedQuery.replace(/ /g, "-");

            const out = [];
            const seen = new Set();

            // Layer 1: HTML search URLs in parallel (multiple route shapes)
            const searchUrls = [
                `${manifest.baseUrl}/?s=${encoded}`,
                `${manifest.baseUrl}/?s=${plusEncoded}`,
                `${manifest.baseUrl}/search.php?s=${encoded}`,
                `${manifest.baseUrl}/search.php?s=${plusEncoded}`,
                `${manifest.baseUrl}/search/${encoded}`,
                `${manifest.baseUrl}/search/${plusEncoded}`,
                `${manifest.baseUrl}/search/${dashEncoded}`
            ];

            // Try search URLs in parallel batches
            for (const url of searchUrls) {
                try {
                    const doc = await loadSiteDoc(url);
                    const items = Array.from(doc.querySelectorAll("div.result-item article, div.result-item, article.item, div.items article.item"))
                        .map(parseItemFromElement)
                        .filter(Boolean);

                    for (const it of items) {
                        if (!seen.has(it.url)) {
                            seen.add(it.url);
                            // Score and add
                            const score = scoreResult(it, normalizedQuery);
                            if (score > 0) {
                                it._score = score;
                                out.push(it);
                            }
                        }
                    }
                    // Early return when valid matches exist
                    if (out.length >= 10) break;
                } catch (_) {}
            }

            // Layer 2: Fallback crawl + filter if fast layers fail
            if (out.length === 0) {
                const fallbackPaths = ["/", "/movie", "/series", "/latest", "/populer"];
                for (const path of fallbackPaths) {
                    try {
                        const doc = await loadSiteDoc(`${manifest.baseUrl}${path}`);
                        const items = Array.from(doc.querySelectorAll("div.items.normal article.item, article.item"))
                            .map(parseItemFromElement)
                            .filter(Boolean);

                        for (const it of items) {
                            if (!seen.has(it.url)) {
                                seen.add(it.url);
                                const score = scoreResult(it, normalizedQuery);
                                if (score > 0) {
                                    it._score = score;
                                    out.push(it);
                                }
                            }
                        }
                        if (out.length > 0) break;
                    } catch (_) {}
                }
            }

            // Sort by score (phrase match > all-token > single-token)
            out.sort((a, b) => (b._score || 0) - (a._score || 0));

            cb({ success: true, data: out });
        } catch (e) {
            cb({ success: false, message: String(e) });
        }
    };

    // Resolve interstitial/redirect before parsing detail
    async function resolveDetailUrl(url) {
        const resolved = await resolveRecursive(url);
        if (!resolved || resolved === url) return url;
        // Ensure redirect target looks like a real title URL
        if (isContentPath(resolved) && isTrustedNavigationUrl(resolved)) {
            return resolved;
        }
        // Never allow category links to replace detail URL
        if (pathOf(resolved).includes("/populer") || pathOf(resolved).includes("/category")) {
            return url;
        }
        return resolved;
    }

    // Parse season payload JSON first, then anchor fallback
    function parseEpisodesFromSeasonPayload(doc, posterUrl) {
        const episodes = [];

        // 1. Parse season payload JSON (e.g., script#season-data) first
        const seasonScript = doc.querySelector("script#season-data, script#season_data, script[data-name=season]");
        if (seasonScript) {
            const content = textOf(seasonScript);
            if (content) {
                try {
                    // Support assignment-style payload wrappers
                    const jsonMatch = content.match(/(?:var\s+)?seasonData\s*=\s*({[\s\S]*?})\s*;?/i) ||
                                      content.match(/({[\s\S]*"episodes"[\s\S]*})/i);
                    if (jsonMatch && jsonMatch[1]) {
                        const seasonData = JSON.parse(jsonMatch[1]);
                        if (seasonData && Array.isArray(seasonData.episodes)) {
                            seasonData.episodes.forEach((ep, idx) => {
                                const epUrl = normalizeUrl(ep.url || ep.link || "", manifest.baseUrl);
                                if (epUrl && isTrustedNavigationUrl(epUrl)) {
                                    episodes.push(new Episode({
                                        name: ep.title || ep.name || `Episode ${ep.episode || (idx + 1)}`,
                                        url: epUrl,
                                        season: ep.season || 1,
                                        episode: ep.episode || (idx + 1),
                                        posterUrl
                                    }));
                                }
                            });
                            if (episodes.length > 0) return episodes;
                        }
                    }
                } catch (_) {}
            }
        }

        // 2. Support assignment-style payload wrappers in inline scripts
        const scripts = Array.from(doc.querySelectorAll("script"));
        for (const script of scripts) {
            const content = textOf(script);
            if (!content) continue;

            // Look for season/episode JSON patterns
            const jsonMatch = content.match(/({[\s\S]*?(?:season|episode)[\s\S]*?})/i);
            if (jsonMatch && jsonMatch[1]) {
                try {
                    const data = JSON.parse(jsonMatch[1]);
                    if (data && Array.isArray(data.episodes)) {
                        data.episodes.forEach((ep, idx) => {
                            const epUrl = normalizeUrl(ep.url || ep.link || "", manifest.baseUrl);
                            if (epUrl && isTrustedNavigationUrl(epUrl)) {
                                episodes.push(new Episode({
                                    name: ep.title || ep.name || `Episode ${ep.episode || (idx + 1)}`,
                                    url: epUrl,
                                    season: ep.season || 1,
                                    episode: ep.episode || (idx + 1),
                                    posterUrl
                                }));
                            }
                        });
                        if (episodes.length > 0) return episodes;
                    }
                } catch (_) {}
            }
        }

        return episodes;
    }

    // Anchor fallback with strict matching
    function parseEpisodesFromAnchors(doc, posterUrl, titleSlug) {
        const episodes = [];
        const seasonBlocks = Array.from(doc.querySelectorAll("#seasons .se-c, div.season-block"));

        if (seasonBlocks.length > 0) {
            seasonBlocks.forEach((block, sIdx) => {
                const seasonNum = safeParseInt(textOf(block.querySelector(".se-q .se-t"))?.replace(/\D/g, "")) || (sIdx + 1);
                const epNodes = Array.from(block.querySelectorAll(".se-a ul.episodios li a, .episode-list a"));

                epNodes.forEach((ep, eIdx) => {
                    const epUrl = normalizeUrl(getAttr(ep, "href"), manifest.baseUrl);
                    if (!epUrl || !isTrustedNavigationUrl(epUrl)) return;

                    // Strict matching: only accept links that match likely episode patterns
                    const epPath = pathOf(epUrl);
                    const isEpisodePattern = /\/episode|ep-\d+|season-\d+|temporada/i.test(epPath);

                    // For fallback anchors, only accept if tied to current title slug
                    const matchesSlug = titleSlug && epPath.includes(titleSlug);

                    if (isEpisodePattern || matchesSlug) {
                        const epName = textOf(ep) || `Episode ${eIdx + 1}`;
                        episodes.push(new Episode({
                            name: epName,
                            url: epUrl,
                            season: seasonNum,
                            episode: eIdx + 1,
                            posterUrl
                        }));
                    }
                });
            });
        }

        return episodes;
    }

    globalThis.load = async function(url, cb) {
        try {
            // Resolve redirect/interstitial safely
            const resolvedUrl = await resolveDetailUrl(url);
            const doc = await loadSiteDoc(resolvedUrl);

            const title = cleanTitle(
                textOf(doc.querySelector("h1[itemprop=name], .sheader h1, .sheader h2, #info h2"))
            );
            const posterUrl = fixImageQuality(normalizeUrl(getAttr(doc.querySelector(".sheader .poster img, .poster img"), "src"), manifest.baseUrl));
            const description = textOf(doc.querySelector("div[itemprop=description], .wp-content, .entry-content, .desc, .entry")) || "Tidak ada deskripsi.";

            const yearText = textOf(doc.querySelector("#info .info-more .country a"));
            const year = safeParseInt(yearText);

            const ratingText = textOf(doc.querySelector("#repimdb strong"));
            const score = safeParseFloat(ratingText);

            const tags = Array.from(doc.querySelectorAll("span.sgeneros a")).map(textOf);

            const actors = Array.from(doc.querySelectorAll(".info-more span.tagline"))
                .filter(el => /Actors|Stars/i.test(textOf(el)))
                .flatMap(el => Array.from(el.querySelectorAll("a")).map(a => ({ name: textOf(a) })));

            // Extract title slug for episode matching
            const titleSlug = pathOf(resolvedUrl).split("/").filter(p => p).pop()?.replace(/[^a-z0-9-]/gi, "").toLowerCase() || "";

            let episodes = [];

            // 1. Parse season payload JSON first
            episodes = parseEpisodesFromSeasonPayload(doc, posterUrl);

            // 2. Anchor fallback with strict matching
            if (episodes.length === 0) {
                episodes = parseEpisodesFromAnchors(doc, posterUrl, titleSlug);
            }

            // 3. If still no episodes, check for movie play button
            if (episodes.length === 0) {
                const playUrl = normalizeUrl(getAttr(doc.querySelector("#clickfakeplayer, .fakeplayer a"), "href"), resolvedUrl);
                if (playUrl && isTrustedNavigationUrl(playUrl)) {
                    episodes.push(new Episode({
                        name: "Play",
                        url: playUrl,
                        season: 1,
                        episode: 1,
                        posterUrl
                    }));
                } else {
                    // Single Play episode for movie
                    episodes.push(new Episode({
                        name: "Play",
                        url: resolvedUrl,
                        season: 1,
                        episode: 1,
                        posterUrl
                    }));
                }
            }

            // Determine type with strong checks
            const seasonBlocks = doc.querySelectorAll("#seasons .se-c, div.season-block");
            const hasSeasonPayload = doc.querySelector("script#season-data, script#season_data") !== null;
            const type = (seasonBlocks.length > 0 || hasSeasonPayload || episodes.length > 1) ? "series" : "movie";

            // Movie must stay movie (single Play episode)
            const finalEpisodes = type === "movie" && episodes.length === 1 ? episodes : episodes;

            const item = new MultimediaItem({
                title,
                url: resolvedUrl,
                posterUrl,
                description,
                type,
                contentType: type,
                episodes: finalEpisodes,
                year,
                score,
                tags,
                cast: actors
            });

            cb({ success: true, data: item });
        } catch (e) {
            cb({ success: false, message: String(e) });
        }
    };

    function stripTrailingQualityLabel(source) {
        return String(source || "HLS").replace(/\s*-\s*(auto|\d{3,4}p|\d+k|\d+p)\s*$/i, "").trim() || "HLS";
    }

    async function expandHlsVariants(stream) {
        const baseUrl = String(stream?.url || "");
        if (!/\.m3u8(\?|$)/i.test(baseUrl)) return [stream];
        try {
            const res = await request(baseUrl, stream.headers || BASE_HEADERS);
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
                const nameMatch = line.match(/NAME="?([^",]+)"?/i);
                const quality = resMatch?.[1] ? `${resMatch[1]}p` : (nameMatch?.[1] || "Auto");

                const variantUrl = resolveUrl(baseUrl, nextLine);
                if (!variantUrl || seenVariantUrl.has(variantUrl)) continue;
                seenVariantUrl.add(variantUrl);

                const baseSource = stripTrailingQualityLabel(stream.source);
                variants.push(new StreamResult({
                    url: variantUrl,
                    quality,
                    source: `${baseSource} - ${quality}`,
                    headers: stream.headers
                }));
            }

            if (variants.length > 0) return variants;
            return [stream];
        } catch (_) {
            return [stream];
        }
    }

    // Standard Packer deobfuscator logic
    function unpack(p, a, c, k, e, d) {
        e = function(c) { return (c < a ? '' : e(parseInt(c / a))) + ((c = c % a) > 35 ? String.fromCharCode(c + 29) : c.toString(36)) };
        if (!''.replace(/^/, String)) {
            while (c--) d[e(c)] = k[c] || e(c);
            k = [function(e) { return d[e] }];
            e = function() { return '\\w+' };
            c = 1;
        };
        while (c--) if (k[c]) p = p.replace(new RegExp('\\b' + e(c) + '\\b', 'g'), k[c]);
        return p;
    }

    async function resolveEfekStream(url, label = "VIP SERVER", referer = "") {
        try {
            const res = await request(url, { "User-Agent": UA, "Referer": referer || manifest.baseUrl + "/" });
            const html = res.body || "";

            // 1. Look for direct m3u8/mp4 in page sources
            const directPatterns = [
                /file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi,
                /file\s*:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/gi,
                /url\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi,
                /src\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi
            ];

            for (const pattern of directPatterns) {
                const matches = [...html.matchAll(pattern)];
                for (const match of matches) {
                    const candidate = match[1];
                    if (candidate && !candidate.includes("cdn-cgi")) {
                        const quality = extractQuality(candidate);
                        return [new StreamResult({
                            url: candidate,
                            quality,
                            source: `${label} - ${quality}`,
                            headers: { "Referer": url, "User-Agent": UA }
                        })];
                    }
                }
            }

            // 2. Look for sources array in JWPlayer config
            const sourcesMatch = html.match(/sources\s*:\s*(\[[\s\S]*?\])/);
            if (sourcesMatch) {
                try {
                    const sources = JSON.parse(sourcesMatch[1].replace(/'/g, '"'));
                    const streams = [];
                    for (const s of sources) {
                        if (s.file && (s.file.includes(".m3u8") || s.file.includes(".mp4"))) {
                            streams.push(new StreamResult({
                                url: s.file,
                                quality: s.label || extractQuality(s.file),
                                source: `${label} - ${s.label || "Auto"}`,
                                headers: { "Referer": url, "User-Agent": UA }
                            }));
                        }
                    }
                    if (streams.length > 0) return streams;
                } catch (_) {}
            }

            // 3. Look for packed script with m3u8
            const packerMatch = html.match(/eval\(function\(p,a,c,k,e,d\)\{([\s\S]*?)\}\(([\s\S]*?)\)\)/);
            if (packerMatch) {
                const argsRaw = packerMatch[2];
                const args = argsRaw.split(',').map(s => s.trim().replace(/^'|'$/g, '').replace(/^"|"$/g, ''));
                if (args.length >= 4) {
                    try {
                        const p = packerMatch[1];
                        const a = parseInt(args[args.length-4]);
                        const c = parseInt(args[args.length-3]);
                        const k = args[args.length-2].split('|');
                        const unpacked = unpack(p, a, c, k, 0, {});
                        const m3u8Matches = [...unpacked.matchAll(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi)];
                        if (m3u8Matches.length > 0) {
                            const streamUrl = m3u8Matches[0][1];
                            return [new StreamResult({
                                url: streamUrl,
                                quality: extractQuality(streamUrl),
                                source: label,
                                headers: { "Referer": url, "User-Agent": UA }
                            })];
                        }
                    } catch (_) {}
                }
            }

            // 4. Return download link as fallback - user can download or stream from it
            return [new StreamResult({
                url: url,
                quality: "Auto",
                source: `${label} (Stream/Download)`,
                headers: { "Referer": url, "User-Agent": UA }
            })];
        } catch (_) { return []; }
    }

    async function resolvePlayerIframe(url) {
        try {
            const res = await request(url, {
                "User-Agent": UA,
                "Referer": `${manifest.baseUrl}/`
            });
            const html = res.body || "";
            const src = html.match(/<iframe[^>]+src=["']([^"']+)["']/i)?.[1] || "";
            return normalizeUrl(src, url);
        } catch (_) {
            return "";
        }
    }

    async function resolveP2P(embedUrl, sourceName = "P2P") {
        try {
            const idMatch = embedUrl.match(/[?&]id=([^&#]+)/i);
            const id = idMatch ? decodeURIComponent(idMatch[1]) : "";
            if (!id) return [];

            const api = "https://cloud.hownetwork.xyz/api2.php?id=" + encodeURIComponent(id);
            const body = "r=" + encodeURIComponent("https://playeriframe.sbs/") + "&d=" + encodeURIComponent("playeriframe.sbs");

            const res = await http_post(api, {
                headers: {
                    "User-Agent": UA,
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Accept": "application/json, text/plain, */*",
                    "Referer": "https://cloud.hownetwork.xyz/"
                },
                body
            });

            const json = JSON.parse(res.body || "{}");
            const file = json.file;
            if (!file) return [];

            const quality = extractQuality(file);
            return [new StreamResult({
                url: file,
                quality,
                source: `${sourceName} - ${quality}`,
                headers: {
                    "Referer": "https://cloud.hownetwork.xyz/",
                    "User-Agent": UA
                }
            })];
        } catch (_) {
            return [];
        }
    }

    async function resolveTurbo(embedUrl, sourceName = "TurboVIP") {
        try {
            const res = await request(embedUrl, {
                "User-Agent": UA,
                "Referer": "https://playeriframe.sbs/"
            });
            const html = res.body || "";
            const m3u8 =
                html.match(/(?:urlPlay|data-hash)\s*[=:]\s*["']([^"']+\.m3u8[^"']*)["']/i)?.[1] ||
                html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i)?.[1] ||
                "";

            if (!m3u8) return [];

            const quality = extractQuality(m3u8);
            return [new StreamResult({
                url: m3u8,
                quality,
                source: `${sourceName} - ${quality}`,
                headers: {
                    "Referer": embedUrl,
                    "User-Agent": UA
                }
            })];
        } catch (_) {
            return [];
        }
    }

    async function resolveHydrax(url, label = "Hydrax") {
        try {
            const res = await request(url);
            const html = res.body || "";

            // Hydrax usually has a slug or id in the URL or in the script
            // Some versions use a 'slug' and 'key' to fetch from an API
            const slugMatch = html.match(/slug\s*:\s*["']([^"']+)["']/i);
            const keyMatch = html.match(/key\s*:\s*["']([^"']+)["']/i);

            if (slugMatch && keyMatch) {
                // If we found slug/key, we might need to hit their API
                // For now, let's try to find direct sources in the html
                const sourcesMatch = html.match(/sources\s*:\s*(\[[\s\S]*?\])/);
                if (sourcesMatch) {
                    try {
                        const sources = JSON.parse(sourcesMatch[1].replace(/'/g, '"'));
                        return sources.map(s => new StreamResult({
                            url: s.file,
                            quality: s.label || "Auto",
                            source: `${label} - ${s.label || "Auto"}`,
                            headers: { "Referer": url, "User-Agent": UA }
                        }));
                    } catch (_) {}
                }
            }

            // Fallback: look for any .m3u8 or .mp4 in the page
            const m3u8Match = html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
            if (m3u8Match) {
                return [new StreamResult({
                    url: m3u8Match[1],
                    quality: "Auto",
                    source: label,
                    headers: { "Referer": url, "User-Agent": UA }
                })];
            }
        } catch (_) {}
        return [];
    }

    async function resolvePlayerLink(playerLink, label, referer = "") {
        const link = playerLink || "";
        if (!link || link.includes("about:blank")) return [];

        let embed = link;
        if (link.includes("playeriframe")) {
            embed = await resolvePlayerIframe(link);
        }

        if (!embed) return [];

        // For efek.stream, try to get direct m3u8 by fetching with proper headers
        if (embed.includes("efek.stream")) {
            const streams = await resolveEfekStream(embed, label, referer);
            if (streams.length > 0) return streams;
            // Don't return empty, let it fall through to return the link itself
        }

        if (embed.includes("buzzheavier.com")) {
            return await resolveBuzzHeavier(embed, label);
        }

        if (embed.includes("short.icu") || embed.includes("abysscdn") || embed.includes("hydrax")) {
            return await resolveHydrax(embed, label || "Hydrax");
        }

        if (embed.includes("cloud.hownetwork.xyz/video.php")) {
            return await resolveP2P(embed, label || "P2P");
        }

        if (embed.includes("emturbovid") || embed.includes("turbovidhls") || embed.includes("turbovid")) {
            return await resolveTurbo(embed, label || "TurboVIP");
        }

        // Direct stream URL or download link (mega.nz, etc)
        const quality = extractQuality(embed);
        return [new StreamResult({
            url: embed,
            quality,
            source: `${label || "Player"} - ${quality}`,
            headers: { "Referer": referer || manifest.baseUrl + "/", "User-Agent": UA }
        })];
    }

    function hasPlayableMarkers(doc) {
        if (!doc) return false;
        if (doc.querySelector("li.dooplay_player_option[data-url]")) return true;
        if (doc.querySelector("div.pframe iframe[src]")) return true;
        if (doc.querySelector("div#download a.myButton[href]")) return true;
        return false;
    }

    function extractPlayPageUrl(doc, currentUrl) {
        if (!doc) return "";
        const playHref =
            getAttr(doc.querySelector("#clickfakeplayer, .fakeplayer a, a#playNow, a.play"), "href") ||
            "";
        const playUrl = normalizeUrl(playHref, currentUrl || manifest.baseUrl);
        if (!playUrl) return "";
        if (!isTrustedNavigationUrl(playUrl)) return "";
        return playUrl;
    }

    async function loadPlayableDoc(url) {
        const baseDoc = await loadSiteDoc(url);
        if (hasPlayableMarkers(baseDoc)) {
            return { doc: baseDoc, sourceUrl: url };
        }

        const playUrl = extractPlayPageUrl(baseDoc, url);
        if (!playUrl || playUrl === url) {
            return { doc: baseDoc, sourceUrl: url };
        }

        try {
            const playDoc = await loadSiteDoc(playUrl);
            if (hasPlayableMarkers(playDoc)) {
                return { doc: playDoc, sourceUrl: playUrl };
            }
        } catch (_) {}

        return { doc: baseDoc, sourceUrl: url };
    }

    globalThis.loadStreams = async function(url, cb) {
        try {
            const loaded = await loadPlayableDoc(url);
            const doc = loaded.doc;
            const sourceUrl = loaded.sourceUrl || url;
            const rawStreams = [];
            const seenUrls = new Set();

            // Extract from dooplay player options (server buttons)
            const options = Array.from(doc.querySelectorAll("li.dooplay_player_option[data-url]"));
            for (const opt of options) {
                const rawUrl = getAttr(opt, "data-url");
                if (rawUrl) {
                    // Get server name from parent or sibling elements
                    let label = "Server";
                    const ul = opt.closest("ul");
                    if (ul) {
                        const titleEl = ul.querySelector("span.server_title");
                        if (titleEl) label = textOf(titleEl);
                    }
                    // Also try the button text itself
                    const btnText = textOf(opt.querySelector("button, span"));
                    if (btnText && btnText.length > 1) label = btnText;

                    const results = await resolvePlayerLink(rawUrl, label, sourceUrl);
                    results.forEach(r => rawStreams.push(r));
                }
            }

            // Extract from iframes in pframe div
            const iframes = Array.from(doc.querySelectorAll("div.pframe iframe[src]"));
            for (const ifr of iframes) {
                const rawSrc = normalizeUrl(getAttr(ifr, "src"), manifest.baseUrl);
                if (rawSrc) {
                    const src = await resolveRecursive(rawSrc);
                    const results = await resolvePlayerLink(src, "Embed", sourceUrl);
                    results.forEach(r => rawStreams.push(r));
                }
            }

            // Extract from download links section
            const downloads = Array.from(doc.querySelectorAll("div#download a.myButton[href]"));
            for (const a of downloads) {
                const rawHref = normalizeUrl(getAttr(a, "href"), manifest.baseUrl);
                if (rawHref) {
                    const href = await resolveRecursive(rawHref);
                    const label = textOf(a).split(/\s+/)[0] || "Download";
                    const results = await resolvePlayerLink(href, `Download (${label})`, sourceUrl);
                    if (results.length > 0) {
                        results.forEach(r => rawStreams.push(r));
                    } else {
                        // Add as direct download if no resolver matched
                        rawStreams.push(new StreamResult({
                            url: href,
                            source: `Download (${label})`,
                            quality: extractQuality(href),
                            headers: { "Referer": sourceUrl, "User-Agent": UA }
                        }));
                    }
                }
            }

            // Also check for any other iframes in the page that might contain players
            const allIframes = Array.from(doc.querySelectorAll("iframe[src]"));
            for (const ifr of allIframes) {
                const src = normalizeUrl(getAttr(ifr, "src"), manifest.baseUrl);
                if (src && !src.includes("google") && !src.includes("facebook") && !src.includes("twitter")) {
                    const resolved = await resolveRecursive(src);
                    if (resolved.includes("efek.stream") || resolved.includes("buzzheavier") || resolved.includes("hydrax")) {
                        const results = await resolvePlayerLink(resolved, "Auto", sourceUrl);
                        results.forEach(r => {
                            if (!seenUrls.has(r.url)) rawStreams.push(r);
                        });
                    }
                }
            }

            // Expand HLS variants
            const expanded = [];
            for (const s of rawStreams) {
                const variants = await expandHlsVariants(s);
                variants.forEach(v => expanded.push(v));
            }

            // Deduplicate streams by URL
            const final = [];
            for (const s of expanded) {
                if (s.url && !seenUrls.has(s.url)) {
                    seenUrls.add(s.url);
                    final.push(s);
                }
            }

            cb({ success: true, data: final });
        } catch (e) {
            cb({ success: false, message: String(e) });
        }
    };

})();
