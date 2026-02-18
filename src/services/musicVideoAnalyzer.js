const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const brand = require('../config/brand');

let client = null;
function getClient() {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

/**
 * Extract evenly-spaced key frames from a video clip.
 */
function extractFrames(videoPath, outputDir, duration, count = 5, prefix = 'frame') {
  return new Promise((resolve, reject) => {
    const interval = duration / (count + 1);
    const results = [];
    let completed = 0;

    for (let i = 1; i <= count; i++) {
      const ts = Math.round(interval * i);
      const outputFile = path.join(outputDir, `${prefix}_${i}.jpg`);

      ffmpeg(videoPath)
        .seekInput(ts)
        .frames(1)
        .output(outputFile)
        .outputOptions(['-q:v', '2'])
        .on('end', () => {
          results.push({ path: outputFile, timestamp: ts, index: i });
          completed++;
          if (completed === count) {
            results.sort((a, b) => a.index - b.index);
            resolve(results);
          }
        })
        .on('error', (err) => reject(err))
        .run();
    }
  });
}

/**
 * Analyze clips with Claude Vision.
 *
 * The artist clip is the primary source — it contains both the performance
 * video AND the audio (the song). Claude analyzes frames to determine:
 * - Best trim points for each segment
 * - The mood/genre of the performance (acoustic, rock, punk, pop, etc.)
 * - A Pexels search query for matching crowd footage
 * - Captions and transitions
 *
 * @param {object} job - Job data with paths and info for all clips
 * @param {string} framesDir - Directory to save extracted frames
 * @param {function} onProgress - Progress callback
 * @returns {object} AI analysis results
 */
async function analyzeClips(job, framesDir, onProgress) {
  fs.mkdirSync(framesDir, { recursive: true });

  if (onProgress) onProgress('Extracting frames from artist clip...');
  const artistFrames = await extractFrames(
    job.artistPath, framesDir, job.artistInfo.duration, 5, 'artist'
  );

  if (onProgress) onProgress('Extracting frames from guitar clip...');
  const guitarFrames = await extractFrames(
    job.guitarPath, framesDir, job.guitarInfo.duration, 5, 'guitar'
  );

  let crowdFrames = [];
  if (job.crowdPath && job.crowdInfo) {
    if (onProgress) onProgress('Extracting frames from crowd clip...');
    crowdFrames = await extractFrames(
      job.crowdPath, framesDir, job.crowdInfo.duration, 5, 'crowd'
    );
  }

  if (onProgress) onProgress('Analyzing clips with Claude Vision...');

  // Build image content — label each set
  const imageContent = [];

  imageContent.push({ type: 'text', text: '--- ARTIST PERFORMANCE CLIP (this clip contains the AUDIO/SONG that plays for the entire video) ---' });
  for (const frame of artistFrames) {
    const data = fs.readFileSync(frame.path).toString('base64');
    imageContent.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data },
    });
    imageContent.push({
      type: 'text',
      text: `Artist clip — frame at ${frame.timestamp}s (clip duration: ${Math.round(job.artistInfo.duration)}s, has audio: ${job.artistInfo.hasAudio})`,
    });
  }

  imageContent.push({ type: 'text', text: '--- GUITAR CLOSE-UP CLIP (the product being sold — guitar for sale on eBay) ---' });
  for (const frame of guitarFrames) {
    const data = fs.readFileSync(frame.path).toString('base64');
    imageContent.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data },
    });
    imageContent.push({
      type: 'text',
      text: `Guitar clip — frame at ${frame.timestamp}s (clip duration: ${Math.round(job.guitarInfo.duration)}s)`,
    });
  }

  if (crowdFrames.length > 0) {
    imageContent.push({ type: 'text', text: '--- CROWD/AUDIENCE CLIP (already uploaded by user) ---' });
    for (const frame of crowdFrames) {
      const data = fs.readFileSync(frame.path).toString('base64');
      imageContent.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data },
      });
      imageContent.push({
        type: 'text',
        text: `Crowd clip — frame at ${frame.timestamp}s (clip duration: ${Math.round(job.crowdInfo.duration)}s)`,
      });
    }
  }

  const artistName = job.artistName || 'the artist';
  const totalTarget = brand.musicVideo.totalDuration;
  const transitionDur = brand.musicVideo.transitionDuration;
  const introDur = brand.musicVideo.introDuration;
  const hasCrowdAlready = crowdFrames.length > 0;

  const prompt = {
    type: 'text',
    text: `You are a professional music video editor creating a ~30-second vertical (9:16) promo video for Gauntlet Gallery on eBay. The video promotes a guitar for sale by showing an artist playing it.

VIDEO STRUCTURE:
1. Intro card (${introDur}s) — "Brought to you by Gauntlet Gallery" (we handle this automatically)
2. Artist performing segment — shows the artist playing the song on the guitar
3. Guitar close-up segment — shows the actual guitar being sold, spinning/rotating
4. Crowd/audience segment — stock footage matching the song's mood

CRITICAL: The artist clip's AUDIO is the soundtrack for the ENTIRE video. The song plays continuously from the intro through all segments. So you need to identify the mood/genre of the music being performed.

Analyze these frames and return a JSON object:

{
  "mood": {
    "genre": "<acoustic/rock/punk/pop/blues/classical/country/folk/jazz>",
    "energy": "<low/medium/high>",
    "description": "<one sentence describing the vibe, e.g. 'Intimate acoustic performance with soft fingerpicking'>",
    "pexelsQuery": "<Pexels video search query for matching crowd footage>"
  },
  "segments": [
    {
      "clipType": "artist",
      "startTime": <seconds into the ORIGINAL clip to start — pick the most dynamic moment>,
      "duration": <seconds for this segment>,
      "caption": "<bold TikTok-style caption, all caps, 2-6 words>",
      "captionReason": "<why>",
      "trimReason": "<why this start point — what's visually compelling>"
    },
    {
      "clipType": "guitar",
      "startTime": <number>,
      "duration": <number>,
      "caption": "<caption about the guitar being sold, e.g. 'PLAY LIKE THE PROS', 'HANDCRAFTED TONE'>",
      "captionReason": "<why>",
      "trimReason": "<why>"
    },
    {
      "clipType": "crowd",
      "startTime": <number>,
      "duration": <number>,
      "caption": "<caption matching the energy, e.g. 'FEEL THE ENERGY' or 'PURE ACOUSTIC BLISS'>",
      "captionReason": "<why>",
      "trimReason": "<why>"
    }
  ],
  "segmentOrder": ["artist", "guitar", "crowd"],
  "orderReason": "<why this order tells the best story>",
  "transitions": [
    { "from": "artist", "to": "guitar", "type": "<fade|dissolve|wipeleft|wiperight|slideup|slidedown|smoothleft|smoothright>", "reason": "<why>" },
    { "from": "guitar", "to": "crowd", "type": "<type from same set>", "reason": "<why>" }
  ],
  "overallNotes": "<brief creative direction — mood, pacing, energy>",
  "suggestedArtistName": "<if visible in frames, otherwise null>",
  "guitarType": "<acoustic/electric/classical/bass — what type of guitar is being sold>",
  "outro": {
    "line1": "<CTA — short punchy call to action, e.g. 'BROWSE THE FULL COLLECTION'>",
    "line2": "<guitar-type-specific, e.g. 'SIGNED & AUTHENTICATED ACOUSTICS' or 'VERIFIED ELECTRIC GUITARS'>",
    "line3": "GAUNTLET GALLERY",
    "line4": "<optional tagline or empty string>"
  }
}

MOOD → PEXELS QUERY EXAMPLES:
- Acoustic/folk/soft → "intimate concert audience candlelight" or "acoustic guitar audience small venue"
- Pop/dance/upbeat → "concert crowd dancing cheering" or "music festival happy audience"
- Rock/punk/high energy → "rock concert stadium crowd" or "outdoor music festival large crowd moshing"
- Blues/jazz/mellow → "jazz club audience" or "blues bar crowd enjoying music"
- Classical → "orchestra audience concert hall" or "classical music audience applause"

RULES:
- The 3 segment durations must total ~${totalTarget + (2 * transitionDur)}s raw (crossfades overlap by ${transitionDur}s each, so ~${totalTarget}s visual)
- The ${introDur}s intro is added before these segments (we handle it, don't include in durations)
- Each segment: min 7s, max 16s
- startTime + duration must not exceed clip length
- Pick the MOST DYNAMIC start points
- Artist clip: expressive playing, well-lit, good energy
- Guitar clip: clear product shot, detail, spinning if available
- Captions: bold, punchy, sell-the-guitar energy
- guitarType: identify from the guitar close-up frames (acoustic, electric, classical, bass)
- outro: CTA card at the end. line2 should reference the guitar type specifically:
  - Acoustic → "SIGNED & AUTHENTICATED ACOUSTICS"
  - Electric → "AUTHENTICATED ELECTRIC GUITARS"
  - Classical → "HANDCRAFTED CLASSICAL GUITARS"
  - Generic → "AUTHENTICATED GUITARS"
- outro.line1: punchy CTA like "BROWSE THE FULL COLLECTION" or "SHOP SIGNED GUITARS" or "FIND YOUR SOUND"
- Transitions: choose ONLY from the professional set: fade, dissolve, wipeleft, wiperight, slideup, slidedown, smoothleft, smoothright. Prefer fade/dissolve for mood changes; directional wipes when content flows in a direction.
- outro.line3: always "GAUNTLET GALLERY"
- outro.line4: optional short tagline (or empty string)${!hasCrowdAlready ? '\n- No crowd clip uploaded yet — we will fetch from Pexels using your pexelsQuery. Use startTime: 0 and duration: 10 for crowd.' : ''}

Return ONLY the JSON object, no markdown.`,
  };

  const response = await getClient().messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: [...imageContent, prompt],
      },
    ],
  });

  const text = response.content[0].text.trim();
  const jsonStr = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
  const analysis = JSON.parse(jsonStr);

  // Validate and clamp start times
  const clipInfoMap = {
    artist: job.artistInfo,
    guitar: job.guitarInfo,
    crowd: job.crowdInfo || { duration: 30 },
  };

  for (const seg of analysis.segments) {
    const info = clipInfoMap[seg.clipType];
    if (info) {
      if (seg.startTime + seg.duration > info.duration) {
        seg.startTime = Math.max(0, info.duration - seg.duration);
      }
      seg.startTime = Math.max(0, seg.startTime);
    }
  }

  return analysis;
}

