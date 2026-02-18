module.exports = {
  colors: {
    darkNavy: '#1a3a6b',
    gold: '#c9a227',
    white: '#FFFFFF',
    linkedInBlue: '#0A66C2',
  },

  fonts: {
    heading: 'Didot',
    body: 'Futura',
    accent: 'Baskerville',
  },

  intro: {
    duration: 4,
    fadeDuration: 1,
    text: 'AVAILABLE AT GAUNTLET GALLERY',
  },

  watermark: {
    text: 'GAUNTLET GALLERY',
    position: 'top-right',
    fontSize: 28,
    opacity: 0.6,
  },

  calloutDefaults: [
    { time: 6, duration: 4, field: 'frame_description', fallback: 'Antique Hand-Crafted Frame' },
    { time: 12, duration: 4, field: 'signature_detail', fallback: 'Hand Signed Limited Edition' },
    { time: 18, duration: 4, field: 'color_description', fallback: 'Vivid Color Palette' },
    { time: 24, duration: 4, field: null, fallback: "Editor's Curation \u2022 Unique" },
    { time: 30, duration: 4, field: 'artwork_subject', fallback: 'Contemporary Pop Art' },
    { time: 36, duration: 4, field: 'edition_detail', fallback: 'Numbered \u2022 Certificate of Authenticity' },
  ],

  output: {
    width: 1080,
    height: 1920,
    maxDuration: 60,
  },

  music: {
    defaultVolume: 0.5,
    fadeInDuration: 1,
    fadeOutDuration: 2,
  },

  musicVideo: {
    introDuration: 3,
    outroDuration: 4,
    outroDefaultText: 'BROWSE THE FULL COLLECTION\nAUTHENTICATED GUITARS\nGAUNTLET GALLERY',
    defaultSegmentDuration: 10,
    totalDuration: 30,
    segments: 3,
    transitionDuration: 0.5,
    pexelsDefaultQuery: 'concert crowd cheering',
    captionFontSize: 55,
    captionFont: 'Futura Bold',
    captionStroke: 3,
    captionPositionY: 0.72,
    captionFadeIn: 0.3,
    captionFadeOut: 0.3,
    reviewEnabled: true,
    reviewMaxRetries: 1,
    reviewFrameMargin: 0.3,
  },
};
