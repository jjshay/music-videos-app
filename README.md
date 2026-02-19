# Music Video Creator

AI-powered music video rendering pipeline for Gauntlet Gallery. Upload art listing videos, and the system auto-generates professional text overlays, beat-synced captions, and composite renders.

## Features

- **Claude Vision analysis** — Analyzes video frames to generate contextual overlay text
- **Beat detection** — Syncs visual transitions to audio beats
- **Caption rendering** — Auto-generated, timed captions with style controls
- **Video compositing** — Layers overlays, captions, and effects via FFmpeg
- **Timeline generation** — Automatic edit timeline from music + video analysis
- **Pexels integration** — Pull supplemental stock footage by keyword

## Tech Stack

- **Backend:** Node.js, Express
- **AI:** Claude (Anthropic SDK) for vision analysis
- **Video:** FFmpeg (fluent-ffmpeg), Sharp for image processing
- **Storage:** Multer for file uploads

## Setup

```bash
npm install
cp .env.example .env  # Add your API keys
npm run dev
```

## API Routes

| Route | Description |
|-------|-------------|
| `/upload` | Upload video/audio files |
| `/analyze` | Claude Vision frame analysis |
| `/render` | Composite video rendering |
| `/music-video` | Full music video pipeline |

## Project Structure

```
src/
  routes/          # Express route handlers
  services/
    claudeVision.js         # AI frame analysis
    beatDetector.js          # Audio beat detection
    captionRenderer.js       # Timed caption generation
    musicVideoAnalyzer.js    # Music + video analysis
    musicVideoCompositor.js  # Final video compositing
    timelineGenerator.js     # Auto edit timeline
    pexelsClient.js          # Stock footage API
public/
  index.html               # Upload & control UI
  music-video.html         # Music video builder UI
```
