// Gli shader sono definiti in shaders.js - assicurati di includerlo prima di questo script

let video = document.getElementById('video');
let canvas = document.getElementById('canvas');
let gl = canvas ? canvas.getContext('webgl', {
    antialias: true,
    alpha: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance'
}) || canvas.getContext('experimental-webgl', {
    antialias: true,
    alpha: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance'
}) : null;

let shutter = document.getElementById('shutter');
let switchBtn = document.getElementById('switch');
let flashBtn = document.getElementById('flash');
let errorMessage = document.getElementById('error-message');
let currentStream;
let usingFrontCamera = false;
let flashEnabled = false;
let flashForCapture = false;
let currentVideoTrack = null;

let program;
let positionBuffer;
let lutTexture;
let videoTexture;
let animationId;
let uniformLocations = {};
let isLutLoaded = false;
let mediaRecorder;
let recordedChunks = [];
let isRecording = false;
let pressTimer;
let longPressThreshold = 500;
let flashWasEnabledBeforeCapture = false; // Stato flash prima della cattura

async function checkCameraCapabilities() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        
        console.log(`Fotocamere disponibili: ${videoDevices.length}`);
        
        const testConstraints = {
            video: {
                facingMode: usingFrontCamera ? 'user' : 'environment'
            }
        };
        
        const capabilities = await navigator.mediaDevices.getSupportedConstraints();
        console.log('Capabilities supportate:', capabilities);
        
    } catch (err) {
        console.error('Errore nel controllo capabilities:', err);
    }
}

function showError(message) {
    if (errorMessage) {
        errorMessage.textContent = message;
        errorMessage.style.display = 'block';
        setTimeout(() => {
            errorMessage.style.display = 'none';
        }, 5000);
    }
    console.error(message);
}

function updateFlashVisibility() {
    if (flashBtn) {
        if (usingFrontCamera) {
            flashBtn.style.display = 'none';
        } else {
            flashBtn.style.display = 'flex';
            updateFlashButtonAppearance();
        }
    }
}

function updateFlashButtonAppearance() {
    if (!flashBtn || usingFrontCamera) return;
    
    const svg = flashBtn.querySelector('svg');
    if (!svg) return;
    
    flashBtn.classList.remove('active');
    
    if (flashForCapture) {
        svg.style.fill = '#ffffff';
        svg.style.stroke = 'none';
        svg.style.opacity = '1';
    } else {
        svg.style.fill = 'none';
        svg.style.stroke = '#ffffff';
        svg.style.strokeWidth = '2px';
        svg.style.opacity = '0.6';
    }
}

async function setFlashState(enabled) {
    if (!currentVideoTrack || usingFrontCamera) return false;
    
    try {
        const capabilities = currentVideoTrack.getCapabilities();
        
        if (capabilities.torch) {
            await currentVideoTrack.applyConstraints({
                advanced: [{ torch: enabled }]
            });
            
            flashEnabled = enabled;
            console.log(`Flash hardware ${flashEnabled ? 'acceso' : 'spento'}`);
            return true;
        } else {
            console.log('Flash non supportato su questo dispositivo');
            return false;
        }
    } catch (err) {
        console.error('Errore controllo flash:', err);
        return false;
    }
}

async function toggleFlash() {
    if (usingFrontCamera || !currentVideoTrack) return;
    
    const capabilities = currentVideoTrack.getCapabilities();
    if (!capabilities.torch) {
        showError('Flash non disponibile');
        return;
    }
    
    flashForCapture = !flashForCapture;
    updateFlashButtonAppearance();
    console.log(`Flash durante cattura: ${flashForCapture ? 'ATTIVO' : 'DISATTIVATO'}`);
}

async function activateFlashForCapture() {
    if (usingFrontCamera || !currentVideoTrack || !flashForCapture) return false;
    
    try {
        const capabilities = currentVideoTrack.getCapabilities();
        if (!capabilities.torch) return false;
        
        flashWasEnabledBeforeCapture = flashEnabled;
        
        if (!flashEnabled) {
            await setFlashState(true);
            return true;
        }
        
        return true;
    } catch (err) {
        console.error('Errore attivazione flash per cattura:', err);
        return false;
    }
}

