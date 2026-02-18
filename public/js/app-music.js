(function () {
  let jobId = null;
  let aiAnalysis = null;

  // Files collected before upload
  const files = { artistClip: null, guitarClip: null, crowdClip: null };

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
  const btnRender = document.getElementById('btn-render');

  // Step 3 — Render
  const stepRender = document.getElementById('step-render');
  const renderStatusText = document.getElementById('render-status-text');
  const downloadSection = document.getElementById('download-section');
  const downloadLink = document.getElementById('download-link');

  const TRANSITIONS = [
    // Professional (smooth, broadcast-quality)
    'fade', 'dissolve', 'wipeleft', 'wiperight',
    'slideup', 'slidedown', 'smoothleft', 'smoothright',
    // Additional
    'wipeup', 'wipedown', 'slideleft', 'slideright', 'pixelize',
  ];

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
    const hasRequired = files.artistClip && files.guitarClip;
    const needsCrowd = useCustomCrowd.checked;
    const hasCrowd = !needsCrowd || files.crowdClip;
    btnUpload.disabled = !(hasRequired && hasCrowd);
  }

  // === Upload → Analyze → Fetch Crowd ===
  btnUpload.addEventListener('click', async () => {
    btnUpload.disabled = true;
    uploadProgress.hidden = false;
    uploadStatus.hidden = true;
    const fill = uploadProgress.querySelector('.progress-fill');
    const text = uploadProgress.querySelector('.progress-text');

    const formData = new FormData();
    formData.append('artistClip', files.artistClip);
    formData.append('guitarClip', files.guitarClip);
    if (files.crowdClip) formData.append('crowdClip', files.crowdClip);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/music-video/upload');

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        fill.style.width = pct + '%';
        text.textContent = `Uploading... ${pct}%`;
      }
    };

    xhr.onload = async () => {
      if (xhr.status === 200) {
        const data = JSON.parse(xhr.responseText);
        jobId = data.jobId;
        fill.style.width = '100%';
        text.textContent = 'Upload complete';

        stepAnalyze.hidden = false;
        await runAnalysisPipeline(data);
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          showUploadError(err.error);
        } catch { showUploadError('Upload failed'); }
      }
    };

    xhr.onerror = () => showUploadError('Network error');
    xhr.send(formData);
  });

  function showUploadError(msg) {
    uploadStatus.hidden = false;
    uploadStatus.className = 'status-message error';
    uploadStatus.textContent = msg;
    btnUpload.disabled = false;
  }

  /**
   * Full pipeline after upload:
   * 1. Analyze clips with Claude Vision (mood, trim points, captions)
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

    segments.forEach((seg, i) => {
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

    btnRender.hidden = false;
  }

  function updateDurationTotal() {
    const inputs = segmentEditor.querySelectorAll('.seg-duration');
    let total = 0;
    inputs.forEach((inp) => { total += parseInt(inp.value) || 0; });
    // 3s intro + segments + 4s outro - 4 crossfade overlaps at 0.5s each = 2s
    const visual = 3 + total + 4 - 2;
    durationTotal.textContent = `Total: ~${Math.round(visual)}s (3s intro + ${total}s segments + 4s outro - 2s transitions)`;
    durationTotal.className = 'duration-total ' + (visual >= 30 && visual <= 40 ? 'ok' : 'over');
  }

  // === Render ===
  btnRender.addEventListener('click', async () => {
    btnRender.disabled = true;
    stepRender.hidden = false;
    downloadSection.hidden = true;
    renderStatusText.textContent = '';

    document.querySelectorAll('#step-render .progress-fill').forEach((el) => {
      el.style.width = '0%';
    });

    const segRows = segmentEditor.querySelectorAll('.seg-row');
    const segments = [];
    segRows.forEach((row) => {
      const i = parseInt(row.dataset.index);
      const origSeg = aiAnalysis.segments[i];
      segments.push({
        clipType: origSeg.clipType,
        caption: row.querySelector('.seg-caption').value,
        duration: parseInt(row.querySelector('.seg-duration').value) || 10,
        seekTo: parseFloat(row.querySelector('.seg-seek').value) || 0,
      });
    });

    const transitionEls = segmentEditor.querySelectorAll('.transition-row');
    const transitions = [];
    transitionEls.forEach((tRow) => {
      transitions.push({ type: tRow.querySelector('.transition-type').value });
    });

    // Build outro text from editor (4 lines joined by newline)
    const outroLines = [
      (outroEditor.querySelector('#outro-line1') || {}).value || 'BROWSE THE FULL COLLECTION',
      (outroEditor.querySelector('#outro-line2') || {}).value || 'AUTHENTICATED GUITARS',
      (outroEditor.querySelector('#outro-line3') || {}).value || 'GAUNTLET GALLERY',
      (outroEditor.querySelector('#outro-line4') || {}).value || '',
    ];
    const outroText = outroLines.join('\n');

    try {
      const response = await fetch(`/api/music-video/render/${jobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artistName: artistNameInput.value || 'Artist',
          segments,
          transitions,
          outroText,
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
      downloadLink.href = data.downloadUrl;
      btnRender.disabled = false;
    } else if (event === 'error') {
      renderStatusText.className = 'status-message error';
      renderStatusText.textContent = 'Error: ' + data.message;
      btnRender.disabled = false;
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
