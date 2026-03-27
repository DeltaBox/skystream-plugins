(function() {
    /**
     * @type {import('@skystream/sdk').Manifest}
     */
    // manifest is injected at runtime

    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
    const API_BASE = String(manifest.apiBaseUrl || "https://missab-seven.vercel.app").replace(/\/+$/, "");

    function normalizeSearchQuery(query) {
        let q = String(query || "").trim();
        try { q = decodeURIComponent(q); } catch (_) {}
        q = q.replace(/\+/g, " ");
        q = q.replace(/^["']|["']$/g, "");
        return q.trim();
    }

    function extractVideoId(input) {
        const raw = String(input || "").trim();
        if (!raw) return "";

        if (!/^https?:\/\//i.test(raw)) {
            return raw.replace(/^\/+|\/+$/g, "");
        }

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

    function parseYear(text) {
        const m = String(text || "").match(/\b(19\d{2}|20\d{2})\b/);
        return m ? parseInt(m[1], 10) : null;
    }

    function qualityPriority(value) {
        const q = String(value || "").toLowerCase();
        if (q === "auto") return 0;
        if (q === "4k" || q === "uhd" || q === "2160p") return 2160;
        const m = q.match(/(\d{3,4})p/);
        return m ? parseInt(m[1], 10) : 1;
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

    function toItemFromApi(video) {
        if (!video || !video.id) return null;
        const id = String(video.id);
        const title = String(video.title || id);
        const posterUrl = String(video.thumbnail || "");

        const meta = [];
        if (video.code) meta.push(String(video.code));
        if (video.quality) meta.push(String(video.quality));
        if (video.duration) meta.push(String(video.duration));

        return new MultimediaItem({
            title,
            url: `${manifest.baseUrl.replace(/\/+$/, "")}/en/${id}`,
            posterUrl,
            description: meta.join(" | "),
            type: "movie",
            contentType: "movie"
        });
    }

    async function request(url, headers = {}) {
        return http_get(url, {
            headers: Object.assign({
                "User-Agent": UA,
                "Accept": "application/json",
                "Referer": `${API_BASE}/`
            }, headers)
        });
    }

    async function apiGet(path) {
        const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
        const res = await request(url);
        const body = String(res?.body || "");
        try {
            return JSON.parse(body);
        } catch (_) {
            throw new Error(`API_INVALID_JSON: ${url}`);
        }
    }

    async function expandHlsVariants(stream) {
        const baseUrl = String(stream?.url || "");
        if (!/\.m3u8(\?|$)/i.test(baseUrl)) return [stream];

        try {
            const headers = Object.assign({}, stream?.headers || {}, {
                Referer: stream?.headers?.Referer || `${manifest.baseUrl}/`,
                "User-Agent": UA
            });
            const res = await http_get(baseUrl, { headers });
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

                const resolution = line.match(/RESOLUTION=\d+x(\d+)/i);
                const quality = resolution?.[1] ? `${resolution[1]}p` : "Auto";

                let variantUrl = "";
                try {
                    variantUrl = new URL(nextLine, baseUrl).toString();
                } catch (_) {
                    continue;
                }

                if (!variantUrl || seen.has(variantUrl)) continue;
                seen.add(variantUrl);
                variants.push(new StreamResult({
                    url: variantUrl,
                    quality,
                    source: `MissAV API - ${quality}`,
                    headers
                }));
            }

            if (variants.length === 0) return [stream];
            variants.sort((a, b) => qualityPriority(b.quality) - qualityPriority(a.quality));
            variants.push(new StreamResult({
                url: baseUrl,
                quality: "Auto",
                source: "MissAV API - Auto",
                headers
            }));
            return variants;
        } catch (_) {
            return [stream];
        }
    }

    async function getHome(cb) {
        try {
            const data = {};
            const [homeRes, latestRes, trendingRes, uncensoredRes] = await Promise.allSettled([
                apiGet("/api/home?page=1"),
                apiGet("/api/latest?page=1"),
                apiGet("/api/trending?page=1"),
                apiGet("/api/uncensored?page=1")
            ]);

            const home = homeRes.status === "fulfilled" ? homeRes.value : null;
            const latest = latestRes.status === "fulfilled" ? latestRes.value : null;
            const trending = trendingRes.status === "fulfilled" ? trendingRes.value : null;
            const uncensored = uncensoredRes.status === "fulfilled" ? uncensoredRes.value : null;

            const recommended = uniqueByUrl((home?.data || []).map(toItemFromApi).filter(Boolean)).slice(0, 24);
            const newRelease = uniqueByUrl((latest?.data || []).map(toItemFromApi).filter(Boolean)).slice(0, 24);
            const hot = uniqueByUrl((trending?.data || []).map(toItemFromApi).filter(Boolean)).slice(0, 24);
            const uncensoredItems = uniqueByUrl((uncensored?.data || []).map(toItemFromApi).filter(Boolean)).slice(0, 24);

            if (recommended.length > 0) data.Recommended = recommended;
            if (newRelease.length > 0) data["New Release"] = newRelease;
            if (hot.length > 0) data.Trending = hot;
            if (uncensoredItems.length > 0) data.Uncensored = uncensoredItems;

            cb({ success: true, data });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: String(e?.message || e) });
        }
    }

    async function search(query, cb) {
        try {
            const normalized = normalizeSearchQuery(query);
            const encoded = encodeURIComponent(normalized);
            const res = await apiGet(`/api/search?q=${encoded}&page=1`);
            const items = uniqueByUrl((res?.data || []).map(toItemFromApi).filter(Boolean));
            cb({ success: true, data: items });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String(e?.message || e) });
        }
    }

    async function load(url, cb) {
        try {
            const id = extractVideoId(url);
            if (!id) throw new Error("VIDEO_ID_MISSING");

            const res = await apiGet(`/api/video?id=${encodeURIComponent(id)}`);
            const details = res?.data;
            if (!details) throw new Error(`VIDEO_NOT_FOUND: ${id}`);

            const title = String(details.title || id);
            const posterUrl = "";
            const tags = uniqueStrings([...(details.genres || []), ...(details.tags || [])]);
            const actors = uniqueStrings(details.actresses || []);
            const year = parseYear(details.release_date);
            const duration = details.duration ? String(details.duration) : null;

            const descriptionParts = [];
            if (details.release_date) descriptionParts.push(`Release Date: ${details.release_date}`);
            if (details.duration) descriptionParts.push(`Duration: ${details.duration}`);
            if (details.studio) descriptionParts.push(`Studio: ${details.studio}`);
            if (details.label) descriptionParts.push(`Label: ${details.label}`);
            const description = descriptionParts.join(" | ");

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
                episodes: [new Episode({
                    name: title,
                    url: `${manifest.baseUrl.replace(/\/+$/, "")}/en/${id}`,
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
            const id = extractVideoId(url);
            if (!id) throw new Error("VIDEO_ID_MISSING");

            const res = await apiGet(`/api/video?id=${encodeURIComponent(id)}`);
            const details = res?.data || {};

            const rawCandidates = [];
            if (Array.isArray(details.streamVariants)) rawCandidates.push(...details.streamVariants);
            if (details.streamUrl) rawCandidates.push(details.streamUrl);

            const referer = `${manifest.baseUrl}/`;
            const directStreams = [];
            const seen = new Set();

            for (const raw of rawCandidates) {
                const cleaned = cleanupStreamUrl(raw, referer);
                if (!cleaned || seen.has(cleaned)) continue;
                seen.add(cleaned);
                directStreams.push(new StreamResult({
                    url: cleaned,
                    quality: streamQualityFromUrl(cleaned),
                    source: "MissAV API",
                    headers: { Referer: referer, "User-Agent": UA }
                }));
            }

            if (directStreams.length === 0) {
                throw new Error(`STREAM_NOT_FOUND: ${id}`);
            }

            const expanded = [];
            for (const stream of directStreams) {
                const variants = await expandHlsVariants(stream);
                expanded.push(...variants);
            }

            const finalStreams = uniqueByUrl(expanded)
                .sort((a, b) => qualityPriority(b.quality) - qualityPriority(a.quality));

            cb({ success: true, data: finalStreams });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: String(e?.message || e) });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
