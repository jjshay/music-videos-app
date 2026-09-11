# Music Video Creator

> Turn raw art-listing clips into branded, beat-synced music videos — Claude Vision writes the overlays, FFmpeg cuts to the beat, and the result ships in Gauntlet Gallery's house style.

## Overview

Gauntlet Gallery lists art on eBay and Shopify, and video sells — but hand-editing overlay text, captions, intros, and music sync for every listing clip does not scale. This Express app is a local rendering pipeline: upload a clip (or pull one from YouTube), let Claude Vision analyze extracted key frames to write contextual overlay copy, detect beats in the soundtrack with FFmpeg RMS analysis, and composite everything — branded intro/outro cards, timed captions, crossfades, and mixed audio — into a finished MP4, with render progress streamed live to the browser.

Part of the **Gauntlet Gallery** portfolio pillar (authenticated art & collectibles commerce — eBay + Shopify).

## Key Features

- **Claude Vision frame analysis** — key frames are extracted with FFmpeg and sent to the Anthropic SDK to generate contextual overlay text per scene
- **Beat detection without ML deps** — FFmpeg `astats` RMS levels are peak-scanned to find beat onsets; clip durations snap to the detected grid
- **Two pipelines** — a product-listing overlay flow (`/api/upload` → `/api/analyze` → `/api/render`) and a full multi-clip music-video flow (`/api/music-video`) with intro/outro cards, crossfade concatenation, and audio mixing
- **YouTube ingestion** — validated YouTube/Shorts URLs are downloaded via `yt-dlp` and trimmed into usable segments
- **Pexels stock footage** — supplemental clips (e.g. crowd shots) fetched by keyword from the Pexels video API
- **Brand system as config** — colors (navy/gold), fonts (Didot/Futura/Baskerville), intro cards, and defaults live in `src/config/brand.js`
- **Live render progress** — `/api/render` streams stage-by-stage progress over Server-Sent Events
- **Edit history / style learning** — accepted edits are recorded and folded back into the Claude prompt as a style guide for future renders
- **Job isolation** — every upload gets a UUID job directory under `temp/` holding source media, frames, `job.json` state, and final output

## How It Works

1. **Upload** — Multer stores the clip (`.mov/.mp4/.m4v/.avi`, up to 2GB) in a fresh UUID job dir; `ffprobe` records duration/dimensions in `job.json`
2. **Analyze** — key frames extracted, Claude Vision returns overlay copy, and a timeline generator produces timed overlay/caption entries
3. **(Optional) Music** — custom MP3 upload per job, or the bundled default track; beats detected and cut points snapped
4. **Render** — Sharp renders text overlays/captions as PNGs; fluent-ffmpeg composites intro, overlays, captions, and mixed audio; progress streamed via SSE
5. **Download** — `GET /api/download/:jobId` serves the final `*_gauntlet.mp4`

Notable engineering choices found in the code: overlay text is rendered as Sharp-generated PNG frames and composited with FFmpeg `overlay` (no drawtext dependency), timelines are editable via `PUT /api/timeline/:jobId` before render, and each pipeline stage persists state to `job.json` so jobs are resumable and inspectable.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | Node.js (CommonJS) |
| Framework | Express 4, Multer uploads, Server-Sent Events |
| AI | Anthropic SDK (Claude Vision frame analysis) |
| Video/Audio | FFmpeg + ffprobe (fluent-ffmpeg), Sharp for overlay rendering, yt-dlp for YouTube ingestion |
| Integrations | Pexels video search API |
| Storage | Local filesystem job dirs (`temp/<uuid>/`) |

## Getting Started

### Prerequisites

- Node.js 18+
- `ffmpeg` and `ffprobe` on `PATH`
- `yt-dlp` installed (path configured in `src/services/youtubeDownloader.js`)
- Anthropic API key; Pexels API key optional (stock-footage feature)

### Installation

```bash
git clone https://github.com/jjshay/music-videos-app.git
cd music-videos-app
npm install
```

Create a `.env` file in the project root with the variables below.

### Configuration

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic key for Claude Vision frame analysis |
| `PEXELS_API_KEY` | Pexels key for stock-footage search (optional) |
| `PORT` | Server port (default 3000) |

Never commit `.env` or real keys.

## Usage

```bash
npm run dev    # node --watch server.js
npm start      # production
```

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/upload` | POST | Upload a source clip; returns `jobId` |
| `/api/analyze/:jobId` | POST | Extract frames, run Claude Vision, build timeline |
| `/api/music/:jobId` | POST | Attach a custom MP3 to the job |
| `/api/timeline/:jobId` | PUT | Edit the generated timeline before render |
| `/api/render/:jobId` | POST | Composite final video (SSE progress stream) |
| `/api/music-video` | POST | Full multi-clip music-video pipeline (artist/guitar clips, YouTube, Pexels) |
| `/api/download/:jobId` | GET | Download the rendered `*_gauntlet.mp4` |

Web UIs: `public/index.html` (product overlay flow) and `public/music-video.html` (music-video flow).

## Project Structure

```
music-videos-app/
├── server.js                     # Express app, download/music/timeline endpoints
├── src/
│   ├── config/brand.js           # Gauntlet Gallery colors, fonts, intro/outro config
│   ├── routes/                   # upload, analyze, render, music-video handlers
│   └── services/
│       ├── claudeVision.js       # Claude Vision frame analysis
│       ├── beatDetector.js       # FFmpeg RMS beat detection + snap-to-beat
│       ├── captionRenderer.js    # Timed caption/intro/outro/thumbnail rendering
│       ├── musicVideoCompositor.js # Crossfade concat, audio mix, aspect exports
│       ├── overlayRenderer.js    # Sharp PNG overlay generation
│       ├── youtubeDownloader.js  # yt-dlp download + trim
│       ├── pexelsClient.js       # Stock footage search/fetch
│       └── editHistory.js        # Style-guide learning from accepted edits
└── public/                       # Browser UIs (product + music-video flows)
```

## Related Projects

- [ebayshare](https://github.com/jjshay/ebayshare) — photo → Claude vision → SEO eBay listing → Drive + Sheets
- [gauntlet-coa](https://github.com/jjshay/gauntlet-coa) — Web3 certificate-of-authenticity verification on Polygon
- [truecoa](https://github.com/jjshay/truecoa) — TrueCOA blockchain COA platform
- [gauntlet-gallery-web](https://github.com/jjshay/gauntlet-gallery-web) — Gauntlet Gallery web presence
