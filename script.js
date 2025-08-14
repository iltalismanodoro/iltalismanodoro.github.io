// Variables
let video = document.getElementById('video');
let canvas = document.getElementById('canvas');
let gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
let shutter = document.getElementById('shutter');
let switchBtn = document.getElementById('switch');
let errorMessage = document.getElementById('error-message');
let currentStream;
let usingFrontCamera = false;

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

// Error handling function
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
    // Crea una LUT di default se il file non viene trovato
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
            data[index] = x / size * 255;     // R
            data[index + 1] = y / size * 255; // G  
            data[index + 2] = 128;            // B
            data[index + 3] = 255;            // A
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
        // Usa una LUT di default se il file non viene trovato
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
    if (!video.videoWidth || !video.videoHeight || !isLutLoaded) {
        animationId = requestAnimationFrame(render);
        return;
    }
    
    gl.activeTexture(gl.TEXTURE0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
    
    gl.uniform1f(uniformLocations.flipX, usingFrontCamera ? -1.0 : 1.0);
    
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    
    animationId = requestAnimationFrame(render);
}

function startCamera() {
    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
    }
    
    // Richiedi audio solo se supporta MediaRecorder
    let needsAudio = typeof MediaRecorder !== 'undefined';
    
    let constraints = {
        video: { 
            facingMode: usingFrontCamera ? 'user' : 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 }
        },
        audio: needsAudio
    };
    
    navigator.mediaDevices.getUserMedia(constraints).then(stream => {
        currentStream = stream;
        video.srcObject = stream;
        video.muted = true; // Silenzia l'anteprima video
        video.onloadedmetadata = () => {
            video.play();
            resizeCanvas();
            if (!animationId) {
                render();
            }
        };
    }).catch(err => {
        console.error('Errore fotocamera:', err);
        showError('Impossibile accedere alla fotocamera');
    });
}

function resizeCanvas() {
    let vw = video.videoWidth;
    let vh = video.videoHeight;
    
    if (vw && vh) {
        let aspect = vw / vh;
        let windowAspect = window.innerWidth / window.innerHeight;
        
        if (windowAspect > aspect) {
            canvas.height = window.innerHeight;
            canvas.width = window.innerHeight * aspect;
        } else {
            canvas.width = window.innerWidth;
            canvas.height = window.innerWidth / aspect;
        }
        
        canvas.style.left = `${(window.innerWidth - canvas.width) / 2}px`;
        canvas.style.top = `${(window.innerHeight - canvas.height) / 2}px`;
        canvas.style.width = `${canvas.width}px`;
        canvas.style.height = `${canvas.height}px`;
        
        gl.viewport(0, 0, canvas.width, canvas.height);
    }
}