/**
 * Extract a single frame at a precise timestamp.
 *
 * @param {string} videoPath - Source video
 * @param {number} timestamp - Seconds into video
 * @param {string} outputFile - Output JPEG path
 */
function extractSingleFrame(videoPath, timestamp, outputFile) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(timestamp)
      .frames(1)
      .output(outputFile)
      .outputOptions(['-q:v', '2'])
      .on('end', () => resolve(outputFile))
      .on('error', (err) => reject(err))
      .run();
  });
}

/**
 * Extract frames at each transition boundary in the concatenated video.
 * Uses the same xfade offset math as concatenateWithCrossfade().
 *
 * For each transition, extracts 3 frames:
 *   - margin seconds before the midpoint
 *   - at the midpoint
 *   - margin seconds after the midpoint
 *
 * @param {string} concatPath - Path to concat.mp4
 * @param {Array<number>} segmentDurations - Duration of each segment (including intro/outro)
 * @param {number} td - Transition duration (crossfade overlap)
 * @param {string} outputDir - Directory to save extracted frames
 * @returns {Array<{transitionIndex, frames: Array<{path, timestamp, label}>}>}
 */
async function extractTransitionFrames(concatPath, segmentDurations, td, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });

  const margin = brand.musicVideo.reviewFrameMargin || 0.3;
  const results = [];
  let cumulativeTime = 0;

  const numTransitions = segmentDurations.length - 1;

  for (let i = 0; i < numTransitions; i++) {
    cumulativeTime += segmentDurations[i];
    const offset = cumulativeTime - (i + 1) * td;
    const midpoint = offset + td / 2;

    const frameTimes = [
      { ts: Math.max(0, midpoint - margin), label: 'before' },
      { ts: midpoint, label: 'mid' },
      { ts: midpoint + margin, label: 'after' },
    ];

    const frames = [];
    for (const { ts, label } of frameTimes) {
      const filename = `review_t${i}_${label}.jpg`;
      const outPath = path.join(outputDir, filename);
      try {
        await extractSingleFrame(concatPath, ts, outPath);
        frames.push({ path: outPath, timestamp: ts, label });
      } catch (err) {
        console.warn(`Failed to extract review frame t${i}_${label} at ${ts}s:`, err.message);
      }
    }

    results.push({ transitionIndex: i, frames });
  }

  return results;
}

