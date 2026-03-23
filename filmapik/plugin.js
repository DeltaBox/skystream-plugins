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

        const posterUrl = normalizeUrl(getAttr(img, "src", "data-src", "data-lazy-src"), manifest.baseUrl);
        
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

    globalThis.search = async function(query, cb) {
        try {
            const q = encodeURIComponent(query.trim());
            const endpoints = [
                `${manifest.baseUrl}/?s=${q}`,
                `${manifest.baseUrl}/?s=${q}&post_type[]=post&post_type[]=tv`
            ];

            const out = [];
            const seen = new Set();

            for (const url of endpoints) {
                try {
                    const doc = await loadSiteDoc(url);
                    const items = Array.from(doc.querySelectorAll("div.result-item article, div.result-item, article.item, div.items article.item"))
                        .map(parseItemFromElement)
                        .filter(Boolean);
                    
                    for (const it of items) {
                        if (!seen.has(it.url)) {
                            seen.add(it.url);
                            out.push(it);
                        }
                    }
                    if (out.length > 0) break;
                } catch (_) {}
            }

            cb({ success: true, data: out });
        } catch (e) {
            cb({ success: false, message: String(e) });
        }
    };

    globalThis.load = async function(url, cb) {
        try {
            const doc = await loadSiteDoc(url);
            
            const title = cleanTitle(
                textOf(doc.querySelector("h1[itemprop=name], .sheader h1, .sheader h2, #info h2"))
            );
            const posterUrl = normalizeUrl(getAttr(doc.querySelector(".sheader .poster img, .poster img"), "src"), manifest.baseUrl);
            const description = textOf(doc.querySelector("div[itemprop=description], .wp-content, .entry-content, .desc, .entry")) || "Tidak ada deskripsi.";
            
            const yearText = textOf(doc.querySelector("#info .info-more .country a"));
            const year = safeParseInt(yearText);
            
            const ratingText = textOf(doc.querySelector("#repimdb strong"));
            const score = safeParseFloat(ratingText);
            
            const tags = Array.from(doc.querySelectorAll("span.sgeneros a")).map(textOf);
            
            const actors = Array.from(doc.querySelectorAll(".info-more span.tagline"))
                .filter(el => /Actors|Stars/i.test(textOf(el)))
                .flatMap(el => Array.from(el.querySelectorAll("a")).map(a => ({ name: textOf(a) })));

            const seasonBlocks = Array.from(doc.querySelectorAll("#seasons .se-c"));
            const episodes = [];

            if (seasonBlocks.length > 0) {
                seasonBlocks.forEach((block, sIdx) => {
                    const seasonNum = safeParseInt(textOf(block.querySelector(".se-q .se-t"))?.replace(/\D/g, "")) || (sIdx + 1);
                    const epNodes = Array.from(block.querySelectorAll(".se-a ul.episodios li a"));
                    epNodes.forEach((ep, eIdx) => {
                        const epUrl = normalizeUrl(getAttr(ep, "href"), manifest.baseUrl);
                        const epName = textOf(ep) || `Episode ${eIdx + 1}`;
                        episodes.push(new Episode({
                            name: epName,
                            url: epUrl,
                            season: seasonNum,
                            episode: eIdx + 1,
                            posterUrl: posterUrl
                        }));
                    });
                });
            }

            if (episodes.length === 0) {
                const playUrl = normalizeUrl(getAttr(doc.querySelector("#clickfakeplayer, .fakeplayer a"), "href"), url);
                episodes.push(new Episode({
                    name: "Play",
                    url: playUrl || url,
                    season: 1,
                    episode: 1,
                    posterUrl: posterUrl
                }));
            }

            const type = seasonBlocks.length > 0 ? "series" : "movie";

            const item = new MultimediaItem({
                title,
                url,
                posterUrl,
                description,
                type,
                contentType: type,
                episodes,
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

    async function resolveEfekStream(url, label = "VIP SERVER") {
        try {
            const res = await request(url, { "User-Agent": UA, "Referer": manifest.baseUrl + "/" });
            const html = res.body || "";
            
            // Look for packed script
            const packerMatch = html.match(/eval\(function\(p,a,c,k,e,d\)\{([\s\S]*?)\}\(([\s\S]*?)\)\)/);
            if (packerMatch) {
                const argsRaw = packerMatch[2];
                // Very crude extraction of arguments
                const args = argsRaw.split(',').map(s => s.trim().replace(/^'|'$/g, '').replace(/^"|"$/g, ''));
                if (args.length >= 4) {
                    const p = packerMatch[1];
                    const a = parseInt(args[args.length-4]);
                    const c = parseInt(args[args.length-3]);
                    const k = args[args.length-2].split('|');
                    const e = 0;
                    const d = {};
                    const unpacked = unpack(p, a, c, k, e, d);
                    
                    // Now find sources in unpacked
                    const sourceMatches = unpacked.matchAll(/\{['"]?label['"]?:\s*['"]([^'"]+)['"],\s*['"]?type['"]?:\s*['"]([^'"]+)['"],\s*['"]?file['"]?:\s*['"]([^'"]+)['"]/g);
                    const streams = [];
                    for (const m of sourceMatches) {
                        const file = m[3];
                        const q = m[1];
                        const streamUrl = resolveUrl(url, file);
                        streams.push(new StreamResult({
                            url: streamUrl,
                            quality: q,
                            source: `${label} - ${q}`,
                            headers: { "Referer": url, "User-Agent": UA }
                        }));
                    }
                    if (streams.length > 0) return streams;
                }
            }

            // Fallback to direct regex if not packed
            const sources = html.match(/sources\s*:\s*\[([\s\S]*?)\]/);
            if (sources) {
                const list = sources[1].matchAll(/file\s*:\s*["']([^"']+)["']/g);
                const results = [];
                for (const m of list) {
                    results.push(new StreamResult({
                        url: resolveUrl(url, m[1]),
                        quality: "Auto",
                        source: label,
                        headers: { "Referer": url, "User-Agent": UA }
                    }));
                }
                return results;
            }

            return [];
        } catch (_) { return []; }
    }

    async function resolvePlayerLink(playerLink, label) {
        const embed = playerLink || "";
        if (!embed || embed.includes("about:blank")) return [];

        if (embed.includes("efek.stream")) {
            return await resolveEfekStream(embed, label);
        }

        const quality = extractQuality(embed);
        return [new StreamResult({
            url: embed,
            quality,
            source: `${label || "Player"} - ${quality}`,
            headers: { "Referer": manifest.baseUrl + "/", "User-Agent": UA }
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
            const seen = new Set();

            // Extract from dooplay player options
            const options = Array.from(doc.querySelectorAll("li.dooplay_player_option[data-url]"));
            for (const opt of options) {
                const rawUrl = getAttr(opt, "data-url");
                if (rawUrl) {
                    // Try to find the server title in the same parent or preceding sibling
                    let label = "Server";
                    const ul = opt.closest("ul");
                    if (ul) {
                        const titleEl = ul.querySelector("span.server_title");
                        if (titleEl) label = textOf(titleEl);
                    }
                    
                    const results = await resolvePlayerLink(rawUrl, label);
                    results.forEach(r => rawStreams.push(r));
                }
            }

            // Extract from iframes if no options found
            if (rawStreams.length === 0) {
                const iframes = Array.from(doc.querySelectorAll("div.pframe iframe[src]"));
                for (const ifr of iframes) {
                    const src = normalizeUrl(getAttr(ifr, "src"), manifest.baseUrl);
                    if (src) {
                        const results = await resolvePlayerLink(src, "Embed");
                        results.forEach(r => rawStreams.push(r));
                    }
                }
            }

            // Extract from download links
            const downloads = Array.from(doc.querySelectorAll("div#download a.myButton[href]"));
            for (const a of downloads) {
                const href = normalizeUrl(getAttr(a, "href"), manifest.baseUrl);
                if (href) {
                    const label = textOf(a).split(/\s+/)[0] || "Download";
                    rawStreams.push(new StreamResult({
                        url: href,
                        source: `Download (${label})`,
                        quality: extractQuality(href),
                        headers: { "Referer": sourceUrl, "User-Agent": UA }
                    }));
                }
            }

            const expanded = [];
            for (const s of rawStreams) {
                const variants = await expandHlsVariants(s);
                variants.forEach(v => expanded.push(v));
            }

            const final = [];
            for (const s of expanded) {
                if (s.url && !seen.has(s.url)) {
                    seen.add(s.url);
                    final.push(s);
                }
            }

            cb({ success: true, data: final });
        } catch (e) {
            cb({ success: false, message: String(e) });
        }
    };

})();
