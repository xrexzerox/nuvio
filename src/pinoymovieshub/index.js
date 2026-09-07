/** PinoyMoviesHub source provider, Streamline-style entrypoint. */
import { absUrl, dedupe, fetchText, makeStream, normalizeTitle, safeRun, stripTags } from "../_shared/utils.js";
import { buildCtx } from "../_shared/tmdb.js";

const BASE = "https://pinoymovieshub.win";

function titleScore(target, candidate) {
    const a = normalizeTitle(target);
    const b = normalizeTitle(candidate);
    if (!a || !b) return 0;
    if (a === b) return 100;
    if (a.indexOf(b) === 0 || b.indexOf(a) === 0) return 92;
    const aw = a.split(" ").filter(Boolean);
    const bw = b.split(" ").filter(Boolean);
    let hit = 0;
    aw.forEach(function (w) {
        if (w.length >= 3 && bw.indexOf(w) >= 0) hit++;
    });
    return Math.round((hit / Math.max(aw.length, 1)) * 80);
}

function extractLinks(html) {
    const links = [];
    const seen = {};
    const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html))) {
        const url = absUrl(BASE, m[1]);
        if (!url || seen[url]) continue;
        seen[url] = true;
        links.push({ url, text: stripTags(m[2]) });
    }
    return links;
}

function extractSearchResults(html) {
    return extractLinks(html).filter(function (x) {
        return /\/movies\//i.test(x.url) || /\/episodes\//i.test(x.url) || /\/series\//i.test(x.url);
    });
}

function extractExternalSources(html) {
    const out = [];
    const seen = {};
    const links = extractLinks(html);
    links.forEach(function (x) {
        const u = x.url.toLowerCase();
        const t = x.text.toLowerCase();
        let host = "";
        if (/doodstream|dood\./.test(u) || /doodstream/.test(t)) host = "Doodstream";
        else if (/mixdrop/.test(u) || /mixdrop/.test(t)) host = "Mixdrop";
        else if (/byse/.test(u) || /byse/.test(t)) host = "Byse";
        else if (/streamhide/.test(u) || /streamhide/.test(t)) host = "StreamHide";
        else if (/streamlare/.test(u) || /streamlare/.test(t)) host = "Streamlare";
        if (!host || seen[x.url]) return;
        seen[x.url] = true;
        out.push({ host, url: x.url });
    });

    // Some Dooplay pages put the source URL in iframes/scripts rather than anchors.
    const raw = String(html || "");
    const rawRe = /(https?:\\/\\/[^\"'<>\\s]+|\\/\\/[^\"'<>\\s]+)/gi;
    let rm;
    while ((rm = rawRe.exec(raw))) {
        const value = rm[1].replace(/&amp;/g, "&");
        const low = value.toLowerCase();
        let host = "";
        if (/doodstream|dood\./.test(low)) host = "Doodstream";
        else if (/mixdrop/.test(low)) host = "Mixdrop";
        else if (/byse/.test(low)) host = "Byse";
        else if (/streamhide/.test(low)) host = "StreamHide";
        else if (/streamlare/.test(low)) host = "Streamlare";
        if (!host || seen[value]) continue;
        const url = /^https?:/i.test(value) ? value : "https:" + value;
        seen[value] = true;
        out.push({ host, url });
    }
    return out;
}

function pickResult(results, ctx) {
    let best = null;
    let bestScore = -1;
    results.forEach(function (r) {
        const score = titleScore(ctx.title, r.text || r.url) +
            (ctx.year && String(r.text).indexOf(String(ctx.year)) >= 0 ? 5 : 0);
        if (score > bestScore) {
            bestScore = score;
            best = r;
        }
    });
    return bestScore >= 40 ? best : (results.length ? results[0] : null);
}

async function scrape(ctx) {
    const query = ctx.title + (ctx.isTv && ctx.season != null && ctx.episode != null
        ? " S" + String(ctx.season).padStart(2, "0") + "E" + String(ctx.episode).padStart(2, "0")
        : "");

    const searchUrls = [
        BASE + "/?s=" + encodeURIComponent(query),
        BASE + "/?s=" + encodeURIComponent(ctx.title)
    ];

    let results = [];
    for (let i = 0; i < searchUrls.length && !results.length; i++) {
        try {
            results = extractSearchResults(await fetchText(searchUrls[i]));
        } catch (e) {}
    }

    // Direct movie slug fallback is useful when WordPress search changes markup.
    if (!results && ctx.title) results = [];
    const selected = pickResult(results, ctx);
    let detailHtml = "";

    if (selected) {
        detailHtml = await fetchText(selected.url);
    } else {
        const slug = normalizeTitle(ctx.title).replace(/\s+/g, "-");
        const direct = BASE + "/movies/" + slug;
        try { detailHtml = await fetchText(direct); } catch (e) {
            try { detailHtml = await fetchText(BASE + "/series/" + slug); } catch (e2) {
                throw new Error("PinoyMoviesHub result not found for " + ctx.title);
            }
        }
    }

    const sources = extractExternalSources(detailHtml);
    const quality = /\b1080p\b/i.test(detailHtml) ? "1080p"
        : /\b720p\b/i.test(detailHtml) ? "720p"
        : /\b(2160p|4k)\b/i.test(detailHtml) ? "4K" : "Auto";

    return sources.map(function (s) {
        return makeStream(
            "PinoyMoviesHub",
            s.host + (quality !== "Auto" ? " • " + quality : ""),
            s.url,
            quality,
            { Referer: selected ? selected.url : BASE },
            [],
            { sourcePage: selected ? selected.url : BASE }
        );
    }).filter(Boolean);
}

export async function getStreams(tmdbId, mediaType, season, episode) {
    return safeRun("pinoymovieshub", async function () {
        const ctx = await buildCtx(String(tmdbId), mediaType === "tv" ? "tv" : "movie", season, episode);
        if (!ctx.title) return [];
        return dedupe(await scrape(ctx));
    });
}

module.exports = { getStreams };
