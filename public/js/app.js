(function () {
  let jobId = null;
  let videoInfo = null;
  let timeline = null;

  // DOM refs
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const btnBrowse = document.getElementById('btn-browse');
  const uploadProgress = document.getElementById('upload-progress');
  const videoInfoPanel = document.getElementById('video-info');

  const stepAnalyze = document.getElementById('step-analyze');
  const btnAnalyze = document.getElementById('btn-analyze');
  const analyzeStatus = document.getElementById('analyze-status');
  const analysisResults = document.getElementById('analysis-results');
  const analysisFields = document.getElementById('analysis-fields');

  const stepTimeline = document.getElementById('step-timeline');
  const timelineBar = document.getElementById('timeline-bar');
  const calloutEditor = document.getElementById('callout-editor');
  const musicInput = document.getElementById('music-input');
  const musicFilename = document.getElementById('music-filename');

  const stepRender = document.getElementById('step-render');
  const btnRender = document.getElementById('btn-render');
  const renderProgress = document.getElementById('render-progress');
  const renderStatusText = document.getElementById('render-status-text');
  const downloadSection = document.getElementById('download-section');
  const downloadLink = document.getElementById('download-link');

  // Drag and drop
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  });

  btnBrowse.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) uploadFile(fileInput.files[0]);
  });

  // Upload
  async function uploadFile(file) {
    uploadProgress.hidden = false;
    const fill = uploadProgress.querySelector('.progress-fill');
    const text = uploadProgress.querySelector('.progress-text');

    const formData = new FormData();
    formData.append('video', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        fill.style.width = pct + '%';
        text.textContent = `Uploading... ${pct}%`;
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        const data = JSON.parse(xhr.responseText);
        jobId = data.jobId;
        videoInfo = data.videoInfo;
        showVideoInfo(data);
        stepAnalyze.hidden = false;
      } else {
        const err = JSON.parse(xhr.responseText);
        text.textContent = 'Upload failed: ' + err.error;
      }
    };

    xhr.onerror = () => { text.textContent = 'Upload failed — network error'; };
    xhr.send(formData);
  }

  function showVideoInfo(data) {
    const v = data.videoInfo;
    const dur = Math.round(v.duration);
    const size = (v.fileSize / (1024 * 1024)).toFixed(1);
    videoInfoPanel.innerHTML = `
      <strong>${data.originalName}</strong><br>
      ${v.width}x${v.height} &bull; ${Math.round(v.fps)} fps &bull;
      ${dur}s &bull; ${size} MB &bull; ${v.hasAudio ? 'Audio: Yes' : 'Audio: None'}
    `;
    videoInfoPanel.hidden = false;
  }

  // Analyze
  btnAnalyze.addEventListener('click', async () => {
    btnAnalyze.disabled = true;
    analyzeStatus.hidden = false;
    analyzeStatus.className = 'status-message loading';
    analyzeStatus.textContent = 'Extracting frames and analyzing with Claude Vision...';

    try {
      const res = await fetch(`/api/analyze/${jobId}`, { method: 'POST' });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error);

      timeline = data.timeline;
      showAnalysis(data.analysis);
      showTimeline();
      stepTimeline.hidden = false;
      stepRender.hidden = false;

      analyzeStatus.className = 'status-message success';
      analyzeStatus.textContent = 'Analysis complete';
    } catch (err) {
      analyzeStatus.className = 'status-message error';
      analyzeStatus.textContent = 'Error: ' + err.message;
      btnAnalyze.disabled = false;
    }
  });

  function showAnalysis(analysis) {
    analysisResults.hidden = false;
    analysisFields.innerHTML = '';

    const fields = [
      { key: 'artwork_subject', label: 'Subject' },
      { key: 'color_description', label: 'Colors' },
      { key: 'frame_description', label: 'Frame' },
      { key: 'frame_era', label: 'Frame Era' },
      { key: 'signature_detail', label: 'Signature' },
      { key: 'edition_detail', label: 'Edition' },
    ];

    fields.forEach(({ key, label }) => {
      const val = analysis[key] || '';
      const div = document.createElement('div');
      div.className = 'analysis-field';
      div.innerHTML = `
        <label>${label}</label>
        <input type="text" data-key="${key}" value="${escapeHtml(val)}">
      `;
      analysisFields.appendChild(div);
    });

    if (analysis.notable_details && analysis.notable_details.length > 0) {
      const div = document.createElement('div');
      div.className = 'analysis-field';
      div.style.gridColumn = '1 / -1';
      div.innerHTML = `
        <label>Notable Details</label>
        <textarea data-key="notable_details" rows="2">${escapeHtml(analysis.notable_details.join(', '))}</textarea>
      `;
      analysisFields.appendChild(div);
    }
  }

  function showTimeline() {
    timelineBar.innerHTML = '';
    calloutEditor.innerHTML = '';

    const totalDur = timeline.totalDuration;

    // Intro block
    const introWidth = (timeline.intro.duration / totalDur) * 100;
    const introEl = document.createElement('div');
    introEl.className = 'timeline-intro';
    introEl.style.width = introWidth + '%';
    introEl.textContent = 'INTRO';
    timelineBar.appendChild(introEl);

    // Callout blocks on timeline + editor rows
    timeline.callouts.forEach((c, i) => {
      const left = (c.time / totalDur) * 100;
      const width = (c.duration / totalDur) * 100;

      const block = document.createElement('div');
      block.className = 'timeline-callout';
      block.style.left = left + '%';
      block.style.width = width + '%';
      block.textContent = c.text;
      block.title = `${c.time}s - ${c.text}`;
      timelineBar.appendChild(block);

      const row = document.createElement('div');
      row.className = 'callout-row';
      row.innerHTML = `
        <span class="callout-time">${c.time}s</span>
        <input type="text" value="${escapeHtml(c.text)}" data-callout-index="${i}">
      `;
      row.querySelector('input').addEventListener('change', (e) => {
        timeline.callouts[i].text = e.target.value;
        block.textContent = e.target.value;
        block.title = `${c.time}s - ${e.target.value}`;
      });
      calloutEditor.appendChild(row);
    });
  }

  // Music
  document.querySelectorAll('input[name="music"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.value === 'custom') {
        musicInput.click();
      }
    });
  });

  musicInput.addEventListener('change', async () => {
    const file = musicInput.files[0];
    if (!file || !jobId) return;

    const formData = new FormData();
    formData.append('music', file);

    const res = await fetch(`/api/music/${jobId}`, { method: 'POST', body: formData });
    const data = await res.json();
    musicFilename.textContent = file.name;
  });

  // Render
  btnRender.addEventListener('click', async () => {
    btnRender.disabled = true;
    renderProgress.hidden = false;
    downloadSection.hidden = true;
    renderStatusText.textContent = '';

    // Save any timeline edits first
    await fetch(`/api/timeline/${jobId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeline }),
    });

    // SSE connection for progress
    const evtSource = new EventSource(`/api/render/${jobId}`);

    // Since render is POST but EventSource is GET, use fetch + reader instead
    evtSource.close();

    try {
      const response = await fetch(`/api/render/${jobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeline }),
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

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            var currentEvent = line.slice(7);
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
      renderStatusText.textContent = 'Render complete!';
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
