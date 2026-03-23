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

    function normalizeUrl(url, base) {
        if (!url) return "";
        const raw = String(url).trim();
        if (!raw) return "";
        if (raw.startsWith("//")) return `https:${raw}`;
        if (/^https?:\/\//i.test(raw)) return raw;
        if (raw.startsWith("/")) return `${base}${raw}`;
        return `${base}/${raw}`;
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

    async function loadDoc(url, headers = BASE_HEADERS) {
        const res = await request(url, headers);
        return parseHtml(res.body);
    }

    function parseItemFromElement(el) {
        const titleAnchor = el.querySelector("div.details div.title a[href], div.data h3 a[href], h3 a[href], h2 a[href], .title a[href]");
        const a = titleAnchor || el.querySelector("a[href]");
        const href = normalizeUrl(getAttr(a, "href"), manifest.baseUrl);
        if (!href || !isContentPath(href)) return null;

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
                const doc = await loadDoc(url);
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
                    const doc = await loadDoc(url);
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
            const doc = await loadDoc(url);
            
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

    globalThis.loadStreams = async function(url, cb) {
        try {
            const doc = await loadDoc(url);
            const streams = [];
            const seen = new Set();

            const addStream = (stream) => {
                if (stream && stream.url && !seen.has(stream.url)) {
                    if (stream.url.includes("about:blank")) return;
                    seen.add(stream.url);
                    streams.push(stream);
                }
            };

            // Extract from iframes
            const iframes = Array.from(doc.querySelectorAll("div.pframe iframe[src]"));
            for (const ifr of iframes) {
                const src = normalizeUrl(getAttr(ifr, "src"), manifest.baseUrl);
                if (src) {
                    addStream(new StreamResult({
                        url: src,
                        source: "Embed",
                        quality: "Auto"
                    }));
                }
            }

            // Extract from dooplay player options
            const options = Array.from(doc.querySelectorAll("li.dooplay_player_option[data-url]"));
            for (const opt of options) {
                const serverUrl = getAttr(opt, "data-url");
                if (serverUrl) {
                    addStream(new StreamResult({
                        url: serverUrl,
                        source: textOf(opt.querySelector("span.title")) || "Server",
                        quality: "Auto"
                    }));
                }
            }

            // Extract from download links
            const downloads = Array.from(doc.querySelectorAll("div#download a.myButton[href]"));
            for (const a of downloads) {
                const href = normalizeUrl(getAttr(a, "href"), manifest.baseUrl);
                if (href) {
                    addStream(new StreamResult({
                        url: href,
                        source: "Download",
                        quality: "Auto"
                    }));
                }
            }

            cb({ success: true, data: streams });
        } catch (e) {
            cb({ success: false, message: String(e) });
        }
    };

})();