async function restoreFlashAfterCapture() {
    if (usingFrontCamera || !currentVideoTrack) return;
    
    try {
        if (flashForCapture && !flashWasEnabledBeforeCapture && flashEnabled) {
            await setFlashState(false);
        }
    } catch (err) {
        console.error('Errore ripristino flash dopo cattura:', err);
    }
}

function createShader(gl, type, source) {
    let shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Errore compilazione shader:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function createProgram(gl, vertexShader, fragmentShader) {
    let program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Errore linking program:', gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
    }
    return program;
}

function cacheUniformLocations() {
    uniformLocations.image = gl.getUniformLocation(program, 'u_image');
    uniformLocations.lut = gl.getUniformLocation(program, 'u_lut');
    uniformLocations.flipX = gl.getUniformLocation(program, 'u_flipX');
    uniformLocations.imageSize = gl.getUniformLocation(program, 'u_imageSize');
}

function initWebGL() {
    if (!gl) {
        showError('WebGL non supportato dal tuo browser');
        return false;
    }
    
    let vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    let fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    
    if (!vertexShader || !fragmentShader) {
        showError('Errore nella compilazione degli shader');
        return false;
    }
    
    program = createProgram(gl, vertexShader, fragmentShader);
    if (!program) {
        showError('Errore nella creazione del programma WebGL');
        return false;
    }
    
    gl.useProgram(program);
    cacheUniformLocations();
    
    let positionLocation = gl.getAttribLocation(program, 'a_position');
    
    positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 1, -1, -1, 1, 1, 1
    ]), gl.STATIC_DRAW);
    
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    
    videoTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, videoTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, videoTexture);
    gl.uniform1i(uniformLocations.image, 0);
    
    loadLUT();
    
    return true;
}

function createDefaultLUT() {
    let size = 512;
    let canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    let ctx = canvas.getContext('2d');
    
    let imageData = ctx.createImageData(size, size);
    let data = imageData.data;
    
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let index = (y * size + x) * 4;
            data[index] = x / size * 255;
            data[index + 1] = y / size * 255;
            data[index + 2] = 128;
            data[index + 3] = 255;
        }
    }
    
    ctx.putImageData(imageData, 0, 0);
    return canvas;
}

function loadLUT() {
    lutTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, lutTexture);
    
    let lutImage = new Image();
    lutImage.crossOrigin = 'anonymous';
    lutImage.onload = function() {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, lutTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, lutImage);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.uniform1i(uniformLocations.lut, 1);
        isLutLoaded = true;
        console.log('LUT caricata');
    };
    lutImage.onerror = function() {
        console.warn('LUT non trovata, uso LUT di default');
        let defaultLUT = createDefaultLUT();
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, lutTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, defaultLUT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.uniform1i(uniformLocations.lut, 1);
        isLutLoaded = true;
    };
    lutImage.src = 'lut.png';
}

function render() {
    if (!video || !video.videoWidth || !video.videoHeight || !isLutLoaded) {
        animationId = requestAnimationFrame(render);
        return;
    }
    
    gl.activeTexture(gl.TEXTURE0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
    
    gl.uniform1f(uniformLocations.flipX, usingFrontCamera ? -1.0 : 1.0);
    gl.uniform2f(uniformLocations.imageSize, video.videoWidth, video.videoHeight);
    
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    
    animationId = requestAnimationFrame(render);
}

function startCamera() {
    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
    }
    
    flashEnabled = false;
    currentVideoTrack = null;
    
    let needsAudio = typeof MediaRecorder !== 'undefined';
    
    let constraints = {
        video: { 
            facingMode: usingFrontCamera ? 'user' : 'environment',
            width: { ideal: 4096, min: 1920 },
            height: { ideal: 2160, min: 1080 },
            frameRate: { ideal: 60, min: 30 },
            aspectRatio: { ideal: 16/9 }
        },
        audio: needsAudio ? {
            sampleRate: 48000,
            channelCount: 2,
            echoCancellation: true,
            noiseSuppression: true
        } : false
    };
    
    navigator.mediaDevices.getUserMedia(constraints).then(stream => {
        currentStream = stream;
        currentVideoTrack = stream.getVideoTracks()[0];
        video.srcObject = stream;
        video.muted = true;
        video.onloadedmetadata = () => {
            video.play();
            resizeCanvas();
            if (!animationId) {
                render();
            }
            updateFlashVisibility();
            updateFlashButtonAppearance();
            console.log(`Risoluzione video: ${video.videoWidth}x${video.videoHeight}`);
            
            if (currentVideoTrack && !usingFrontCamera) {
                const capabilities = currentVideoTrack.getCapabilities();
                console.log('Flash supportato:', !!capabilities.torch);
            }
        };
    }).catch(err => {
        console.error('Errore fotocamera:', err);
        tryLowerQuality();
    });
}

