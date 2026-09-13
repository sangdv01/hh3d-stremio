const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const BASE_URL = "https://hh3d.to";

const builder = new addonBuilder({
    id: "com.sangdao.hh3d",
    version: "1.0.0",
    name: "HH3D",
    description: "Chinese 3D Animation addon for Stremio",
    resources: ["catalog", "meta", "stream"],
    types: ["series"],
    catalogs: [
        {
            type: "series",
            id: "hh3d",
            name: "HH3D",
            extra: [{ name: "search", isRequired: false }]
        }
    ]
});

async function getMovies() {
    const { data: html } = await axios.get(BASE_URL, {
        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0.0.0 Safari/537.36"
        }
    });

    const $ = cheerio.load(html);
    const movies = [];
    const seen = new Set();

    $(".halim-trending-card").each((_, el) => {
        const link = $(el).find("a.halim-trending-link").first();
        const href = link.attr("href");

        const name = $(el)
            .find("h3.halim-trending-title-text")
            .first()
            .text()
            .trim();

        const originalTitle = $(el)
            .find("p.halim-trending-original-title")
            .first()
            .text()
            .trim();

        let poster = $(el)
            .find("img.halim-trending-poster-image")
            .first()
            .attr("src");

        if (!href || !name) return;

        const url = new URL(href, BASE_URL).href;

        if (seen.has(url)) return;
        seen.add(url);

        if (poster) {
            poster = new URL(poster, BASE_URL).href;
        }

        const slug = new URL(url).pathname.replace(/^\/|\/$/g, "");

        movies.push({
            id: `hh3d:${slug}`,
            slug,
            name,
            originalTitle,
            url,
            poster
        });
    });

    return movies;
}

builder.defineCatalogHandler(async ({ type, id }) => {
    if (type !== "series" || id !== "hh3d") {
        return { metas: [] };
    }

    const movies = await getMovies();

    return {
        metas: movies.map(movie => ({
            id: movie.id,
            type: "series",
            name: movie.name,
            poster: movie.poster
        }))
    };
});

builder.defineMetaHandler(async ({ type, id }) => {
    if (type !== "series" || !id.startsWith("hh3d:")) {
        return { meta: null };
    }

    const slug = id.replace("hh3d:", "");
    const movieUrl = `${BASE_URL}/${slug}/`;

    const { data: html } = await axios.get(movieUrl, {
        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0.0.0 Safari/537.36"
        }
    });

    const $ = cheerio.load(html);

    const name = $("h1").first().text().trim() || slug;

    const poster =
        $("meta[property='og:image']").attr("content") ||
        $("img").first().attr("src");

    const videos = [];

    $("a.episode-item[href*='/tap-']").each((_, el) => {
        const href = $(el).attr("href");
        const title = $(el).find(".episode-number").text().trim();

        if (!href) return;

        const match = href.match(/\/tap-(\d+)\//);

        if (!match) return;

        const episode = Number(match[1]);

        videos.push({
            id: `hh3d:${slug}:${episode}`,
            title: title || `Tập ${episode}`,
            season: 1,
            episode
        });
    });

    return {
        meta: {
            id,
            type: "series",
            name,
            poster,
            videos
        }
    };
});

builder.defineStreamHandler(async ({ type, id }) => {
    if (type !== "series" || !id.startsWith("hh3d:")) {
        return { streams: [] };
    }

    const parts = id.split(":");

    if (parts.length !== 3) {
        return { streams: [] };
    }

    const slug = parts[1];
    const episode = parts[2];

    const episodeUrl =
        `${BASE_URL}/${slug}/tap-${String(episode).padStart(2, "0")}/`;

    console.log("STREAM REQUEST:");
    console.log("Episode URL:", episodeUrl);

    try {
        const { data: html } = await axios.get(episodeUrl, {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0.0.0 Safari/537.36"
            }
        });

        const match = html.match(
            /var\s+all_sources\s*=\s*(\[[\s\S]*?\]);/
        );

        if (!match) {
            console.log("ERROR: all_sources not found");
            return { streams: [] };
        }

        const sources = JSON.parse(match[1]);

        console.log("ALL SOURCES:", sources);

        if (!sources.length) {
            return { streams: [] };
        }

        const masterUrl = sources[0];

        console.log("MASTER URL:", masterUrl);

        const { data: master } = await axios.get(masterUrl, {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0.0.0 Safari/537.36"
            }
        });

        console.log("MASTER PLAYLIST OK");

        const lines = master.split(/\r?\n/);

        let stream1080 = null;

        for (let i = 0; i < lines.length; i++) {
            if (
                lines[i].includes("BANDWIDTH=3500000") &&
                lines[i].includes("RESOLUTION=1920x816")
            ) {
                stream1080 = lines[i + 1];
                break;
            }
        }

        if (!stream1080) {
            console.log("1080P not found, using master");
            return {
                streams: [
                    {
                        name: "HH3D",
                        title: "Original",
                        url: masterUrl
                    }
                ]
            };
        }

        const finalUrl = new URL(stream1080, masterUrl).href;

        console.log("FINAL 1080P URL:", finalUrl);

        return {
            streams: [
                {
                    name: "HH3D",
                    title: "1080p",
                    url: finalUrl
                }
            ]
        };

    } catch (error) {
        console.error("STREAM ERROR:", error.message);

        if (error.config && error.config.url) {
            console.error("FAILED URL:", error.config.url);
        }

        if (error.response) {
            console.error("STATUS:", error.response.status);
        }

        return { streams: [] };
    }
});

const PORT = process.env.PORT || 7000;

serveHTTP(builder.getInterface(), {
    port: PORT
});

console.log(`HH3D addon running on port ${PORT}`);
