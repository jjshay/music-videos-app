(function () {
  let jobId = null;
  let aiAnalysis = null;

  // Files collected before upload
  const files = { artistClip: null, guitarClip: null, crowdClip: null };

  // YouTube state for artist + guitar clips
  const youtubeState = {
    artist: { mode: 'file', downloaded: false, jobId: null, videoInfo: null },
    guitar: { mode: 'file', downloaded: false, jobId: null, videoInfo: null },
  };

  // DOM refs
  const dropZones = {
    artistClip: document.getElementById('drop-artist'),
    guitarClip: document.getElementById('drop-guitar'),
    crowdClip: document.getElementById('drop-crowd'),
  };

  const useCustomCrowd = document.getElementById('use-custom-crowd');
  const crowdUploadArea = document.getElementById('crowd-upload-area');
  const artistNameInput = document.getElementById('artist-name');

  const btnUpload = document.getElementById('btn-upload');
  const uploadProgress = document.getElementById('upload-progress');
  const uploadStatus = document.getElementById('upload-status');

  // Step 2 — AI Analysis
  const stepAnalyze = document.getElementById('step-analyze');
  const analyzeStatus = document.getElementById('analyze-status');
  const aiNotesEl = document.getElementById('ai-notes');
  const segmentEditor = document.getElementById('segment-editor');
  const outroEditor = document.getElementById('outro-editor');
  const durationTotal = document.getElementById('duration-total');
  const exportOptions = document.getElementById('export-options');
  const btnPreview = document.getElementById('btn-preview');
  const btnRender = document.getElementById('btn-render');

  // Preview section
  const stepPreview = document.getElementById('step-preview');
  const previewProgress = document.getElementById('preview-progress');
  const previewStatusText = document.getElementById('preview-status-text');
  const previewPlayerContainer = document.getElementById('preview-player-container');
  const previewPlayer = document.getElementById('preview-player');

  // Step 3 — Render
  const stepRender = document.getElementById('step-render');
  const renderStatusText = document.getElementById('render-status-text');
  const downloadSection = document.getElementById('download-section');
  const downloadLinks = document.getElementById('download-links');
  const downloadLink = document.getElementById('download-link');
  const thumbnailSection = document.getElementById('thumbnail-section');
  const thumbnailPreview = document.getElementById('thumbnail-preview');
  const thumbnailDownload = document.getElementById('thumbnail-download');

  const TRANSITIONS = [
    'fade', 'dissolve', 'wipeleft', 'wiperight',
    'slideup', 'slidedown', 'smoothleft', 'smoothright',
    'wipeup', 'wipedown', 'slideleft', 'slideright', 'pixelize',
  ];

  const FIT_MODES = [
    { value: 'crop', label: 'Crop to Fill' },
    { value: 'fit', label: 'Fit (show full)' },
  ];

  const DEFAULT_FIT_MODES = {
    artist: 'crop',
    guitar: 'fit',
    crowd: 'crop',
  };

  const CAPTION_ANIMATIONS = [
    { value: 'fade', label: 'Fade' },
    { value: 'slideUp', label: 'Slide Up' },
    { value: 'slideDown', label: 'Slide Down' },
    { value: 'fadeSlide', label: 'Fade + Slide' },
    { value: 'scaleBounce', label: 'Scale Bounce' },
  ];

  // === YouTube URL validation (client-side) ===
  function isValidYouTubeUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=[\w-]+|youtu\.be\/[\w-]+|youtube\.com\/shorts\/[\w-]+)/.test(url);
  }

  // === Source toggle wiring ===
  document.querySelectorAll('.clip-source-container').forEach((container) => {
    const clip = container.dataset.clip; // 'artist' or 'guitar'
    const radios = container.querySelectorAll('input[type="radio"]');
    const fileMode = container.querySelector('.file-mode');
    const ytMode = container.querySelector('.youtube-mode');
    const ytUrlInput = container.querySelector('.yt-url');

    radios.forEach((radio) => {
      radio.addEventListener('change', () => {
        const mode = radio.value;
        youtubeState[clip].mode = mode;
        fileMode.hidden = (mode !== 'file');
        ytMode.hidden = (mode !== 'youtube');
        // Reset youtube downloaded state when switching back to file
        if (mode === 'file') {
          youtubeState[clip].downloaded = false;
          youtubeState[clip].videoInfo = null;
          const statusEl = container.querySelector('.yt-status');
          if (statusEl) { statusEl.textContent = ''; statusEl.className = 'yt-status'; }
        }
        checkUploadReady();
      });
    });

    // Re-check readiness when URL changes
    if (ytUrlInput) {
      ytUrlInput.addEventListener('input', () => checkUploadReady());
    }
  });

  // === Drop zone setup ===
  Object.entries(dropZones).forEach(([field, zone]) => {
    if (!zone) return;
    const fileInput = zone.querySelector('input[type="file"]');
    const fileNameEl = zone.querySelector('.file-name');

    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      if (e.dataTransfer.files[0]) setFile(field, e.dataTransfer.files[0], zone, fileNameEl);
    });
    zone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) setFile(field, fileInput.files[0], zone, fileNameEl);
    });
  });

  function setFile(field, file, zone, nameEl) {
    files[field] = file;
    zone.classList.add('has-file');
    nameEl.textContent = file.name;
    checkUploadReady();
  }

  useCustomCrowd.addEventListener('change', () => {
    crowdUploadArea.hidden = !useCustomCrowd.checked;
    if (!useCustomCrowd.checked) {
      files.crowdClip = null;
      const zone = dropZones.crowdClip;
      zone.classList.remove('has-file');
      zone.querySelector('.file-name').textContent = '';
    }
    checkUploadReady();
  });

  function checkUploadReady() {
    // Artist ready: file mode + file selected, OR youtube mode + valid URL
    const artistReady = youtubeState.artist.mode === 'file'
      ? !!files.artistClip
      : isValidYouTubeUrl(document.querySelector('.yt-url[data-clip="artist"]')?.value);

    // Guitar ready: same logic
    const guitarReady = youtubeState.guitar.mode === 'file'
      ? !!files.guitarClip
      : isValidYouTubeUrl(document.querySelector('.yt-url[data-clip="guitar"]')?.value);

    const needsCrowd = useCustomCrowd.checked;
    const hasCrowd = !needsCrowd || files.crowdClip;
    btnUpload.disabled = !(artistReady && guitarReady && hasCrowd);
  }

  // === YouTube SSE download ===
  function downloadYouTubeClip(url, clipType, startTime, endTime, existingJobId, onProgress) {
    return new Promise((resolve, reject) => {
      const body = { url, clipType };
      if (startTime) body.startTime = parseFloat(startTime);
      if (endTime) body.endTime = parseFloat(endTime);
      if (existingJobId) body.jobId = existingJobId;

      fetch('/api/music-video/youtube-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((response) => {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        function read() {
          reader.read().then(({ done, value }) => {
            if (done) {
              reject(new Error('Stream ended without completion'));
              return;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            let currentEvent = null;
            for (const line of lines) {
              if (line.startsWith('event: ')) {
                currentEvent = line.slice(7);
              } else if (line.startsWith('data: ') && currentEvent) {
                const data = JSON.parse(line.slice(6));
                if (currentEvent === 'progress') {
                  if (onProgress) onProgress(data);
                } else if (currentEvent === 'complete') {
                  resolve(data);
                  return;
                } else if (currentEvent === 'error') {
                  reject(new Error(data.message));
                  return;
                }
                currentEvent = null;
              }
            }
            read();
          }).catch(reject);
        }
        read();
      }).catch(reject);
    });
  }

  // === Reusable FormData upload (extracted from original XHR logic) ===
  function uploadFormData(formData, url, fill, text) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          fill.style.width = pct + '%';
          text.textContent = `Uploading files... ${pct}%`;
        }
      };

      xhr.onload = () => {
        if (xhr.status === 200) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          try {
            const err = JSON.parse(xhr.responseText);
            reject(new Error(err.error));
          } catch { reject(new Error('Upload failed')); }
        }
      };

      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(formData);
    });
  }

  // === Upload → Analyze → Fetch Crowd (two-phase pipeline) ===
  btnUpload.addEventListener('click', async () => {
    btnUpload.disabled = true;
    uploadProgress.hidden = false;
    uploadStatus.hidden = true;
    const fill = uploadProgress.querySelector('.progress-fill');
    const text = uploadProgress.querySelector('.progress-text');

    try {
      // === Phase 1: YouTube downloads (sequential, for each clip in youtube mode) ===
      const ytClips = ['artist', 'guitar'].filter((c) => youtubeState[c].mode === 'youtube');

      if (ytClips.length > 0) {
        for (const clip of ytClips) {
          const container = document.querySelector(`.clip-source-container[data-clip="${clip}"]`);
          const urlInput = container.querySelector('.yt-url');
          const startInput = container.querySelector('.yt-start');
          const endInput = container.querySelector('.yt-end');
          const statusEl = container.querySelector('.yt-status');

          const ytUrl = urlInput.value.trim();
          const startTime = startInput.value || null;
          const endTime = endInput.value || null;

          statusEl.className = 'yt-status downloading';
          statusEl.textContent = `Downloading ${clip}...`;
          fill.style.width = '0%';
          text.textContent = `Downloading ${clip} from YouTube...`;

          const result = await downloadYouTubeClip(ytUrl, clip, startTime, endTime, jobId, (data) => {
            const pct = data.percent || 0;
            fill.style.width = pct + '%';
            text.textContent = data.message || `Downloading ${clip}: ${Math.round(pct)}%`;
            statusEl.textContent = data.message || `${Math.round(pct)}%`;
          });

          // Store result
          jobId = result.jobId;
          youtubeState[clip].downloaded = true;
          youtubeState[clip].jobId = result.jobId;
          youtubeState[clip].videoInfo = result.videoInfo;

          statusEl.className = 'yt-status ready';
          statusEl.textContent = `Ready: ${result.title || clip}`;
        }

        fill.style.width = '100%';
        text.textContent = 'YouTube downloads complete';
      }

      // === Phase 2: File uploads for file-mode clips ===
      const fileClips = ['artist', 'guitar'].filter((c) => youtubeState[c].mode === 'file');
      const hasFileUploads = fileClips.some((c) => {
        const fieldName = c === 'artist' ? 'artistClip' : 'guitarClip';
        return !!files[fieldName];
      });

      // Build FormData with only file-mode clips
      const formData = new FormData();
      for (const clip of fileClips) {
        const fieldName = clip === 'artist' ? 'artistClip' : 'guitarClip';
        if (files[fieldName]) formData.append(fieldName, files[fieldName]);
      }
      if (files.crowdClip) formData.append('crowdClip', files.crowdClip);

      // Determine upload URL (pass jobId if we have one from YouTube phase)
      const uploadUrl = jobId
        ? `/api/music-video/upload?jobId=${encodeURIComponent(jobId)}`
        : '/api/music-video/upload';

      if (hasFileUploads || !jobId) {
        // Need to upload files or create job
        text.textContent = 'Uploading files...';
        fill.style.width = '0%';
        const data = await uploadFormData(formData, uploadUrl, fill, text);
        jobId = data.jobId;
        fill.style.width = '100%';
        text.textContent = 'Upload complete';

        stepAnalyze.hidden = false;
        await runAnalysisPipeline(data);
      } else {
        // All clips from YouTube — still POST to /upload to trigger job.json creation
        text.textContent = 'Finalizing job...';
        fill.style.width = '50%';
        const data = await uploadFormData(formData, uploadUrl, fill, text);
        jobId = data.jobId;
        fill.style.width = '100%';
        text.textContent = 'Upload complete';

        stepAnalyze.hidden = false;
        await runAnalysisPipeline(data);
      }
    } catch (err) {
      showUploadError(err.message || 'Upload failed');
    }
  });

  function showUploadError(msg) {
    uploadStatus.hidden = false;
    uploadStatus.className = 'status-message error';
    uploadStatus.textContent = msg;
    btnUpload.disabled = false;
  }

  /**
   * Full pipeline after upload:
   * 1. Analyze clips with Claude Vision (mood, trim points, captions, effects)
   * 2. Fetch crowd footage from Pexels using AI-suggested mood query
   */
  async function runAnalysisPipeline(uploadData) {
    analyzeStatus.hidden = false;
    analyzeStatus.className = 'status-message loading';

    // Step 1: Claude Vision analysis
    analyzeStatus.textContent = 'Analyzing clips with Claude Vision (extracting frames, detecting mood)...';
    try {
      const res = await fetch(`/api/music-video/analyze/${jobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artistName: artistNameInput.value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      aiAnalysis = data.analysis;
      analyzeStatus.textContent = 'AI analysis complete. Fetching crowd footage...';
    } catch (err) {
      analyzeStatus.className = 'status-message error';
      analyzeStatus.textContent = 'Analysis error: ' + err.message;
      btnUpload.disabled = false;
      return;
    }

    // Step 2: Fetch crowd footage (unless user uploaded)
    if (!uploadData.hasCustomCrowd) {
      const aiQuery = aiAnalysis.mood ? aiAnalysis.mood.pexelsQuery : null;
      analyzeStatus.textContent = `Fetching crowd footage from Pexels: "${aiQuery || 'concert crowd'}"...`;

      try {
        const res = await fetch(`/api/music-video/fetch-crowd/${jobId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: aiQuery }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        analyzeStatus.textContent = 'Crowd footage ready';
      } catch (err) {
        analyzeStatus.className = 'status-message error';
        analyzeStatus.textContent = 'Pexels error: ' + err.message + '. Upload your own crowd clip.';
        btnUpload.disabled = false;
        return;
      }
    } else {
      // Custom crowd — just probe it
      try {
        await fetch(`/api/music-video/fetch-crowd/${jobId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
      } catch (err) { /* ignore probe errors for custom */ }
    }

    analyzeStatus.className = 'status-message success';
    analyzeStatus.textContent = 'AI analysis complete — review and adjust below';
    showAiResults(aiAnalysis);
  }

  // === Show AI results ===
  function showAiResults(analysis) {
    aiNotesEl.hidden = false;

    const mood = analysis.mood || {};
    let html = '';
    if (mood.genre) {
      html += `<strong>Detected Genre:</strong> ${escapeHtml(mood.genre)} (${escapeHtml(mood.energy || '')} energy)<br>`;
    }
    if (mood.description) {
      html += `<strong>Mood:</strong> ${escapeHtml(mood.description)}<br>`;
    }
    if (mood.pexelsQuery) {
      html += `<strong>Crowd Search:</strong> "${escapeHtml(mood.pexelsQuery)}"<br>`;
    }
    if (analysis.overallNotes) {
      html += `<strong>Creative Direction:</strong> ${escapeHtml(analysis.overallNotes)}<br>`;
    }
    if (analysis.orderReason) {
      html += `<strong>Segment Order:</strong> ${escapeHtml(analysis.orderReason)}<br>`;
    }
    if (analysis.suggestedArtistName && !artistNameInput.value) {
      artistNameInput.value = analysis.suggestedArtistName;
      html += `<strong>Detected Artist:</strong> ${escapeHtml(analysis.suggestedArtistName)}`;
    }
    aiNotesEl.innerHTML = html;

    // Segment editor
    segmentEditor.hidden = false;
    segmentEditor.innerHTML = '';

    const segments = analysis.segments || [];
    const transitions = analysis.transitions || [];
    const aiKenBurns = analysis.kenBurns || {};
    const aiColorGrade = analysis.colorGrade || {};

    segments.forEach((seg, i) => {
      // Main row: label, caption, duration, seek, info
      const row = document.createElement('div');
      row.className = 'seg-row';
      row.dataset.index = i;
      row.innerHTML = `
        <span class="seg-label">${escapeHtml(seg.clipType)}</span>
        <input type="text" class="seg-caption" value="${escapeHtml(seg.caption)}" title="Caption text">
        <input type="number" class="seg-duration" value="${seg.duration}" min="7" max="16" step="1" title="Duration (s)">
        <input type="number" class="seg-seek" value="${seg.startTime}" min="0" step="0.5" title="Start at (s)">
        <span style="font-size:0.7rem; color:var(--gray-400);">seek ${seg.startTime}s</span>
      `;
      segmentEditor.appendChild(row);

      // Effects row: Ken Burns, color grade, speed, animation
      const clipKb = aiKenBurns[seg.clipType] || {};
      const clipCg = aiColorGrade[seg.clipType] || {};
      const effectsRow = document.createElement('div');
      effectsRow.className = 'seg-effects';
      effectsRow.dataset.index = i;

      // Ken Burns toggle + direction
      const kbChecked = clipKb.enabled ? 'checked' : '';
      const kbDir = clipKb.direction || 'in';

      // Caption animation dropdown
      const animOptions = CAPTION_ANIMATIONS.map((a) =>
        `<option value="${a.value}" ${a.value === (seg.captionAnimation || 'fadeSlide') ? 'selected' : ''}>${a.label}</option>`
      ).join('');

      // Speed slider
      const speed = seg.speedMultiplier || 1.0;

      // Fit mode dropdown
      const defaultFit = DEFAULT_FIT_MODES[seg.clipType] || 'crop';
      const fitOptions = FIT_MODES.map((f) =>
        `<option value="${f.value}" ${f.value === defaultFit ? 'selected' : ''}>${f.label}</option>`
      ).join('');

      effectsRow.innerHTML = `
        <label><input type="checkbox" class="kb-enabled" ${kbChecked}> Ken Burns</label>
        <select class="kb-direction" style="width:55px;">
          <option value="in" ${kbDir === 'in' ? 'selected' : ''}>Zoom In</option>
          <option value="out" ${kbDir === 'out' ? 'selected' : ''}>Zoom Out</option>
        </select>
        <label style="margin-left:0.5rem;">Display:</label>
        <select class="seg-fitmode" style="width:100px;">${fitOptions}</select>
        <label style="margin-left:0.5rem;">Anim:</label>
        <select class="seg-animation">${animOptions}</select>
        <label style="margin-left:0.5rem;">Speed:</label>
        <input type="range" class="seg-speed" min="0.7" max="1.3" step="0.05" value="${speed}">
        <span class="speed-val" style="font-size:0.7rem; color:var(--gray-300); min-width:30px;">${speed.toFixed(2)}x</span>
      `;
      segmentEditor.appendChild(effectsRow);

      // Wire up speed slider display
      const speedSlider = effectsRow.querySelector('.seg-speed');
      const speedVal = effectsRow.querySelector('.speed-val');
      speedSlider.addEventListener('input', () => {
        speedVal.textContent = parseFloat(speedSlider.value).toFixed(2) + 'x';
      });

      if (seg.trimReason) {
        const reason = document.createElement('div');
        reason.className = 'ai-reason';
        reason.style.paddingLeft = '2rem';
        reason.textContent = 'AI: ' + seg.trimReason;
        segmentEditor.appendChild(reason);
      }

      if (i < segments.length - 1 && transitions[i]) {
        const tRow = document.createElement('div');
        tRow.className = 'transition-row';
        tRow.dataset.transitionIndex = i;
        let options = TRANSITIONS.map((t) =>
          `<option value="${t}" ${t === (transitions[i].type || 'fade') ? 'selected' : ''}>${t}</option>`
        ).join('');
        tRow.innerHTML = `
          <span>Transition:</span>
          <select class="transition-type">${options}</select>
          <span style="font-size:0.68rem; color:var(--gray-600);">${escapeHtml(transitions[i].reason || '')}</span>
        `;
        segmentEditor.appendChild(tRow);
      }
    });

    // Outro CTA card editor
    if (analysis.outro || true) {
      outroEditor.hidden = false;
      const outro = analysis.outro || {};
      outroEditor.querySelector('#outro-line1').value = outro.line1 || 'BROWSE THE FULL COLLECTION';
      outroEditor.querySelector('#outro-line2').value = outro.line2 || 'AUTHENTICATED GUITARS';
      outroEditor.querySelector('#outro-line3').value = outro.line3 || 'GAUNTLET GALLERY';
      outroEditor.querySelector('#outro-line4').value = outro.line4 || '';
    }

    durationTotal.hidden = false;
    updateDurationTotal();
    segmentEditor.querySelectorAll('.seg-duration').forEach((input) => {
      input.addEventListener('input', updateDurationTotal);
    });

    exportOptions.hidden = false;
    btnPreview.hidden = false;
    btnRender.hidden = false;
  }

  function updateDurationTotal() {
    const inputs = segmentEditor.querySelectorAll('.seg-duration');
    let total = 0;
    inputs.forEach((inp) => { total += parseInt(inp.value) || 0; });
    // 3s intro + segments + 6s outro - overlaps (3x0.5s + 1x1.5s = 3s)
    const visual = 3 + total + 6 - 3;
    durationTotal.textContent = `Total: ~${Math.round(visual)}s (3s intro + ${total}s segments + 6s outro - 3s transitions)`;
    durationTotal.className = 'duration-total ' + (visual >= 30 && visual <= 45 ? 'ok' : 'over');
  }

  /**
   * Collect segments, transitions, and effects from the editor UI.
   */
  function collectEditorData() {
    const segRows = segmentEditor.querySelectorAll('.seg-row');
    const effectRows = segmentEditor.querySelectorAll('.seg-effects');
    const segments = [];
    const kenBurns = {};
    const colorGrade = {};

    segRows.forEach((row, idx) => {
      const i = parseInt(row.dataset.index);
      const origSeg = aiAnalysis.segments[i];
      const clipType = origSeg.clipType;

      // Effects from the effects row
      const effRow = effectRows[idx];
      const kbEnabled = effRow ? effRow.querySelector('.kb-enabled').checked : false;
      const kbDirection = effRow ? effRow.querySelector('.kb-direction').value : 'in';
      const captionAnimation = effRow ? effRow.querySelector('.seg-animation').value : 'fadeSlide';
      const speedMultiplier = effRow ? parseFloat(effRow.querySelector('.seg-speed').value) : 1.0;
      const fitMode = effRow ? effRow.querySelector('.seg-fitmode').value : (DEFAULT_FIT_MODES[clipType] || 'crop');

      segments.push({
        clipType,
        caption: row.querySelector('.seg-caption').value,
        duration: parseInt(row.querySelector('.seg-duration').value) || 10,
        seekTo: parseFloat(row.querySelector('.seg-seek').value) || 0,
        captionAnimation,
        speedMultiplier,
        fitMode,
      });

      kenBurns[clipType] = { enabled: kbEnabled, direction: kbDirection };

      // Color grade: use AI values (not editable in UI for simplicity)
      const aiCg = (aiAnalysis.colorGrade || {})[clipType];
      if (aiCg) {
        colorGrade[clipType] = aiCg;
      }
    });

    const transitionEls = segmentEditor.querySelectorAll('.transition-row');
    const transitions = [];
    transitionEls.forEach((tRow) => {
      transitions.push({ type: tRow.querySelector('.transition-type').value });
    });

    // Outro text
    const outroLines = [
      (outroEditor.querySelector('#outro-line1') || {}).value || 'BROWSE THE FULL COLLECTION',
      (outroEditor.querySelector('#outro-line2') || {}).value || 'AUTHENTICATED GUITARS',
      (outroEditor.querySelector('#outro-line3') || {}).value || 'GAUNTLET GALLERY',
      (outroEditor.querySelector('#outro-line4') || {}).value || '',
    ];
    const outroText = outroLines.join('\n');

    // Export formats
    const exportFormats = ['9:16'];
    if (document.getElementById('export-1x1') && document.getElementById('export-1x1').checked) {
      exportFormats.push('1:1');
    }
    if (document.getElementById('export-16x9') && document.getElementById('export-16x9').checked) {
      exportFormats.push('16:9');
    }

    return { segments, transitions, outroText, exportFormats, kenBurns, colorGrade };
  }

  // === Quick Preview ===
  btnPreview.addEventListener('click', async () => {
    btnPreview.disabled = true;
    stepPreview.hidden = false;
    previewProgress.hidden = false;
    previewStatusText.hidden = false;
    previewPlayerContainer.hidden = true;

    const stageEl = document.querySelector('#stage-preview .progress-fill');
    if (stageEl) stageEl.style.width = '0%';

    const { segments, transitions } = collectEditorData();

    try {
      const response = await fetch(`/api/music-video/preview/${jobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segments, transitions }),
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        var currentEvent = null;
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7);
          } else if (line.startsWith('data: ') && currentEvent) {
            const data = JSON.parse(line.slice(6));
            handlePreviewEvent(currentEvent, data);
            currentEvent = null;
          }
        }
      }
    } catch (err) {
      previewStatusText.className = 'status-message error';
      previewStatusText.textContent = 'Preview failed: ' + err.message;
    }
    btnPreview.disabled = false;
  });

  function handlePreviewEvent(event, data) {
    if (event === 'progress') {
      const stageEl = document.querySelector('#stage-preview .progress-fill');
      if (stageEl) stageEl.style.width = data.percent + '%';
      previewStatusText.className = 'status-message loading';
      previewStatusText.textContent = data.message;
    } else if (event === 'complete') {
      previewStatusText.className = 'status-message success';
      previewStatusText.textContent = 'Preview ready!';
      previewPlayerContainer.hidden = false;
      previewPlayer.src = data.previewUrl;
      previewPlayer.load();
    } else if (event === 'error') {
      previewStatusText.className = 'status-message error';
      previewStatusText.textContent = 'Preview error: ' + data.message;
    }
  }

  // === Full Render ===
  btnRender.addEventListener('click', async () => {
    btnRender.disabled = true;
    btnPreview.disabled = true;
    stepRender.hidden = false;
    downloadSection.hidden = true;
    renderStatusText.textContent = '';

    document.querySelectorAll('#step-render .progress-fill').forEach((el) => {
      el.style.width = '0%';
    });

    const { segments, transitions, outroText, exportFormats, kenBurns, colorGrade } = collectEditorData();

    try {
      const response = await fetch(`/api/music-video/render/${jobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artistName: artistNameInput.value || 'Artist',
          segments,
          transitions,
          outroText,
          exportFormats,
          kenBurns,
          colorGrade,
        }),
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        var currentEvent = null;
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7);
          } else if (line.startsWith('data: ') && currentEvent) {
            const data = JSON.parse(line.slice(6));
            handleRenderEvent(currentEvent, data);
            currentEvent = null;
          }
        }
      }
    } catch (err) {
      renderStatusText.className = 'status-message error';
      renderStatusText.textContent = 'Render failed: ' + err.message;
      btnRender.disabled = false;
      btnPreview.disabled = false;
    }
  });

  function handleRenderEvent(event, data) {
    if (event === 'progress') {
      const stageEl = document.querySelector(`#stage-${data.stage} .progress-fill`);
      if (stageEl) stageEl.style.width = data.percent + '%';
      renderStatusText.className = 'status-message loading';
      renderStatusText.textContent = data.message;
    } else if (event === 'complete') {
      renderStatusText.className = 'status-message success';
      renderStatusText.textContent = 'Music video complete!';
      downloadSection.hidden = false;

      // Main download link
      downloadLink.href = data.downloadUrl;

      // Additional export format download links
      if (data.exports) {
        downloadLinks.innerHTML = '';
        for (const [fmt, url] of Object.entries(data.exports)) {
          const a = document.createElement('a');
          a.className = 'btn btn-primary btn-large';
          a.href = url;
          a.download = '';
          a.textContent = `Download ${fmt}`;
          downloadLinks.appendChild(a);
        }
      }

      // Thumbnail
      if (data.thumbnailUrl) {
        thumbnailSection.hidden = false;
        thumbnailPreview.src = data.thumbnailUrl;
        thumbnailDownload.href = data.thumbnailUrl;
      }

      btnRender.disabled = false;
      btnPreview.disabled = false;
    } else if (event === 'error') {
      renderStatusText.className = 'status-message error';
      renderStatusText.textContent = 'Error: ' + data.message;
      btnRender.disabled = false;
      btnPreview.disabled = false;
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