function tryLowerQuality() {
    console.log('Tentativo con qualità ridotta...');
    let constraints = {
        video: { 
            facingMode: usingFrontCamera ? 'user' : 'environment',
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 },
            frameRate: { ideal: 30 }
        },
        audio: typeof MediaRecorder !== 'undefined'
    };
    
    navigator.mediaDevices.getUserMedia(constraints).then(stream => {
        currentStream = stream;
        currentVideoTrack = stream.getVideoTracks()[0];
        video.srcObject = stream;
        video.muted = true;
        video.onloadedmetadata = () => {
            video.play();
            resizeCanvas();
            if (!animationId) {
                render();
            }
            updateFlashVisibility();
            console.log(`Risoluzione fallback: ${video.videoWidth}x${video.videoHeight}`);
        };
    }).catch(err => {
        console.error('Errore anche con qualità ridotta:', err);
        showError('Impossibile accedere alla fotocamera');
    });
}

function resizeCanvas() {
    if (!video || !canvas) return;
    
    let vw = video.videoWidth;
    let vh = video.videoHeight;
    
    if (vw && vh) {
        let aspect = vw / vh;
        let windowAspect = window.innerWidth / window.innerHeight;
        
        let displayWidth, displayHeight;
        if (windowAspect > aspect) {
            displayHeight = window.innerHeight;
            displayWidth = window.innerHeight * aspect;
        } else {
            displayWidth = window.innerWidth;
            displayHeight = window.innerWidth / aspect;
        }
        
        let pixelRatio = window.devicePixelRatio || 1;
        
        canvas.style.width = `${displayWidth}px`;
        canvas.style.height = `${displayHeight}px`;
        canvas.style.left = `${(window.innerWidth - displayWidth) / 2}px`;
        canvas.style.top = `${(window.innerHeight - displayHeight) / 2}px`;
        
        canvas.width = displayWidth * pixelRatio;
        canvas.height = displayHeight * pixelRatio;
        
        gl.viewport(0, 0, canvas.width, canvas.height);
        
        console.log(`Canvas: ${displayWidth}x${displayHeight} (display), ${canvas.width}x${canvas.height} (buffer), ratio: ${pixelRatio}`);
    }
}

