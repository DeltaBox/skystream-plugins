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
    const SEARCH_REQ_TIMEOUT_MS = 7000;

    const EXCLUDE_PATHS = [
        "/genre", "/country", "/negara", "/tahun", "/year", "/page/",
        "/privacy", "/dmca", "/faq", "/cara-install-vpn", "/request", "/wp-",
        "/author", "/category", "/tag", "/feed", "javascript:"
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

    function looksLikeDetailPath(url) {
        const path = pathOf(url);
        return /-(19|20)\d{2}\/?$/.test(path) || /season[-_/]?\d+[-_/]?episode[-_/]?\d+/i.test(path);
    }

    function parseYear(text) {
        const m = String(text || "").match(/\b(19\d{2}|20\d{2})\b/);
        return m ? parseInt(m[1], 10) : undefined;
    }

    function isSeries(title, url, extra) {
        const t = `${title || ""} ${url || ""} ${extra || ""}`.toLowerCase();
        return /\b(series|season|episode|eps|s\.?\d+)\b/.test(t);
    }

    function cleanTitle(raw) {
        let t = htmlDecode(String(raw || "")).replace(/\s+/g, " ").trim();
        t = t.replace(/^nonton\s+(movie|series)\s+/i, "");
        t = t.replace(/\s+streaming\s+gratis$/i, "");
        t = t.replace(/\s+sub\s+indo\s+di\s+lk21$/i, "");
        t = t.replace(/^nonton\s+/i, "");
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

    async function request(url, headers = BASE_HEADERS) {
        return http_get(url, { headers });
    }

    async function loadDoc(url, headers = BASE_HEADERS) {
        const res = await request(url, headers);
        return parseHtml(res.body);
    }

    function withTimeout(promise, ms, label) {
        return Promise.race([
            promise,
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`TIMEOUT:${label || "request"}`)), ms);
            })
        ]);
    }

    async function resolveProperLink(url) {
        try {
            const doc = await loadDoc(url);
            const fullText = textOf(doc.body || doc.documentElement);
            if (!/anda akan dialihkan|jika halaman tidak berganti/i.test(fullText)) {
                return url;
            }
            const openNow = normalizeUrl(getAttr(doc.querySelector("a#openNow"), "href"), manifest.baseUrl);
            if (openNow && openNow !== url && isContentPath(openNow) && looksLikeDetailPath(openNow)) return openNow;
            const linkNodes = Array.from(doc.querySelectorAll("div.links a[href], a[href]"));
            for (const a of linkNodes) {
                const href = normalizeUrl(getAttr(a, "href"), manifest.baseUrl);
                if (!href || href === url) continue;
                if (
                    /nontondrama|series\.lk21|lk21official/i.test(href) &&
                    isContentPath(href) &&
                    looksLikeDetailPath(href)
                ) {
                    return href;
                }
            }
            return url;
        } catch (_) {
            return url;
        }
    }

    function parseItemFromAnchor(anchor) {
        const href = normalizeUrl(getAttr(anchor, "href"), manifest.baseUrl);
        if (!href || !isContentPath(href)) return null;
        if (!looksLikeDetailPath(href)) return null;

        const img = anchor.querySelector("img");
        const rawTitle =
            htmlDecode(getAttr(anchor, "title")) ||
            textOf(anchor.querySelector("h2, h3, h4, .title, .name")) ||
            htmlDecode(getAttr(img, "alt", "title")) ||
            textOf(anchor);
        const title = cleanTitle(rawTitle);

        if (!title || title.length < 2) return null;

        const posterUrl = fixImageQuality(normalizeUrl(getAttr(img, "data-src", "data-lazy-src", "src", "data-original"), manifest.baseUrl));

        const type = isSeries(rawTitle, href, title) ? "series" : "movie";

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

    function collectItems(doc) {
        const selectors = [
            "article a[href]",
            "li a[href]",
            ".item a[href]",
            ".movie a[href]",
            ".post a[href]",
            ".thumb a[href]",
            ".swiper-slide a[href]",
            ".owl-item a[href]",
            "a[href]"
        ];

        const found = [];
        for (const sel of selectors) {
            const nodes = Array.from(doc.querySelectorAll(sel));
            for (const a of nodes) {
                const item = parseItemFromAnchor(a);
                if (item) found.push(item);
            }
            if (found.length >= 24) break;
        }

        return uniqueByUrl(found);
    }

    function buildSectionPageUrl(path, page) {
        const basePath = String(path || "/").replace(/\/+$/, "") || "/";
        if (page <= 1) return `${manifest.baseUrl}${basePath === "/" ? "/" : basePath}`;
        if (basePath === "/") return `${manifest.baseUrl}/page/${page}`;
        return `${manifest.baseUrl}${basePath}/page/${page}`;
    }

    async function fetchSection(path, maxPages = 2) {
        const all = [];
        for (let page = 1; page <= maxPages; page += 1) {
            try {
                const url = path.startsWith("http") ? path : buildSectionPageUrl(path, page);
                const doc = await loadDoc(url);
                const pageItems = collectItems(doc);
                if (pageItems.length === 0 && page > 1) break;
                all.push(...pageItems);
                if (all.length >= 36) break;
            } catch (_) {
                if (page === 1) return [];
                break;
            }
        }
        return uniqueByUrl(all);
    }

    const HOME_SECTIONS = [
        { name: "Latest", path: "/" },
        { name: "Popular", path: "/populer" },
        { name: "Top IMDb", path: "/rating" },
        { name: "Most Commented", path: "/most-commented" },
        { name: "Latest Upload", path: "/latest" },
        { name: "Movies", path: "/movie" },
        { name: "Series", path: "/series" }
    ];

    function parseMetadataLines(doc) {
        const blob = textOf(doc.body || doc.documentElement);
        return {
            score: (() => {
                const m = blob.match(/\b([0-9]\.[0-9])\b/);
                return m ? parseFloat(m[1]) : undefined;
            })(),
            year: parseYear(blob),
            quality: (() => {
                const m = blob.match(/\b(4k|2160p|1080p|720p|480p|360p|webrip|webdl|bluray|cam|hd|sd)\b/i);
                return m ? m[1].toUpperCase() : undefined;
            })(),
            duration: (() => {
                const m = blob.match(/(\d+)\s*h\s*(\d+)\s*m/i) || blob.match(/\b(\d+)\s*min\b/i);
                if (!m) return undefined;
                if (m[2]) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
                return parseInt(m[1], 10);
            })()
        };
    }

    function extractRedirectUrl(doc, currentUrl) {
        const fullText = textOf(doc.body || doc.documentElement);
        if (!/anda akan dialihkan|jika halaman tidak berganti/i.test(fullText)) return "";
        const openNow = normalizeUrl(getAttr(doc.querySelector("a#openNow"), "href"), manifest.baseUrl);
        if (openNow && openNow !== currentUrl && isContentPath(openNow) && looksLikeDetailPath(openNow)) return openNow;

        const candidates = Array.from(doc.querySelectorAll("a[href]"));
        for (const a of candidates) {
            const href = normalizeUrl(getAttr(a, "href"), manifest.baseUrl);
            if (!href || href === currentUrl) continue;
            if (/nontondrama|lk21official|lk21online|lk21\.party|lk21\.love/i.test(href)) {
                if (isContentPath(href) && looksLikeDetailPath(href)) return href;
            }
        }
        return "";
    }

    function parseSeasonPayload(raw) {
        const value = String(raw || "").trim();
        if (!value) return null;
        const candidates = [value];
        const assigned = value.match(/=\s*(\{[\s\S]*\})\s*;?\s*$/);
        if (assigned?.[1]) candidates.unshift(assigned[1]);
        const objectLike = value.match(/\{[\s\S]*\}/);
        if (objectLike?.[0] && !candidates.includes(objectLike[0])) candidates.push(objectLike[0]);
        for (const text of candidates) {
            try {
                return JSON.parse(text);
            } catch (_) {}
        }
        return null;
    }

    function slugStemFromUrl(url) {
        try {
            const path = new URL(url).pathname.replace(/^\/+|\/+$/g, "");
            const cleaned = path.replace(/-(19|20)\d{2}$/i, "");
            return cleaned.toLowerCase();
        } catch (_) {
            return "";
        }
    }

    function isLikelyEpisodeLink(href, baseUrl, anchorText) {
        const h = String(href || "").toLowerCase();
        const t = String(anchorText || "").toLowerCase();
        const episodePattern =
            /season[-_/]?\d+[-_/]?episode[-_/]?\d+/i.test(h) ||
            /[-_/]episode[-_/]?\d+/i.test(h) ||
            /\bs\d+\s*e\d+\b/i.test(t);
        if (!episodePattern) return false;

        const stem = slugStemFromUrl(baseUrl);
        if (!stem) return true;
        const stemHead = stem.split("-").slice(0, 2).join("-");
        if (!stemHead) return true;
        return h.includes(stem) || h.includes(stemHead);
    }

    function buildEpisodes(doc, fallbackUrl, fallbackPoster) {
        const eps = [];
        const baseOrigin = (() => {
            try {
                return new URL(fallbackUrl).origin;
            } catch (_) {
                return manifest.baseUrl;
            }
        })();

        const directSeasonNode = doc.querySelector("script#season-data");
        let seasonDataRaw = directSeasonNode?.textContent || directSeasonNode?.innerHTML || "";
        if (!seasonDataRaw) {
            const seasonScript = Array.from(doc.querySelectorAll("script")).find((s) => {
                const t = String(s?.textContent || "");
                return /episode_no|season-data|\"slug\"/i.test(t);
            });
            seasonDataRaw = seasonScript?.textContent || seasonScript?.innerHTML || "";
        }

        const root = parseSeasonPayload(seasonDataRaw);
        if (root && typeof root === "object") {
            for (const seasonKey of Object.keys(root || {})) {
                const arr = Array.isArray(root[seasonKey]) ? root[seasonKey] : [];
                for (const [idx, ep] of arr.entries()) {
                    const slug = String(ep?.slug || "").trim();
                    if (!slug) continue;
                    const season = Number(ep?.s) || parseInt(String(seasonKey).replace(/\D/g, ""), 10) || 1;
                    const episode = Number(ep?.episode_no) || Number(ep?.e) || (idx + 1);
                    const epUrl = normalizeUrl(`/${slug.replace(/^\/+/, "")}`, baseOrigin);
                    eps.push(new Episode({
                        name: `Episode ${episode}`,
                        url: epUrl,
                        season,
                        episode,
                        posterUrl: fallbackPoster
                    }));
                }
            }
        }

        if (eps.length === 0) {
            const candidates = Array.from(doc.querySelectorAll("a[href]"));

            for (const a of candidates) {
                const name = textOf(a);
                const href = normalizeUrl(getAttr(a, "href"), manifest.baseUrl);
                if (!href || !isContentPath(href)) continue;
                if (!/\b(episode|eps|ep\.?|s\d+e\d+|e\d+)\b/i.test(name)) continue;
                if (!isLikelyEpisodeLink(href, fallbackUrl, name)) continue;

                const sMatch = name.match(/s\.?\s*(\d+)/i) || href.match(/season[-_/]?(\d+)/i);
                const eMatch = name.match(/e\.?\s*(\d+)/i) || name.match(/episode\s*(\d+)/i) || href.match(/episode[-_/]?(\d+)/i);
                const season = sMatch ? parseInt(sMatch[1], 10) : 1;
                const episode = eMatch ? parseInt(eMatch[1], 10) : eps.length + 1;

                eps.push(new Episode({
                    name: name || `Episode ${episode}`,
                    url: href,
                    season,
                    episode,
                    posterUrl: fallbackPoster
                }));
            }
        }

        const deduped = [];
        const byEpisode = new Map();
        for (const ep of eps) {
            const key = `${ep.season}-${ep.episode}`;
            const current = byEpisode.get(key);
            if (!current) {
                byEpisode.set(key, ep);
                continue;
            }
            const score = (u) => {
                if (/series\.lk21\./i.test(u || "")) return 3;
                if (/lk21official/i.test(u || "")) return 2;
                return 1;
            };
            if (score(ep.url) > score(current.url)) byEpisode.set(key, ep);
        }
        deduped.push(...Array.from(byEpisode.values()));

        deduped.sort((a, b) => (a.season - b.season) || (a.episode - b.episode));

        if (deduped.length > 0) return deduped;

        return [new Episode({
            name: "Play",
            url: fallbackUrl,
            season: 1,
            episode: 1,
            posterUrl: fallbackPoster
        })];
    }

    function extractPlayerAnchors(doc) {
        const anchors = Array.from(doc.querySelectorAll("a[href]"));
        const out = [];

        for (const a of anchors) {
            const href = normalizeUrl(getAttr(a, "href"), manifest.baseUrl);
            const label = textOf(a).toUpperCase();
            if (!href) continue;

            if (
                href.includes("playeriframe") ||
                /\b(P2P|TURBOVIP|CAST|HYDRAX|PLAYER)\b/.test(label)
            ) {
                out.push({ href, label: label || "PLAYER" });
            }
        }

        if (out.length === 0) {
            const ifr = doc.querySelector("iframe[src]");
            const src = normalizeUrl(getAttr(ifr, "src"), manifest.baseUrl);
            if (src) out.push({ href: src, label: "PLAYER" });
        }

        const uniq = [];
        const seen = new Set();
        for (const x of out) {
            if (seen.has(x.href)) continue;
            seen.add(x.href);
            uniq.push(x);
        }
        return uniq;
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

    function stripTrailingQualityLabel(source) {
        return String(source || "HLS").replace(/\s*-\s*(auto|\d{3,4}p|\d+k)\s*$/i, "").trim() || "HLS";
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

            const baseSource = stripTrailingQualityLabel(sourceName);
            const quality = extractQuality(file);
            return [new StreamResult({
                name: `${baseSource} - ${quality}`,
                url: file,
                quality,
                source: `${baseSource} - ${quality}`,
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

            const baseSource = stripTrailingQualityLabel(sourceName);
            const quality = extractQuality(m3u8);
            return [new StreamResult({
                name: `${baseSource} - ${quality}`,
                url: m3u8,
                quality,
                source: `${baseSource} - ${quality}`,
                headers: {
                    "Referer": embedUrl,
                    "User-Agent": UA
                }
            })];
        } catch (_) {
            return [];
        }
    }

    function wrapExternal(name, url) {
        const quality = extractQuality(name + " " + url);
        const sourceName = String(name || "HLS").replace(/^LK21\s+/i, "").trim() || "HLS";
        return new StreamResult({
            name: `${sourceName} - ${quality}`,
            url,
            quality,
            source: `${sourceName} - ${quality}`,
            headers: {
                "Referer": `${manifest.baseUrl}/`,
                "User-Agent": UA
            }
        });
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
                const nameMatch = line.match(/NAME="?([^",]+)"?/i);
                const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
                const quality = resMatch?.[1]
                    ? `${resMatch[1]}p`
                    : (nameMatch?.[1] || (bwMatch?.[1] ? `${Math.round(parseInt(bwMatch[1], 10) / 1000)}k` : "Auto"));

                const variantUrl = resolveUrl(baseUrl, nextLine);
                if (!variantUrl || seenVariantUrl.has(variantUrl)) continue;
                seenVariantUrl.add(variantUrl);

                const baseSource = stripTrailingQualityLabel(stream.source || stream.name || "HLS");
                variants.push(new StreamResult({
                    name: `${baseSource} - ${quality}`,
                    url: variantUrl,
                    quality,
                    source: `${baseSource} - ${quality}`,
                    headers: stream.headers || {
                        "Referer": `${manifest.baseUrl}/`,
                        "User-Agent": UA
                    }
                }));
            }

            if (variants.length > 0) {
                const baseSource = stripTrailingQualityLabel(stream.source || stream.name || "HLS");
                variants.unshift(new StreamResult({
                    name: `${baseSource} - Auto`,
                    url: baseUrl,
                    quality: "Auto",
                    source: `${baseSource} - Auto`,
                    headers: stream.headers || {
                        "Referer": `${manifest.baseUrl}/`,
                        "User-Agent": UA
                    }
                }));
                return variants;
            }
            return [stream];
        } catch (_) {
            return [stream];
        }
    }

    async function resolvePlayerLink(playerLink, label) {
        const link = playerLink || "";
        if (!link) return [];

        let embed = link;
        if (link.includes("playeriframe")) {
            embed = await resolvePlayerIframe(link);
        }

        if (!embed) return [];

        if (embed.includes("cloud.hownetwork.xyz/video.php")) {
            return resolveP2P(embed, label || "P2P");
        }

        if (embed.includes("emturbovid") || embed.includes("turbovidhls") || embed.includes("turbovid")) {
            return resolveTurbo(embed, label || "TurboVIP");
        }

        if (embed.includes(".m3u8")) {
            return [wrapExternal(`LK21 ${label || "HLS"}`, embed)];
        }

        if (embed.includes("f16px.com") || embed.includes("short.icu") || embed.includes("abysscdn")) {
            return [wrapExternal(`LK21 ${label || "Embed"}`, embed)];
        }

        return [wrapExternal(`LK21 ${label || "Player"}`, embed)];
    }

    async function getHome(cb) {
        try {
            const data = {};

            for (const section of HOME_SECTIONS) {
                const items = await fetchSection(section.path, 2);
                if (items.length > 0) {
                    data[section.name] = items.slice(0, 30);
                }
            }

            if (Object.keys(data).length === 0) {
                const fallback = await fetchSection("/");
                if (fallback.length > 0) data["Latest"] = fallback.slice(0, 30);
            }

            if (!data["Series"]) {
                const seed = data["Latest"] || (await fetchSection("/", 2));
                const seriesOnly = seed.filter((x) => x.type === "series" || x.contentType === "series");
                if (seriesOnly.length > 0) data["Series"] = uniqueByUrl(seriesOnly).slice(0, 30);
            }

            cb({ success: true, data });
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: String(e?.message || e) });
        }
    }

    async function search(query, cb) {
        try {
            let rawQuery = String(query || "").trim();
            try {
                rawQuery = decodeURIComponent(rawQuery.replace(/\+/g, " "));
            } catch (_) {}
            rawQuery = rawQuery.replace(/^["']+|["']+$/g, "").trim();
            const q = encodeURIComponent(rawQuery);
            if (!rawQuery) return cb({ success: true, data: [] });
            const aggregated = [];
            const qPlus = rawQuery.replace(/\s+/g, "+");
            const normalizedQuery = rawQuery.toLowerCase();
            const tokens = normalizedQuery.split(/\s+/).filter((t) => t.length >= 2);

            const rankResults = (items) => {
                const uniq = uniqueByUrl(items || []);
                const scored = uniq.map((item) => {
                    const title = String(item?.title || "").toLowerCase();
                    let score = 0;
                    if (title.includes(normalizedQuery)) {
                        score = 3;
                    } else if (tokens.length > 1) {
                        const allTokens = tokens.every((token) => title.includes(token));
                        if (allTokens) score = 2;
                    } else if (tokens.length === 1 && title.includes(tokens[0])) {
                        score = 1;
                    }
                    return { item, score };
                });
                scored.sort((a, b) => b.score - a.score);
                const matched = scored.filter((x) => x.score > 0).map((x) => x.item);
                const fallback = scored.map((x) => x.item);
                return {
                    matched,
                    all: fallback,
                    final: matched.slice(0, 30)
                };
            };

            const quickSeed = await Promise.allSettled([
                withTimeout(fetchSection("/", 1), SEARCH_REQ_TIMEOUT_MS, "seed-latest"),
                withTimeout(fetchSection("/populer", 2), SEARCH_REQ_TIMEOUT_MS, "seed-popular")
            ]);
            for (const s of quickSeed) {
                if (s.status === "fulfilled") aggregated.push(...s.value);
            }
            const quickLocal = rankResults(aggregated).matched.slice(0, 30);
            if (quickLocal.length > 0) {
                return cb({ success: true, data: quickLocal });
            }

            const urls = [
                `${manifest.baseUrl}/search.php?s=${q}`,
                `${manifest.baseUrl}/search.php?s=${qPlus}`,
                `${manifest.baseUrl}/?s=${q}`,
                `${manifest.baseUrl}/?s=${qPlus}`,
                `${manifest.baseUrl}/search/${q}`
            ];

            const results = [];
            const batchOne = urls.slice(0, 4);
            const batchTwo = urls.slice(4);

            const runBatch = async (batch) => {
                const settled = await Promise.allSettled(
                    batch.map((u) =>
                        withTimeout(loadDoc(u, BASE_HEADERS), SEARCH_REQ_TIMEOUT_MS, u)
                            .then((doc) => collectItems(doc))
                    )
                );
                for (const item of settled) {
                    if (item.status !== "fulfilled") continue;
                    results.push(...item.value);
                    if (results.length >= 48) break;
                }
            };

            await runBatch(batchOne);

            aggregated.push(...results);
            let finalResults = rankResults(aggregated).final;

            if (finalResults.length === 0) {
                await runBatch(batchTwo);
                finalResults = rankResults(aggregated.concat(results)).final;
            }

            if (finalResults.length === 0) {
                const seedSections = ["/populer", "/movie", "/series"];
                const seedItems = [];
                for (const sectionPath of seedSections) {
                    try {
                        const items = await fetchSection(sectionPath, 2);
                        seedItems.push(...items);
                    } catch (_) {}
                    if (seedItems.length >= 80) break;
                }
                const fromSeed = uniqueByUrl(seedItems).filter((item) => {
                    const title = String(item?.title || "").toLowerCase();
                    if (title.includes(normalizedQuery)) return true;
                    if (tokens.length > 1) return tokens.every((token) => title.includes(token));
                    return tokens.length === 1 ? title.includes(tokens[0]) : false;
                });
                finalResults = fromSeed.slice(0, 30);
            }

            cb({ success: true, data: finalResults });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String(e?.message || e) });
        }
    }

    async function load(url, cb) {
        try {
            const properUrl = await resolveProperLink(url);
            const doc = await loadDoc(properUrl, BASE_HEADERS);
            let title =
                cleanTitle(textOf(doc.querySelector("h1"))) ||
                htmlDecode(getAttr(doc.querySelector('meta[property="og:title"]'), "content")).replace(/\s*[\-||].*$/, "") ||
                "Unknown";

            const posterUrl =
                fixImageQuality(normalizeUrl(getAttr(doc.querySelector('meta[property="og:image"]'), "content"), manifest.baseUrl) ||
                normalizeUrl(getAttr(doc.querySelector("img"), "data-src", "src"), manifest.baseUrl));

            const description =
                htmlDecode(getAttr(doc.querySelector('meta[property="og:description"]'), "content")) ||
                textOf(doc.querySelector(".entry-content p, .content p, article p, p"));

            const meta = parseMetadataLines(doc);
            const maybeSeries = isSeries(title, properUrl, description);
            const episodes = buildEpisodes(doc, properUrl, posterUrl);
            const redirectUrl = extractRedirectUrl(doc, properUrl);
            if (/dialihkan/i.test(title) && redirectUrl && looksLikeDetailPath(redirectUrl)) {
                title = cleanTitle(title.replace(/^anda akan dialihkan ke/i, "").replace(/dalam \d+ detik/i, ""));
            }

            const item = new MultimediaItem({
                title,
                url: properUrl,
                posterUrl,
                bannerUrl: posterUrl,
                description,
                year: meta.year,
                score: meta.score,
                duration: meta.duration,
                type: maybeSeries || episodes.length > 1 ? "series" : "movie",
                contentType: maybeSeries || episodes.length > 1 ? "series" : "movie",
                episodes
            });

            cb({ success: true, data: item });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: String(e?.message || e) });
        }
    }

    async function loadStreams(url, cb) {
        try {
            const properUrl = await resolveProperLink(url);
            let doc = await loadDoc(properUrl, BASE_HEADERS);
            let players = extractPlayerAnchors(doc);
            if (players.length === 0) {
                const redirectUrl = extractRedirectUrl(doc, properUrl);
                if (redirectUrl) {
                    try {
                        doc = await loadDoc(redirectUrl, BASE_HEADERS);
                        players = extractPlayerAnchors(doc);
                    } catch (_) {}
                }
            }

            if (players.length === 0) {
                const html = textOf(doc.body || doc.documentElement);
                const fallback = html.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/i)?.[0] || "";
                if (fallback) {
                    return cb({
                        success: true,
                        data: [new StreamResult({
                            name: `HLS - ${extractQuality(fallback)}`,
                            url: fallback,
                            quality: extractQuality(fallback),
                            source: `HLS - ${extractQuality(fallback)}`,
                            headers: {
                                "Referer": `${manifest.baseUrl}/`,
                                "User-Agent": UA
                            }
                        })]
                    });
                }

                return cb({ success: true, data: [] });
            }

            const all = [];
            for (const p of players) {
                const label = (p.label || "PLAYER").replace(/\s+/g, " ").trim();
                try {
                    const streams = await resolvePlayerLink(p.href, label);
                    all.push(...streams);
                } catch (_) {}
            }

            const expanded = [];
            for (const s of all) {
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
                const key = `${s.url}|${s.name}|${s.quality || ""}`;
                if (!s.url || seen.has(key)) continue;
                seen.add(key);
                uniq.push(s);
            }

            cb({ success: true, data: uniq });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: String(e?.message || e) });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
