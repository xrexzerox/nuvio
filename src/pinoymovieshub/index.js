/** PinoyMoviesHub source provider, Streamline-style entrypoint. */
import {
    absUrl,
    dedupe,
    fetchJson,
    fetchText,
    makeStream,
    normalizeTitle,
    parseQuality,
    safeRun,
    stripTags
} from "../_shared/utils.js";

const BASE = "https://pinoymovieshub.win";
const CINEMETA = "https://v3-cinemeta.strem.io/meta";

async function getMeta(tmdbId, mediaType) {
    const kind = mediaType === "tv" ? "series" : "movie";
    const data = await fetchJson(CINEMETA + "/" + kind + "/" + encodeURIComponent(String(tmdbId)) + ".json");
    const meta = data && data.meta;
    if (!meta) throw new Error("No metadata returned");
    return {
        title: meta.name || meta.title || "",
        year: meta.year || "",
        originalTitle: meta.name || meta.title || ""
    };
}

function extractResults(html) {
    const results = [];
    const seen = {};
    const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,5000}?)<\/a>/gi;
    let m;
    while ((m = re.exec(html))) {
        const href = m[1];
        if (!/\/(movies|series)\//i.test(href)) continue;
        const block = m[2];
        const tm = block.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
        const title = stripTags(tm ? tm[1] : block).slice(0, 160).trim();
        const url = absUrl(BASE, href);
        if (!title || !url || seen[url]) continue;
        seen[url] = true;
        results.push({ title, url });
    }
    return results;
}

function score(target, candidate) {
    const a = normalizeTitle(target);
    const b = normalizeTitle(candidate);
    if (!a || !b) return 0;
    if (a === b) return 100;
    if (b.indexOf(a) >= 0 || a.indexOf(b) >= 0) return 85;
    const aw = a.split(" ");
    const bw = b.split(" ");
    let hits = 0;
    aw.forEach(function (w) {
        if (w.length >= 3 && bw.indexOf(w) >= 0) hits++;
    });
    return Math.round((hits / Math.max(aw.length, 1)) * 70);
}

function choose(results, title, year) {
    let best = null;
    let bestScore = -1;
    results.forEach(function (r) {
        let s = score(title, r.title);
        if (year && String(r.title).indexOf(String(year)) >= 0) s += 3;
        if (s > bestScore) {
            bestScore = s;
            best = r;
        }
    });
    return bestScore >= 45 ? best : null;
}

function extractSources(html) {
    const sources = [];
    const seen = {};
    const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html))) {
        const label = stripTags(m[2]);
        let host = "";
        if (/doodstream/i.test(label)) host = "Doodstream";
        else if (/mixdrop/i.test(label)) host = "Mixdrop";
        else if (/byse/i.test(label)) host = "Byse";
        if (!host) continue;
        const url = absUrl(BASE, m[1]);
        if (!url || seen[url]) continue;
        seen[url] = true;
        sources.push({ host, url });
    }
    return sources;
}

async function scrape(ctx) {
    const meta = await getMeta(ctx.tmdbId, ctx.mediaType);
    if (!meta.title) return [];

    let query = meta.title;
    if (ctx.mediaType === "tv" && ctx.season != null && ctx.episode != null) {
        query += " S" + String(ctx.season).padStart(2, "0") + "E" + String(ctx.episode).padStart(2, "0");
    }

    const html = await fetchText(BASE + "/?s=" + encodeURIComponent(query));
    const result = choose(extractResults(html), meta.title, meta.year);
    if (!result) throw new Error("No PinoyMoviesHub match for " + meta.title);

    const detail = await fetchText(result.url);
    const quality = parseQuality(detail);
    const sources = extractSources(detail);

    return sources.map(function (s) {
        return makeStream(
            "PinoyMoviesHub",
            s.host + (quality !== "Auto" ? " • " + quality : ""),
            s.url,
            quality,
            {
                referrer: result.url
            },
            [],
            { sourcePage: result.url }
        );
    }).filter(Boolean);
}

export async function getStreams(tmdbId, mediaType, season, episode) {
    return safeRun("pinoymovieshub", function () {
        return scrape({
            tmdbId: String(tmdbId),
            mediaType: mediaType === "tv" ? "tv" : "movie",
            season: season != null ? season : null,
            episode: episode != null ? episode : null
        }).then(dedupe);
    });
}

module.exports = { getStreams };
