const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const { getStyleGuide } = require('./editHistory');

let client = null;
function getClient() {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

async function analyzeFrames(framePaths) {
  const imageContent = framePaths.map((fp) => {
    const data = fs.readFileSync(fp);
    const base64 = data.toString('base64');
    const ext = path.extname(fp).toLowerCase();
    const mediaType = ext === '.png' ? 'image/png' : 'image/jpeg';
    return {
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: base64 },
    };
  });

  // Build style guide from past user edits
  const styleGuide = getStyleGuide();
  const styleSection = styleGuide ? `\n\n${styleGuide}` : '';

  const prompt = {
    type: 'text',
    text: `You are analyzing frames from a slow-pan video of a Death NYC limited edition pop art print displayed in an antique frame. This is for an eBay art listing by Gauntlet Gallery.

Analyze these frames and return a JSON object with these fields:

{
  "artwork_subject": "Brief description of the artwork subject (e.g., 'Snoopy in a space suit against a starfield backdrop')",
  "color_palette": ["list", "of", "dominant", "colors"],
  "color_description": "A short poetic description of the color palette for display (e.g., 'Bold primaries with metallic gold accents')",
  "frame_description": "Description of the physical frame (e.g., 'Ornate gilded antique frame with carved corners')",
  "frame_era": "Estimated era of the frame (e.g., 'Early 1900s Victorian')",
  "is_signed": true/false,
  "signature_detail": "Description of signature if visible (e.g., 'Hand signed by Death NYC in pencil, lower right')",
  "is_numbered": true/false,
  "edition_detail": "Edition info if visible (e.g., 'Numbered 12/100')",
  "has_coa": true/false,
  "notable_details": ["Any", "notable", "visual", "details"],
  "suggested_callouts": ["Short punchy phrases suitable for video overlays"]
}${styleSection}

Return ONLY the JSON object, no markdown formatting or extra text.`,
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

  // Parse JSON, stripping any markdown fences if present
  const jsonStr = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
  return JSON.parse(jsonStr);
}

module.exports = { analyzeFrames };
