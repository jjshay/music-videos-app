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
    defaultVolume: 0.85,
    fadeInDuration: 1,
    fadeOutDuration: 3,
  },

  musicVideo: {
    introDuration: 3,
    outroDuration: 6,
    outroDefaultText: 'SEE MORE GUITARS\nSEE MORE SIGNED MUSICAL ITEMS\nGAUNTLET GALLERY',
    outroTransition: 'dissolve',
    outroTransitionDuration: 1.5,
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

    // Feature 1: Beat-Synced Transitions
    beatSyncEnabled: true,
    beatSyncMaxShift: 0.5,

    // Feature 2: Ken Burns Effect
    kenBurnsEnabled: true,
    kenBurnsZoomRate: 0.0015,
    kenBurnsMaxZoom: 1.5,

    // Feature 3: Color Grade Matching
    colorGradeEnabled: true,
    colorGradeDefaults: { brightness: 0.02, contrast: 1.05, saturation: 1.1 },

    // Feature 4: Caption Animations
    captionAnimations: true,
    captionDefaultAnimation: 'fadeSlide',
    captionSlideDistance: 100,
    captionAnimDuration: 0.4,

    // Feature 5: Speed Ramping
    speedRampEnabled: true,
    speedRampMin: 0.7,
    speedRampMax: 1.3,

    // Feature 6: Quick Preview
    preview: { width: 540, height: 960, crf: 28, preset: 'ultrafast' },

    // Feature 7: Multiple Aspect Ratios
    aspectRatios: {
      '9:16': { width: 1080, height: 1920, label: 'Vertical (9:16)' },
      '1:1': { width: 1080, height: 1080, label: 'Square (1:1)', crop: 'crop=1080:1080:0:420' },
      '16:9': { width: 1920, height: 1080, label: 'Landscape (16:9)' },
    },

    // Feature 8: Auto-Thumbnail
    thumbnailEnabled: true,

    // Feature 9: Fit Mode (per clip type)
    guitarFitMode: 'fit',   // 'fit' = scale+pad (shows full frame), 'crop' = center-crop to 9:16
    artistFitMode: 'crop',
    crowdFitMode: 'crop',
    fitPadColor: '#1a3a6b', // dark navy brand color for fit-mode padding
  },
};