function capturePhoto() {
    if (!isLutLoaded) {
        showError('LUT non ancora caricata');
        return;
    }
    
    let captureCanvas = document.createElement('canvas');
    captureCanvas.width = video.videoWidth;
    captureCanvas.height = video.videoHeight;
    let captureGl = captureCanvas.getContext('webgl', { preserveDrawingBuffer: true });
    
    if (!captureGl) {
        showError('Impossibile creare contesto WebGL per cattura');
        return;
    }
    
    let captureVertexShader = createShader(captureGl, captureGl.VERTEX_SHADER, vertexShaderSource);
    let captureFragmentShader = createShader(captureGl, captureGl.FRAGMENT_SHADER, fragmentShaderSource);
    let captureProgram = createProgram(captureGl, captureVertexShader, captureFragmentShader);
    
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
    
    let lutImage = new Image();
    lutImage.crossOrigin = 'anonymous';
    lutImage.onload = function() {
        captureGl.activeTexture(captureGl.TEXTURE1);
        captureGl.bindTexture(captureGl.TEXTURE_2D, captureLutTexture);
        captureGl.texImage2D(captureGl.TEXTURE_2D, 0, captureGl.RGB, captureGl.RGB, captureGl.UNSIGNED_BYTE, lutImage);
        captureGl.texParameteri(captureGl.TEXTURE_2D, captureGl.TEXTURE_WRAP_S, captureGl.CLAMP_TO_EDGE);
        captureGl.texParameteri(captureGl.TEXTURE_2D, captureGl.TEXTURE_WRAP_T, captureGl.CLAMP_TO_EDGE);
        captureGl.texParameteri(captureGl.TEXTURE_2D, captureGl.TEXTURE_MIN_FILTER, captureGl.LINEAR);
        captureGl.texParameteri(captureGl.TEXTURE_2D, captureGl.TEXTURE_MAG_FILTER, captureGl.LINEAR);
        
        captureGl.viewport(0, 0, captureCanvas.width, captureCanvas.height);
        captureGl.clear(captureGl.COLOR_BUFFER_BIT);
        
        captureGl.uniform1i(captureGl.getUniformLocation(captureProgram, 'u_image'), 0);
        captureGl.uniform1i(captureGl.getUniformLocation(captureProgram, 'u_lut'), 1);
        captureGl.uniform1f(captureGl.getUniformLocation(captureProgram, 'u_flipX'), usingFrontCamera ? -1.0 : 1.0);
        
        captureGl.drawArrays(captureGl.TRIANGLE_STRIP, 0, 4);
        
        let link = document.createElement('a');
        link.href = captureCanvas.toDataURL('image/jpeg', 0.95);
        link.download = `photo_${Date.now()}.jpg`;
        link.click();
    };
    lutImage.onerror = function() {
        // Fallback con LUT di default
        let defaultLUT = createDefaultLUT();
        captureGl.activeTexture(captureGl.TEXTURE1);
        captureGl.bindTexture(captureGl.TEXTURE_2D, captureLutTexture);
        captureGl.texImage2D(captureGl.TEXTURE_2D, 0, captureGl.RGB, captureGl.RGB, captureGl.UNSIGNED_BYTE, defaultLUT);
        captureGl.texParameteri(captureGl.TEXTURE_2D, captureGl.TEXTURE_WRAP_S, captureGl.CLAMP_TO_EDGE);
        captureGl.texParameteri(captureGl.TEXTURE_2D, captureGl.TEXTURE_WRAP_T, captureGl.CLAMP_TO_EDGE);
        captureGl.texParameteri(captureGl.TEXTURE_2D, captureGl.TEXTURE_MIN_FILTER, captureGl.LINEAR);
        captureGl.texParameteri(captureGl.TEXTURE_2D, captureGl.TEXTURE_MAG_FILTER, captureGl.LINEAR);
        
        captureGl.viewport(0, 0, captureCanvas.width, captureCanvas.height);
        captureGl.clear(captureGl.COLOR_BUFFER_BIT);
        
        captureGl.uniform1i(captureGl.getUniformLocation(captureProgram, 'u_image'), 0);
        captureGl.uniform1i(captureGl.getUniformLocation(captureProgram, 'u_lut'), 1);
        captureGl.uniform1f(captureGl.getUniformLocation(captureProgram, 'u_flipX'), usingFrontCamera ? -1.0 : 1.0);
        
        captureGl.drawArrays(captureGl.TRIANGLE_STRIP, 0, 4);
        
        let link = document.createElement('a');
        link.href = captureCanvas.toDataURL('image/jpeg', 0.95);
        link.download = `photo_${Date.now()}.jpg`;
        link.click();
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
        capturePhoto();
    }
}

function startRecording() {
    if (!currentStream) return;
    
    recordedChunks = [];
    let canvasStream = canvas.captureStream(30);
    let audioTrack = currentStream.getAudioTracks()[0];
    
    if (audioTrack) {
        canvasStream.addTrack(audioTrack);
    }
    
    mediaRecorder = new MediaRecorder(canvasStream, {
        mimeType: 'video/webm'
    });
    
    mediaRecorder.ondataavailable = function(event) {
        if (event.data.size > 0) {
            recordedChunks.push(event.data);
        }
    };
    
    mediaRecorder.onstop = function() {
        let blob = new Blob(recordedChunks, {
            type: 'video/webm'
        });
        let url = URL.createObjectURL(blob);
        let a = document.createElement('a');
        a.href = url;
        a.download = `video_${Date.now()}.webm`;
        a.click();
        URL.revokeObjectURL(url);
    };
    
    mediaRecorder.start();
    isRecording = true;
    shutter.classList.add('recording');
}

function stopRecording() {
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        shutter.classList.remove('recording');
    }
}

function stopAllStreams() {
    if (currentStream) {
        currentStream.getTracks().forEach(track => {
            track.stop();
            console.log('Track fermato:', track.kind);
        });
        currentStream = null;
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
            if (initWebGL()) {
                startCamera();
            }
        }, 100);
    }
}

// Event Listeners
if (switchBtn) {
    switchBtn.addEventListener('click', function() {
        usingFrontCamera = !usingFrontCamera;
        startCamera();
    });
}

// Gestione eventi touch e mouse per lo shutter
if (shutter) {
    shutter.addEventListener('mousedown', handlePressStart);
    shutter.addEventListener('mouseup', handlePressEnd);
    shutter.addEventListener('mouseleave', handlePressEnd);

    shutter.addEventListener('touchstart', handlePressStart);
    shutter.addEventListener('touchend', handlePressEnd);
    shutter.addEventListener('touchcancel', handlePressEnd);
}

// Event listener per il ridimensionamento della finestra
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(resizeCanvas, 100);
});

// Event listener per il cambio di visibilità della pagina
document.addEventListener('visibilitychange', handleVisibilityChange);

// Inizializzazione
if (initWebGL()) {
    startCamera();
} else {
    showError('Impossibile inizializzare WebGL');
}
