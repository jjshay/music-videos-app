(function () {
  let uploadedImages = [];
  let imageElements = [];
  let imageTitles = [];
  let videoBlob = null;
  let mediaRecorder = null;
  let recordingChunks = [];
  let draggedItemIndex = null;

  // DOM refs (all pv- prefixed)
  const uploadArea = document.getElementById('pv-uploadArea');
  const imageInput = document.getElementById('pv-imageInput');
  const imagePreview = document.getElementById('pv-imagePreview');
  const createVideoBtn = document.getElementById('pv-createVideoBtn');
  const resetBtn = document.getElementById('pv-resetBtn');
  const downloadBtn = document.getElementById('pv-downloadBtn');
  const createAnotherBtn = document.getElementById('pv-createAnotherBtn');
  const renderStep = document.getElementById('pv-renderStep');
  const progressSection = document.getElementById('pv-progressSection');
  const progressFill = document.getElementById('pv-progressFill');
  const progressStatus = document.getElementById('pv-progressStatus');
  const statusMessage = document.getElementById('pv-statusMessage');
  const videoPreviewSection = document.getElementById('pv-videoPreviewSection');
  const videoPreview = document.getElementById('pv-videoPreview');
  const videoCanvas = document.getElementById('pv-videoCanvas');

  // Upload area events
  uploadArea.addEventListener('click', () => imageInput.click());
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
  });
  uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    handleFiles(Array.from(e.dataTransfer.files));
  });
  imageInput.addEventListener('change', (e) => {
    handleFiles(Array.from(e.target.files));
  });

  createVideoBtn.addEventListener('click', createVideo);
  resetBtn.addEventListener('click', resetApplication);
  downloadBtn.addEventListener('click', downloadVideo);
  createAnotherBtn.addEventListener('click', resetApplication);

  function handleFiles(files) {
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      showStatus('Please upload image files only', 'error');
      return;
    }
    uploadedImages = uploadedImages.concat(imageFiles);
    loadAndPreviewImages();
    createVideoBtn.disabled = uploadedImages.length === 0;
    showStatus('Loaded ' + uploadedImages.length + ' image(s)', 'success');
  }

  // AI title generation
  function generateArtTitle(imageFile, imageElement, index) {
    const phrases = [
      "ONE OF A KIND", "ONLY AT GAUNTLET GALLERY", "LAST ONE LEFT",
      "FREE SHIPPING", "GREAT GIFT", "UNIQUE ARTWORK", "ORIGINAL PIECE",
      "GALLERY EXCLUSIVE", "LIMITED EDITION", "SIGNED BY ARTIST",
      "MUSEUM QUALITY", "ARCHIVAL PRINT", "SHIPS WITHIN 24 HOURS",
      "READY TO HANG", "CERTIFICATE OF AUTHENTICITY", "COLLECTOR'S PIECE",
      "RARE FIND", "ARTIST PROOF", "GALLERY WRAPPED", "HAND SELECTED",
      "CURATED COLLECTION", "VINTAGE ORIGINAL", "CONTEMPORARY ART",
      "MODERN MASTERPIECE", "TIMELESS BEAUTY", "STUNNING DETAIL",
      "VIBRANT COLORS", "BOLD STATEMENT", "CONVERSATION STARTER",
      "PERFECT CONDITION", "MINT CONDITION", "AUTHENTIC ARTWORK",
      "GENUINE ORIGINAL", "FROM PRIVATE COLLECTION", "PRICED TO SELL",
      "MAKE AN OFFER", "FREE RETURNS", "SATISFACTION GUARANTEED",
      "WORLDWIDE SHIPPING", "TREAT YOURSELF", "PERFECT FOR YOUR HOME",
      "GIVE THE GIFT OF ART", "LIFE IS SHORT, BUY THE ART"
    ];

    if (index === uploadedImages.length - 1) {
      return "ONLY AT GAUNTLET GALLERY";
    }
    return phrases[Math.floor(Math.random() * phrases.length)];
  }

  function loadAndPreviewImages() {
    imagePreview.innerHTML = '';
    imageElements = [];
    imageTitles = [];

    uploadedImages.forEach((file, index) => {
      const previewDiv = document.createElement('div');
      previewDiv.className = 'pv-preview-item';
      previewDiv.draggable = true;
      previewDiv.dataset.index = index;

      const img = document.createElement('img');
      const imgObj = new Image();
      const url = URL.createObjectURL(file);
      img.src = url;
      imgObj.src = url;

      imgObj.onload = () => {
        imageElements[index] = imgObj;
        imageTitles[index] = generateArtTitle(file, imgObj, index);
      };

      const dragHandle = document.createElement('div');
      dragHandle.className = 'pv-drag-handle';
      dragHandle.innerHTML = '&#x2630;';

      const imageNumber = document.createElement('div');
      imageNumber.className = 'pv-image-number';
      imageNumber.textContent = index + 1;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'pv-remove-btn';
      removeBtn.innerHTML = '&times;';
      removeBtn.onclick = () => removeImage(index);

      previewDiv.addEventListener('dragstart', handleDragStart);
      previewDiv.addEventListener('dragenter', handleDragEnter);
      previewDiv.addEventListener('dragover', handleDragOver);
      previewDiv.addEventListener('dragleave', handleDragLeave);
      previewDiv.addEventListener('drop', handleDrop);
      previewDiv.addEventListener('dragend', handleDragEnd);

      previewDiv.appendChild(img);
      previewDiv.appendChild(dragHandle);
      previewDiv.appendChild(imageNumber);
      previewDiv.appendChild(removeBtn);
      imagePreview.appendChild(previewDiv);
    });
  }

  function handleDragStart(e) {
    draggedItemIndex = parseInt(e.currentTarget.dataset.index);
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  }
  function handleDragEnter(e) {
    if (e.currentTarget.classList.contains('pv-preview-item')) e.currentTarget.classList.add('drag-over');
  }
  function handleDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; return false; }
  function handleDragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
  function handleDrop(e) {
    e.stopPropagation();
    const dropIndex = parseInt(e.currentTarget.dataset.index);
    if (draggedItemIndex !== null && draggedItemIndex !== dropIndex) {
      const di = uploadedImages[draggedItemIndex];
      const de = imageElements[draggedItemIndex];
      const dt = imageTitles[draggedItemIndex];
      uploadedImages.splice(draggedItemIndex, 1);
      imageElements.splice(draggedItemIndex, 1);
      imageTitles.splice(draggedItemIndex, 1);
      uploadedImages.splice(dropIndex, 0, di);
      imageElements.splice(dropIndex, 0, de);
      imageTitles.splice(dropIndex, 0, dt);
      loadAndPreviewImages();
      showStatus('Images reordered', 'success');
    }
    return false;
  }
  function handleDragEnd(e) {
    document.querySelectorAll('#tab-product .pv-preview-item').forEach(item => {
      item.classList.remove('dragging', 'drag-over');
    });
    draggedItemIndex = null;
  }

  function removeImage(index) {
    uploadedImages.splice(index, 1);
    loadAndPreviewImages();
    createVideoBtn.disabled = uploadedImages.length === 0;
  }

  async function createVideo() {
    if (uploadedImages.length === 0) {
      showStatus('Please upload at least one image', 'error');
      return;
    }

    showProgress(true);
    updateProgress(0, 'Initializing video creation...');

    const settings = {
      aspectRatio: document.getElementById('pv-aspectRatio').value,
      duration: parseInt(document.getElementById('pv-imageDuration').value) * 1000,
      transition: document.getElementById('pv-transitionStyle').value,
      quality: document.getElementById('pv-videoQuality').value,
      backgroundColor: document.getElementById('pv-backgroundColor').value,
      titleText: document.getElementById('pv-titleText').value,
      priceText: document.getElementById('pv-priceText').value,
      ctaText: document.getElementById('pv-ctaText').value,
      textPosition: document.getElementById('pv-textPosition').value,
      textStyle: document.getElementById('pv-textStyle').value,
      salesEffect: document.getElementById('pv-salesEffect').value,
      watermark: document.getElementById('pv-watermark').value,
      ebayBadge: document.getElementById('pv-ebayBadge').value,
      listingType: document.getElementById('pv-listingType').value,
    };

    try {
      updateProgress(10, 'Setting up canvas...');
      const blob = await generateVideo(settings);
      videoBlob = blob;
      updateProgress(100, 'Complete!');
      showVideoPreview(videoBlob);
      showStatus('Video created successfully!', 'success');
    } catch (error) {
      console.error('Video creation error:', error);
      showStatus('Error creating video: ' + error.message, 'error');
    } finally {
      showProgress(false);
    }
  }

  function generateVideo(settings) {
    return new Promise((resolve, reject) => {
      const ctx = videoCanvas.getContext('2d');
      const { width, height } = getCanvasDimensions(settings.aspectRatio, settings.quality);
      videoCanvas.width = width;
      videoCanvas.height = height;

      const stream = videoCanvas.captureStream(30);
      recordingChunks = [];

      mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'video/webm;codecs=vp9',
        videoBitsPerSecond: 5000000,
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunks.push(event.data);
      };

      mediaRecorder.onstop = () => {
        resolve(new Blob(recordingChunks, { type: 'video/webm' }));
      };

      mediaRecorder.start();
      animateImages(ctx, videoCanvas, settings, () => mediaRecorder.stop());
    });
  }

  function animateImages(ctx, canvas, settings, onComplete) {
    let currentImageIndex = 0;
    const totalImages = imageElements.length;

    function drawNextImage() {
      if (currentImageIndex >= totalImages) { onComplete(); return; }

      const img = imageElements[currentImageIndex];
      if (!img || !img.complete) { currentImageIndex++; drawNextImage(); return; }

      const progress = 10 + (70 * (currentImageIndex / totalImages));
      updateProgress(progress, 'Processing image ' + (currentImageIndex + 1) + ' of ' + totalImages + '...');

      ctx.fillStyle = settings.backgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      applyTransition(ctx, canvas, img, settings.transition, settings.duration, settings, currentImageIndex);

      currentImageIndex++;
      setTimeout(drawNextImage, settings.duration);
    }
    drawNextImage();
  }

  function getImageBrightness(ctx, x, y, width, height) {
    try {
      const imageData = ctx.getImageData(x, y, width, height);
      const data = imageData.data;
      let brightness = 0;
      for (let i = 0; i < data.length; i += 40) {
        brightness += (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      }
      return brightness / (data.length / 40) / 255;
    } catch (e) { return 0.5; }
  }

  function applyTransition(ctx, canvas, img, transition, duration, settings, imageIndex) {
    const startTime = Date.now();
    let pulsePhase = 0;

    if (transition === 'random') {
      const options = ['fade', 'slide', 'zoom', 'topToBottom', 'leftToRight', 'diagonalPan', 'rotateZoom', 'threeStage'];
      transition = options[Math.floor(Math.random() * options.length)];
    }

    function animate() {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      pulsePhase += 0.1;

      ctx.fillStyle = settings.backgroundColor || '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
      const sw = img.width * scale;
      const sh = img.height * scale;
      const x = (canvas.width - sw) / 2;
      const y = (canvas.height - sh) / 2;

      ctx.save();

      switch (transition) {
        case 'zoom':
          var z = 1 + (progress * 0.2);
          ctx.translate(canvas.width / 2, canvas.height / 2);
          ctx.scale(z, z);
          ctx.translate(-canvas.width / 2, -canvas.height / 2);
          break;
        case 'slide':
          ctx.translate(-canvas.width * (1 - progress), 0);
          break;
        case 'fade':
          ctx.globalAlpha = progress;
          break;
        case 'topToBottom':
          ctx.translate(0, -sh * 0.1 * (1 - progress));
          break;
        case 'leftToRight':
          ctx.translate(-sw * 0.1 * (1 - progress), 0);
          break;
        case 'diagonalPan':
          ctx.translate(-sw * 0.1 * (1 - progress), -sh * 0.1 * (1 - progress));
          break;
        case 'rotateZoom':
          ctx.translate(canvas.width / 2, canvas.height / 2);
          ctx.rotate(progress * Math.PI / 180 * 5);
          ctx.scale(1 + progress * 0.15, 1 + progress * 0.15);
          ctx.translate(-canvas.width / 2, -canvas.height / 2);
          break;
        case 'threeStage':
          if (progress < 0.33) {
            var p1 = progress * 3;
            ctx.translate(0, -sh * 0.1 * p1);
            ctx.scale(1 + p1 * 0.1, 1 + p1 * 0.1);
          } else if (progress < 0.66) {
            var p2 = (progress - 0.33) * 3;
            ctx.translate(0, -sh * 0.1 * (1 - p2));
            ctx.scale(1.1, 1.1);
          } else {
            var p3 = (progress - 0.66) * 3;
            ctx.translate(0, sh * 0.1 * p3);
            ctx.scale(1.1 + p3 * 0.1, 1.1 + p3 * 0.1);
          }
          break;
      }

      ctx.drawImage(img, x, y, sw, sh);
      ctx.restore();

      drawMarketingOverlays(ctx, canvas, settings, progress, pulsePhase, imageIndex);

      if (progress < 1) requestAnimationFrame(animate);
    }
    animate();
  }

  function drawMarketingOverlays(ctx, canvas, settings, progress, pulsePhase, imageIndex) {
    const styles = {
      modern: { titleFont: 'bold 48px -apple-system, sans-serif', priceFont: 'bold 36px -apple-system, sans-serif', ctaFont: 'bold 28px -apple-system, sans-serif', titleColor: '#FFFFFF', priceColor: '#FFD700', ctaColor: '#FF4444', shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.8)' },
      bold: { titleFont: 'black 56px Impact, sans-serif', priceFont: 'black 42px Impact, sans-serif', ctaFont: 'black 32px Impact, sans-serif', titleColor: '#FFFFFF', priceColor: '#FFFF00', ctaColor: '#FF0000', shadowBlur: 15, shadowColor: 'rgba(0,0,0,1)' },
      elegant: { titleFont: '300 44px Georgia, serif', priceFont: 'italic 32px Georgia, serif', ctaFont: '28px Georgia, serif', titleColor: '#F8F8F8', priceColor: '#E8D4B0', ctaColor: '#D4AF37', shadowBlur: 5, shadowColor: 'rgba(0,0,0,0.5)' },
      neon: { titleFont: 'bold 52px Arial, sans-serif', priceFont: 'bold 38px Arial, sans-serif', ctaFont: 'bold 30px Arial, sans-serif', titleColor: '#00FFFF', priceColor: '#FF00FF', ctaColor: '#FFFF00', shadowBlur: 20, shadowColor: '#FF00FF' },
      vintage: { titleFont: 'bold 46px "Courier New", monospace', priceFont: 'bold 34px "Courier New", monospace', ctaFont: 'bold 26px "Courier New", monospace', titleColor: '#F5E6D3', priceColor: '#8B7355', ctaColor: '#CD853F', shadowBlur: 8, shadowColor: 'rgba(139,69,19,0.8)' },
    };
    const style = styles[settings.textStyle] || styles.modern;

    let titleY, priceY, ctaY;
    const padding = 60;
    switch (settings.textPosition) {
      case 'top': titleY = padding; priceY = padding + 60; ctaY = padding + 120; break;
      case 'center': titleY = canvas.height / 2 - 60; priceY = canvas.height / 2; ctaY = canvas.height / 2 + 60; break;
      case 'split': titleY = padding; priceY = canvas.height - padding - 60; ctaY = canvas.height - padding; break;
      default: titleY = canvas.height - padding - 120; priceY = canvas.height - padding - 60; ctaY = canvas.height - padding;
    }

    let effectScale = 1, effectAlpha = 1;
    switch (settings.salesEffect) {
      case 'flash': effectAlpha = 0.5 + Math.abs(Math.sin(pulsePhase)) * 0.5; break;
      case 'pulse': effectScale = 1 + Math.sin(pulsePhase) * 0.1; break;
      case 'zoom': effectScale = 0.8 + progress * 0.4; break;
      case 'sparkle': drawSparkles(ctx, canvas, pulsePhase); break;
      case 'countdown': drawCountdown(ctx, canvas, progress); break;
    }

    ctx.save();
    if (effectScale !== 1) {
      ctx.translate(canvas.width / 2, titleY);
      ctx.scale(effectScale, effectScale);
      ctx.translate(-canvas.width / 2, -titleY);
    }
    ctx.globalAlpha = effectAlpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowBlur = style.shadowBlur;
    ctx.shadowColor = style.shadowColor;

    if (settings.titleText) {
      ctx.font = style.titleFont;
      ctx.fillStyle = style.titleColor;
      ctx.fillText(settings.titleText, canvas.width / 2, titleY);
    }
    if (settings.priceText) {
      ctx.font = style.priceFont;
      ctx.fillStyle = style.priceColor;
      ctx.fillText(settings.priceText, canvas.width / 2, priceY);
    }
    if (settings.ctaText) {
      ctx.font = style.ctaFont;
      const m = ctx.measureText(settings.ctaText);
      const bw = m.width + 40, bh = 50;
      ctx.fillStyle = 'rgba(255, 68, 68, 0.9)';
      ctx.roundRect(canvas.width / 2 - bw / 2, ctaY - bh / 2, bw, bh, 10);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(settings.ctaText, canvas.width / 2, ctaY);
    }
    if (settings.watermark) {
      ctx.globalAlpha = 0.4;
      ctx.font = 'bold 20px sans-serif';
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'right';
      ctx.fillText('eBay Store: ' + settings.watermark, canvas.width - 20, canvas.height - 20);
    }
    if (settings.ebayBadge) {
      ctx.globalAlpha = 0.9;
      ctx.font = 'bold 24px sans-serif';
      ctx.textAlign = 'left';
      const badges = { 'top-rated': 'Top Rated Plus', 'power-seller': 'PowerSeller', 'trusted': 'Trusted Seller', 'returns': 'Free Returns', 'money-back': 'Money Back' };
      const bt = badges[settings.ebayBadge] || '';
      const bm = ctx.measureText(bt);
      ctx.fillStyle = 'rgba(0, 85, 204, 0.9)';
      ctx.roundRect(10, canvas.height - 80, bm.width + 20, 40, 8);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(bt, 20, canvas.height - 60);
    }
    if (settings.listingType === 'auction' || settings.listingType === 'both') {
      drawAuctionTimer(ctx, canvas);
    }

    // AI-generated per-image title
    if (imageIndex !== undefined && imageTitles[imageIndex]) {
      ctx.save();
      const textAreaY = canvas.height - 150;
      const brightness = getImageBrightness(ctx, 0, textAreaY, canvas.width, 150);
      const aiTitleY = canvas.height - 60;
      const gradient = ctx.createLinearGradient(0, aiTitleY - 30, 0, aiTitleY + 30);
      if (brightness < 0.5) {
        gradient.addColorStop(0, 'rgba(0,0,0,0)');
        gradient.addColorStop(0.5, 'rgba(0,0,0,0.3)');
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
      } else {
        gradient.addColorStop(0, 'rgba(255,255,255,0)');
        gradient.addColorStop(0.5, 'rgba(255,255,255,0.4)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
      }
      ctx.fillStyle = gradient;
      ctx.fillRect(0, aiTitleY - 30, canvas.width, 60);

      const fontSize = canvas.width < 1000 ? 52 : 44;
      ctx.font = '700 ' + fontSize + 'px -apple-system, "Helvetica Neue", sans-serif';
      ctx.fillStyle = brightness < 0.5 ? 'rgba(255,255,255,0.85)' : 'rgba(20,20,60,0.85)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowBlur = 4;
      ctx.shadowColor = brightness < 0.5 ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.2)';
      ctx.fillText(imageTitles[imageIndex], canvas.width / 2, aiTitleY);
      if (progress < 0.2) ctx.globalAlpha = progress * 5;
      ctx.restore();
    }

    ctx.restore();
  }

  function drawSparkles(ctx, canvas, phase) {
    ctx.save();
    for (let i = 0; i < 5; i++) {
      const sx = (canvas.width / 6) * (i + 1);
      const sy = 50 + Math.sin(phase + i) * 20;
      const ss = 5 + Math.sin(phase + i * 2) * 3;
      ctx.fillStyle = 'rgba(255,255,255,' + (0.5 + Math.sin(phase + i) * 0.5) + ')';
      ctx.beginPath();
      ctx.arc(sx, sy, ss, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawCountdown(ctx, canvas, progress) {
    const timeLeft = Math.max(0, 24 - Math.floor(progress * 24));
    ctx.save();
    ctx.font = 'bold 36px sans-serif';
    ctx.fillStyle = '#FF0000';
    ctx.textAlign = 'left';
    ctx.fillText(timeLeft + 'h left!', 20, 50);
    ctx.restore();
  }

  function drawAuctionTimer(ctx, canvas) {
    ctx.save();
    const d = Math.floor(Math.random() * 3) + 1;
    const h = Math.floor(Math.random() * 24);
    const m = Math.floor(Math.random() * 60);
    ctx.fillStyle = 'rgba(255, 0, 0, 0.9)';
    ctx.roundRect(canvas.width - 250, 20, 230, 40, 8);
    ctx.fill();
    ctx.font = 'bold 20px sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.fillText('Auction: ' + d + 'd ' + h + 'h ' + m + 'm', canvas.width - 135, 42);
    ctx.restore();
  }

  function getCanvasDimensions(aspectRatio, quality) {
    const dims = {
      '16:9': { high: [1920, 1080], medium: [1280, 720], low: [854, 480] },
      '4:3': { high: [1440, 1080], medium: [960, 720], low: [640, 480] },
      '3:4': { high: [1080, 1440], medium: [720, 960], low: [480, 640] },
      '1:1': { high: [1080, 1080], medium: [720, 720], low: [480, 480] },
      '9:16': { high: [1080, 1920], medium: [720, 1280], low: [480, 854] },
      '4:5': { high: [1080, 1350], medium: [720, 900], low: [480, 600] },
      '5:4': { high: [1350, 1080], medium: [900, 720], low: [600, 480] },
    };
    const d = (dims[aspectRatio] || dims['3:4'])[quality] || dims['3:4'].high;
    return { width: d[0], height: d[1] };
  }

  function showVideoPreview(blob) {
    videoPreview.src = URL.createObjectURL(blob);
    videoPreviewSection.style.display = 'block';
    videoPreviewSection.scrollIntoView({ behavior: 'smooth' });
  }

  function downloadVideo() {
    if (!videoBlob) { showStatus('No video to download', 'error'); return; }
    const url = URL.createObjectURL(videoBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'product_video_' + Date.now() + '.webm';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
    showStatus('Video downloaded. Convert to MP4 via CloudConvert if needed.', 'success');
  }

  function resetApplication() {
    uploadedImages = [];
    imageElements = [];
    imageTitles = [];
    videoBlob = null;
    recordingChunks = [];
    imagePreview.innerHTML = '';
    imageInput.value = '';
    videoPreviewSection.style.display = 'none';
    renderStep.hidden = true;
    progressSection.style.display = 'none';
    createVideoBtn.disabled = true;
    showStatus('Ready to create a new video', 'info');
  }

  function showProgress(show) {
    renderStep.hidden = !show;
    progressSection.style.display = show ? 'block' : 'none';
    if (show) renderStep.scrollIntoView({ behavior: 'smooth' });
  }

  function updateProgress(percent, status) {
    progressFill.style.width = percent + '%';
    progressFill.textContent = Math.round(percent) + '%';
    if (status) progressStatus.textContent = status;
  }

  function showStatus(message, type) {
    statusMessage.className = 'pv-status-message pv-status-' + type;
    statusMessage.textContent = message;
    statusMessage.style.display = 'block';
    setTimeout(() => { statusMessage.style.display = 'none'; }, 5000);
  }
})();
