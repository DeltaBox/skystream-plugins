(function() {
    /**
     * @type {import('@skystream/sdk').Manifest}
     */
    // manifest is injected at runtime

    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
    const BASE_HEADERS = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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

    function parseYear(text) {
        const m = String(text || "").match(/\b(19\d{2}|20\d{2})\b/);
        return m ? parseInt(m[1], 10) : undefined;
    }

    function uniqueByUrl(items) {
        const out = [];
        const seen = new Set();
        for (const it of items || []) {
            if (!it?.url || seen.has(it.url)) continue;
            seen.add(it.url);
            out.push(it);
        }
        return out;
    }

    function cleanTitle(raw) {
        return htmlDecode(String(raw || ""))
            .replace(/\s+(izle|türkçe altyazılı.*)$/i, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    function isEpisodeUrl(url) {
        return /-\d+\s*-\s*sezon-\d+\s*-\s*bolum-|-\d+-sezon-\d+-bolum-|sezon-\d+-bolum-/i.test(String(url || "").replace(/\s+/g, "-")) ||
            /-\d+-sezon-\d+-bolum-/i.test(String(url || "").toLowerCase());
    }

    function isSeriesUrl(url) {
        return /\/dizi\//i.test(String(url || ""));
    }

    async function request(url, headers = {}) {
        return http_get(url, {
            headers: Object.assign({}, BASE_HEADERS, headers)
        });
    }

    async function loadDoc(url, headers = {}) {
        const res = await request(url, headers);
        return parseHtml(res.body);
    }

    function parseListItem(card) {
        if (!card) return null;

        const a = card.querySelector(".poster a[href], .serie-name a[href], .episode-title a[href], a[href]");
        const href = normalizeUrl(getAttr(a, "href"), manifest.baseUrl);
        if (!href) return null;
        if (/\/(uye-ol|iletisim|dmca|wp-|tag\/|category\/|feed\/)/i.test(href)) return null;

        const img = card.querySelector("img");
        const title =
            cleanTitle(textOf(card.querySelector(".serie-name a, .serie-name, .episode-title .serie-name, h2 a, h3 a"))) ||
            cleanTitle(getAttr(a, "title")) ||
            cleanTitle(getAttr(img, "alt")) ||
            cleanTitle(textOf(a));
        if (!title) return null;

        const posterUrl = normalizeUrl(getAttr(img, "data-src", "src"), manifest.baseUrl);
        const type = isSeriesUrl(href) || isEpisodeUrl(href) ? "series" : "movie";

        return new MultimediaItem({
            title,
            url: href,
            posterUrl,
            type,
            contentType: type
        });
    }

    function collectItems(doc) {
        const cards = Array.from(doc.querySelectorAll(".list-series, .list-episodes, .single-list, .single-list-item, article, .episode-box"));
        const out = [];
        for (const card of cards) {
            const item = parseListItem(card);
            if (item) out.push(item);
        }
        return uniqueByUrl(out);
    }

    function decodeWatchBootstrapScript(html) {
        const body = String(html || "");
        const rx = /eval\(function\(h,u,n,t,e,r\)\{[\s\S]*?\}\("([^"]+)",(\d+),"([^"]+)",(\d+),(\d+),(\d+)\)\)/;
        const m = body.match(rx);
        if (!m) return "";

        const encoded = m[1];
        const alphabet = m[3];
        const shift = parseInt(m[4], 10);
        const delimIndex = parseInt(m[5], 10);
        const delim = String(alphabet[delimIndex] || "");
        if (!encoded || !delim) return "";

        const charset = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/".split("");
        function convertBase(str, fromBase, toBase) {
            const from = charset.slice(0, fromBase);
            const to = charset.slice(0, toBase);
            const num = str.split("").reverse().reduce((acc, ch, idx) => {
                const p = from.indexOf(ch);
                return p >= 0 ? acc + p * Math.pow(fromBase, idx) : acc;
            }, 0);
            let x = num;
            let out = "";
            while (x > 0) {
                out = to[x % toBase] + out;
                x = (x - (x % toBase)) / toBase;
            }
            return out || "0";
        }

        let decoded = "";
        for (let i = 0; i < encoded.length; i += 1) {
            let token = "";
            while (i < encoded.length && encoded[i] !== delim) {
                token += encoded[i];
                i += 1;
            }
            for (let j = 0; j < alphabet.length; j += 1) {
                token = token.replace(new RegExp(alphabet[j], "g"), String(j));
            }
            const chCode = parseInt(convertBase(token, delimIndex, 10), 10) - shift;
            if (!Number.isNaN(chCode)) decoded += String.fromCharCode(chCode);
        }

        return decoded;
    }

    function unpackPackerScript(scriptBody) {
        const text = String(scriptBody || "");
        const rx = /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\),\s*\d+,\s*\{\}\)\)/;
        const m = text.match(rx);
        if (!m) return text;

        let payload = m[1];
        let c = parseInt(m[3], 10);
        const dictionary = m[4].split("|");
        const map = {};
        while (c--) map[c] = dictionary[c] || String(c);
        return payload.replace(/\b\w+\b/g, (w) => (map[w] !== undefined ? map[w] : w));
    }

    function extractM3u8Candidates(text, baseUrl = manifest.baseUrl) {
        const raw = String(text || "")
            .replace(/\\u002F/gi, "/")
            .replace(/\\u003A/gi, ":")
            .replace(/\\+\//g, "/")
            .replace(/&amp;/g, "&");

        const out = new Set();
        const patterns = [
            /"(?:file|src|source|playlist|video_url|hls)"\s*:\s*"([^"]+?\.m3u8[^"]*)"/gi,
            /(?:file|src|source|playlist|video_url|hls)"?\s*[:=]\s*["']([^"']+?\.m3u8[^"']*)["']/gi,
            /["']((?:https?:)?\/\/[^"'\s]+?\.m3u8[^"'\s]*)["']/gi,
            /(https?:\/\/[^\s"'<>]+?\.m3u8[^\s"'<>]*)/gi
        ];

        for (const p of patterns) {
            let m;
            while ((m = p.exec(raw)) !== null) {
                const u = resolveUrl(baseUrl, String(m[1] || "").trim());
                if (/\.m3u8(\?|$)/i.test(u)) out.add(u);
            }
        }
        return Array.from(out);
    }

    function extractEpisodeInfo(textOrUrl) {
        const t = String(textOrUrl || "").toLowerCase();
        const m = t.match(/(\d+)\.?\s*sezon\s*(\d+)\.?\s*bölüm/) || t.match(/-(\d+)-sezon-(\d+)-bolum-/);
        if (!m) return { season: 1, episode: 1 };
        return {
            season: parseInt(m[1], 10) || 1,
            episode: parseInt(m[2], 10) || 1
        };
    }

    function qualityPriority(q) {
        const x = String(q || "").toLowerCase();
        if (x === "auto") return 0;
        const m = x.match(/(\d{3,4})p/);
        return m ? parseInt(m[1], 10) : 1;
    }

    async function expandHlsVariants(stream) {
        try {
            const baseUrl = String(stream?.url || "");
            if (!/\.m3u8(\?|$)/i.test(baseUrl)) return [stream];

            const res = await request(baseUrl, {
                "Referer": stream?.headers?.Referer || baseUrl
            });
            const body = String(res?.body || "");
            if (!/#EXT-X-STREAM-INF/i.test(body)) return [stream];

            const lines = body.split(/\r?\n/);
            const variants = [];
            for (let i = 0; i < lines.length; i += 1) {
                const line = lines[i] || "";
                if (!line.startsWith("#EXT-X-STREAM-INF")) continue;
                const next = (lines[i + 1] || "").trim();
                if (!next || next.startsWith("#")) continue;

                const q = line.match(/RESOLUTION=\d+x(\d+)/i)?.[1];
                const quality = q ? `${q}p` : "Auto";
                const child = resolveUrl(baseUrl, next);
                variants.push(new StreamResult({
                    name: `Dizigom - ${quality}`,
                    url: child,
                    quality,
                    source: `Dizigom - ${quality}`,
                    headers: stream.headers
                }));
            }

            if (variants.length > 0) {
                variants.sort((a, b) => qualityPriority(b.quality) - qualityPriority(a.quality));
                return variants;
            }
            return [stream];
        } catch (_) {
            return [stream];
        }
    }

    async function getHome(cb) {
        try {
            const data = {};
            const sections = [
                { name: "Latest Series", path: "/", type: "series" },
                { name: "Latest Episodes", path: "/tum-bolumler/", type: "series" },
                { name: "Epic Series", path: "/efsane-diziler-hd2/", fallbackPath: "/efsane-diziler-hd1/", type: "series" },
                { name: "Netflix", path: "/netflix-dizileri-hd1/", type: "series" },
                { name: "Korean", path: "/kore-dizileri-hd1/", type: "series" },
                { name: "Anime", path: "/anime-dizileri-hd1/", type: "series" },
                { name: "Japanese", path: "/japon-dizileri-hd1/", type: "series" },
                { name: "Chinese", path: "/cin-dizileri-hd1/", type: "series" },
                { name: "Movies", path: "/tum-yabanci-filmler-hd2/", type: "movie" }
            ];

            for (const section of sections) {
                let items = [];
                try {
                    const doc = await loadDoc(`${manifest.baseUrl}${section.path}`);
                    items = collectItems(doc);
                } catch (_) {}

                if (items.length === 0 && section.fallbackPath) {
                    try {
                        const fallbackDoc = await loadDoc(`${manifest.baseUrl}${section.fallbackPath}`);
                        items = collectItems(fallbackDoc);
                    } catch (_) {}
                }

                if (section.type === "movie") {
                    items = items.map((x) => new MultimediaItem({
                        title: x.title,
                        url: x.url,
                        posterUrl: x.posterUrl,
                        type: "movie",
                        contentType: "movie"
                    }));
                } else if (section.path === "/") {
                    items = items.filter((x) => isSeriesUrl(x.url) || isEpisodeUrl(x.url));
                }

                items = uniqueByUrl(items).slice(0, 30);
                if (items.length > 0) data[section.name] = items;
            }

            cb({ success: true, data });
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: String(e?.message || e) });
        }
    }

    async function search(query, cb) {
        try {
            const raw = String(query || "").trim();
            if (!raw) return cb({ success: true, data: [] });

            const q = encodeURIComponent(raw);
            const doc = await loadDoc(`${manifest.baseUrl}/?s=${q}`);
            const ranked = collectItems(doc).filter((it) => String(it.title || "").toLowerCase().includes(raw.toLowerCase()));
            cb({ success: true, data: ranked.length ? ranked.slice(0, 40) : collectItems(doc).slice(0, 40) });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String(e?.message || e) });
        }
    }

    async function load(url, cb) {
        try {
            const target = normalizeUrl(url, manifest.baseUrl);
            const doc = await loadDoc(target);

            const title =
                cleanTitle(textOf(doc.querySelector("h1"))) ||
                cleanTitle(getAttr(doc.querySelector('meta[property="og:title"]'), "content")) ||
                "Unknown";
            const posterUrl = normalizeUrl(
                getAttr(doc.querySelector('meta[property="og:image"], .poster img, .seriePoster img, img'), "content", "data-src", "src"),
                manifest.baseUrl
            );
            const description =
                cleanTitle(getAttr(doc.querySelector('meta[property="og:description"]'), "content")) ||
                textOf(doc.querySelector(".serieDescription, .entry-content p, .description, p"));

            let episodes = [];
            if (isSeriesUrl(target)) {
                const nodes = Array.from(doc.querySelectorAll(".serieEpisodes a[href], .otherepisodes a[href], .seasonEpisodes a[href], a[href]"));
                for (const a of nodes) {
                    const href = normalizeUrl(getAttr(a, "href"), manifest.baseUrl);
                    if (!href || !isEpisodeUrl(href)) continue;
                    const name = cleanTitle(textOf(a)) || `Episode ${episodes.length + 1}`;
                    const info = extractEpisodeInfo(`${name} ${href}`);
                    episodes.push(new Episode({
                        name,
                        url: href,
                        season: info.season,
                        episode: info.episode,
                        posterUrl
                    }));
                }
                episodes = uniqueByUrl(episodes);
                episodes.sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
            } else {
                const info = extractEpisodeInfo(`${title} ${target}`);
                episodes = [new Episode({
                    name: title,
                    url: target,
                    season: info.season,
                    episode: info.episode,
                    posterUrl
                })];
            }

            const contentType = isSeriesUrl(target) || isEpisodeUrl(target) ? "series" : "movie";
            const year = parseYear(`${title} ${description} ${textOf(doc.body || doc.documentElement)}`);

            const item = new MultimediaItem({
                title,
                url: target,
                posterUrl,
                bannerUrl: posterUrl,
                description,
                type: contentType,
                contentType,
                year,
                episodes: episodes.length ? episodes : [new Episode({
                    name: title,
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
            const pageUrl = normalizeUrl(url, manifest.baseUrl);
            const pageRes = await request(pageUrl);
            const html = String(pageRes?.body || "");

            const watchBootstrap = decodeWatchBootstrapScript(html);
            const watchPath = watchBootstrap.match(/\/api\/watch\/[a-f0-9]+\.dizigom/i)?.[0] || "";
            const watchUrl = watchPath ? resolveUrl(pageUrl, watchPath) : "";

            let embedUrls = [];
            if (watchUrl) {
                const watchRes = await request(watchUrl, { "X-Requested-With": "XMLHttpRequest" });
                const payload = String(watchRes?.body || "").trim();
                let decoded = payload;
                try { decoded = atob(payload); } catch (_) {}
                const iframes = Array.from(decoded.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)).map((m) => m[1]);
                embedUrls = iframes.map((u) => resolveUrl(pageUrl, u)).filter(Boolean);
            }

            if (embedUrls.length === 0) {
                const fallbackEmbed = html.match(/embedUrl"\s*:\s*"([^"]+)"/i)?.[1] || "";
                if (fallbackEmbed) embedUrls.push(resolveUrl(pageUrl, fallbackEmbed.replace(/\\\//g, "/")));
            }

            const rawStreams = [];
            for (const embedUrl of embedUrls) {
                try {
                    const embedRes = await request(embedUrl, { Referer: pageUrl });
                    const embedHtml = String(embedRes?.body || "");
                    const unpacked = unpackPackerScript(embedHtml);
                    const candidates = extractM3u8Candidates(`${embedHtml}\n${unpacked}`, embedUrl);
                    for (const m3u8 of candidates) {
                        rawStreams.push(new StreamResult({
                            name: "Dizigom - Auto",
                            url: m3u8,
                            quality: "Auto",
                            source: "Dizigom - Auto",
                            headers: {
                                "Referer": embedUrl,
                                "User-Agent": UA
                            }
                        }));
                    }
                } catch (_) {}
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
                if (!/\.m3u8(\?|$)/i.test(String(s?.url || ""))) continue;
                const key = `${s.url}|${s.quality || ""}`;
                if (seen.has(key)) continue;
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