async function capturePhoto() {
    if (!isLutLoaded) {
        showError('LUT non ancora caricata');
        return;
    }
    
    // Attiva il flash per la foto
    const flashActivated = await activateFlashForCapture();
    
    // Piccolo delay per dare tempo al flash di attivarsi
    if (flashActivated) {
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    let captureCanvas = document.createElement('canvas');
    captureCanvas.width = video.videoWidth;
    captureCanvas.height = video.videoHeight;
    let captureGl = captureCanvas.getContext('webgl', { 
        preserveDrawingBuffer: true,
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance'
    });
    
    if (!captureGl) {
        showError('Impossibile creare contesto WebGL per cattura');
        await restoreFlashAfterCapture();
        return;
    }
    
    let captureVertexShader = createShader(captureGl, captureGl.VERTEX_SHADER, vertexShaderSource);
    let captureFragmentShader = createShader(captureGl, captureGl.FRAGMENT_SHADER, fragmentShaderSource);
    let captureProgram = createProgram(captureGl, captureVertexShader, captureFragmentShader);
    
    if (!captureProgram) {
        showError('Errore nella creazione del programma di cattura');
        await restoreFlashAfterCapture();
        return;
    }
    
    captureGl.useProgram(captureProgram);
    
    let capturePositionLocation = captureGl.getAttribLocation(captureProgram, 'a_position');
    let capturePositionBuffer = captureGl.createBuffer();
    captureGl.bindBuffer(captureGl.ARRAY_BUFFER, capturePositionBuffer);
    captureGl.bufferData(captureGl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 1, -1, -1, 1, 1, 1
    ]), captureGl.STATIC_DRAW);
    
    captureGl.enableVertexAttribArray(capturePositionLocation);
    captureGl.vertexAttribPointer(capturePositionLocation, 2, captureGl.FLOAT, false, 0, 0);
    
    let captureVideoTexture = captureGl.createTexture();
    captureGl.activeTexture(captureGl.TEXTURE0);
    captureGl.bindTexture(captureGl.TEXTURE_2D, captureVideoTexture);
    captureGl.texImage2D(captureGl.TEXTURE_2D, 0, captureGl.RGB, captureGl.RGB, captureGl.UNSIGNED_BYTE, video);
    captureGl.texParameteri(captureGl.TEXTURE_2D, captureGl.TEXTURE_WRAP_S, captureGl.CLAMP_TO_EDGE);
    captureGl.texParameteri(captureGl.TEXTURE_2D, captureGl.TEXTURE_WRAP_T, captureGl.CLAMP_TO_EDGE);
    captureGl.texParameteri(captureGl.TEXTURE_2D, captureGl.TEXTURE_MIN_FILTER, captureGl.LINEAR);
    captureGl.texParameteri(captureGl.TEXTURE_2D, captureGl.TEXTURE_MAG_FILTER, captureGl.LINEAR);
    
    let captureLutTexture = captureGl.createTexture();
    captureGl.activeTexture(captureGl.TEXTURE1);
    captureGl.bindTexture(captureGl.TEXTURE_2D, captureLutTexture);
    
    async function finalizeCaptureWithLUT(lutCanvas) {
        captureGl.activeTexture(captureGl.TEXTURE1);
        captureGl.bindTexture(captureGl.TEXTURE_2D, captureLutTexture);
        captureGl.texImage2D(captureGl.TEXTURE_2D, 0, captureGl.RGB, captureGl.RGB, captureGl.UNSIGNED_BYTE, lutCanvas);
        captureGl.texParameteri(captureGl.TEXTURE_2D, captureGl.TEXTURE_WRAP_S, captureGl.CLAMP_TO_EDGE);
        captureGl.texParameteri(captureGl.TEXTURE_2D, captureGl.TEXTURE_WRAP_T, captureGl.CLAMP_TO_EDGE);
        captureGl.texParameteri(captureGl.TEXTURE_2D, captureGl.TEXTURE_MIN_FILTER, captureGl.LINEAR);
        captureGl.texParameteri(captureGl.TEXTURE_2D, captureGl.TEXTURE_MAG_FILTER, captureGl.LINEAR);
        
        captureGl.viewport(0, 0, captureCanvas.width, captureCanvas.height);
        captureGl.clear(captureGl.COLOR_BUFFER_BIT);
        
        captureGl.uniform1i(captureGl.getUniformLocation(captureProgram, 'u_image'), 0);
        captureGl.uniform1i(captureGl.getUniformLocation(captureProgram, 'u_lut'), 1);
        captureGl.uniform1f(captureGl.getUniformLocation(captureProgram, 'u_flipX'), usingFrontCamera ? -1.0 : 1.0);
        captureGl.uniform2f(captureGl.getUniformLocation(captureProgram, 'u_imageSize'), video.videoWidth, video.videoHeight);
        
        captureGl.drawArrays(captureGl.TRIANGLE_STRIP, 0, 4);
        
        let link = document.createElement('a');
        link.href = captureCanvas.toDataURL('image/jpeg', 0.98);
        link.download = `photo_${Date.now()}.jpg`;
        link.click();
        
        // Ripristina lo stato del flash dopo aver completato la cattura
        await restoreFlashAfterCapture();
    }
    
    let lutImage = new Image();
    lutImage.crossOrigin = 'anonymous';
    lutImage.onload = function() {
        finalizeCaptureWithLUT(lutImage);
    };
    lutImage.onerror = function() {
        console.warn('Uso LUT di default per cattura');
        let defaultLUT = createDefaultLUT();
        finalizeCaptureWithLUT(defaultLUT);
    };
    lutImage.src = 'lut.png';
}