/**
 * Send transition-boundary frames to Claude Vision for QA review.
 *
 * @param {Array} transitionFrameData - Output of extractTransitionFrames()
 * @param {Array<string>} transitionTypes - Transition type used at each cut
 * @param {Array<string>} segmentLabels - Label for each segment (e.g. ['intro','artist','guitar','crowd','outro'])
 * @param {string} mood - Mood description from initial analysis
 * @returns {{ approved: boolean, overallQuality: string, transitions: Array<{index, quality, issue, suggestedType}> }}
 */
async function reviewConcatenation(transitionFrameData, transitionTypes, segmentLabels, mood) {
  const imageContent = [];

  for (const td of transitionFrameData) {
    const i = td.transitionIndex;
    const fromLabel = segmentLabels[i] || `segment ${i}`;
    const toLabel = segmentLabels[i + 1] || `segment ${i + 1}`;
    const transType = transitionTypes[i] || 'fade';

    imageContent.push({
      type: 'text',
      text: `--- TRANSITION ${i + 1}: ${fromLabel} → ${toLabel} (type: ${transType}) ---`,
    });

    for (const frame of td.frames) {
      if (!fs.existsSync(frame.path)) continue;
      const data = fs.readFileSync(frame.path).toString('base64');
      imageContent.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data },
      });
      imageContent.push({
        type: 'text',
        text: `Frame: ${frame.label} (${frame.timestamp.toFixed(2)}s)`,
      });
    }
  }

  const prompt = {
    type: 'text',
    text: `You are a professional video QA reviewer. Evaluate each transition in this rendered music video.

VIDEO MOOD: ${mood || 'unknown'}

For each transition, examine the 3 frames (before, midpoint, after) and assess:
1. Does the transition look smooth and professional?
2. Are there any visual artifacts, jarring cuts, or mismatched content?
3. Would a different transition type work better?

AVAILABLE TRANSITIONS: fade, dissolve, wipeleft, wiperight, slideup, slidedown, smoothleft, smoothright

Return ONLY a JSON object:
{
  "approved": <true if ALL transitions look good, false if ANY need fixing>,
  "overallQuality": "<excellent|good|acceptable|poor>",
  "transitions": [
    {
      "index": <0-based>,
      "quality": "<smooth|acceptable|jarring>",
      "issue": "<description of problem, or null if smooth>",
      "suggestedType": "<recommended transition type, or null if current is fine>"
    }
  ]
}

Return ONLY the JSON, no markdown.`,
  };

  const response = await getClient().messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [...imageContent, prompt],
      },
    ],
  });

  const text = response.content[0].text.trim();
  const jsonStr = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
  return JSON.parse(jsonStr);
}

module.exports = { analyzeClips, extractFrames, extractTransitionFrames, reviewConcatenation };