function handlePressStart(e) {
    e.preventDefault();
    pressTimer = setTimeout(() => {
        startRecording();
    }, longPressThreshold);
}

function handlePressEnd(e) {
    e.preventDefault();
    clearTimeout(pressTimer);
    if (isRecording) {
        stopRecording();
    } else {
        // Il flash si attiva solo qui, nel momento della cattura
        capturePhoto();
    }
}

async function startRecording() {
    if (!currentStream || !canvas) return;
    
    await activateFlashForCapture();
    
    recordedChunks = [];
    let canvasStream = canvas.captureStream(60);
    let audioTrack = currentStream.getAudioTracks()[0];
    
    if (audioTrack) {
        canvasStream.addTrack(audioTrack);
    }
    
    let options = {
        mimeType: 'video/mp4;codecs=h264,aac',
        videoBitsPerSecond: 8000000
    };
    
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options.mimeType = 'video/mp4';
        console.log('H264 non supportato, uso MP4 di default');
    }
    
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { 
            mimeType: 'video/webm;codecs=vp9',
            videoBitsPerSecond: 8000000
        };
        console.log('MP4 non supportato, uso WebM VP9');
    }
    
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options.mimeType = 'video/webm;codecs=vp8';
        console.log('VP9 non supportato, uso VP8');
    }
    
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: 'video/webm' };
        console.log('Uso codec di default');
    }
    
    try {
        mediaRecorder = new MediaRecorder(canvasStream, options);
        
        mediaRecorder.ondataavailable = function(event) {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };
        
        mediaRecorder.onstop = async function() {
            let mimeType = mediaRecorder.mimeType;
            let extension = 'webm';
            
            if (mimeType.includes('mp4')) {
                extension = 'mp4';
            } else if (mimeType.includes('webm')) {
                extension = 'webm';
            }
            
            let blob = new Blob(recordedChunks, {
                type: mimeType
            });
            let url = URL.createObjectURL(blob);
            let a = document.createElement('a');
            a.href = url;
            a.download = `video_${Date.now()}.${extension}`;
            a.click();
            URL.revokeObjectURL(url);
            
            await restoreFlashAfterCapture();
        };
        
        mediaRecorder.start();
        isRecording = true;
        if (shutter) shutter.classList.add('recording');
        console.log('Registrazione avviata con flash attivato');
    } catch (err) {
        console.error('Errore avvio registrazione:', err);
        showError('Errore durante l\'avvio della registrazione');
        await restoreFlashAfterCapture();
    }
}

function stopRecording() {
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        if (shutter) shutter.classList.remove('recording');
        console.log('Registrazione fermata');
    }
}

function stopAllStreams() {
    if (currentStream) {
        currentStream.getTracks().forEach(track => {
            track.stop();
            console.log('Track fermato:', track.kind);
        });
        currentStream = null;
        currentVideoTrack = null;
        flashEnabled = false;
    }
    
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
    
    if (isRecording && mediaRecorder) {
        mediaRecorder.stop();
        isRecording = false;
    }
}

function handleVisibilityChange() {
    if (document.hidden) {
        stopAllStreams();
    } else {
        setTimeout(() => {
            if (canvas && initWebGL()) {
                startCamera();
            }
        }, 100);
    }
}

// Event listeners
if (switchBtn) {
    switchBtn.addEventListener('click', function() {
        usingFrontCamera = !usingFrontCamera;
        startCamera();
    });
}

if (flashBtn) {
    flashBtn.addEventListener('click', function() {
        toggleFlash();
    });
}

if (shutter) {
    shutter.addEventListener('mousedown', handlePressStart);
    shutter.addEventListener('mouseup', handlePressEnd);
    shutter.addEventListener('mouseleave', handlePressEnd);

    shutter.addEventListener('touchstart', handlePressStart);
    shutter.addEventListener('touchend', handlePressEnd);
    shutter.addEventListener('touchcancel', handlePressEnd);
}

let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(resizeCanvas, 100);
});

document.addEventListener('visibilitychange', handleVisibilityChange);

// Inizializzazione
if (canvas && video) {
    if (initWebGL()) {
        checkCameraCapabilities();
        startCamera();
    } else {
        showError('Impossibile inizializzare WebGL');
    }
} else {
    showError('Elementi HTML necessari non trovati');
}
