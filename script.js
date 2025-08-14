let video = document.getElementById('video');
let canvas = document.getElementById('canvas');
let gl = canvas.getContext('webgl');
let shutter = document.getElementById('shutter');
let switchBtn = document.getElementById('switch');
let currentStream;
let usingFrontCamera = false;

let program;
let positionBuffer;
let lutTexture;
let videoTexture;
let animationId;
let uniformLocations = {};
let isLutLoaded = false;

switchBtn.innerHTML = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<path d="M370.7 133.3C342 104.6 300.9 88 256 88c-66.3 0-122.7 40.2-146.7 97.3L64 160v128h128l-48-48c15.3-51.1 62.5-88 118-88 33.4 0 63.7 13.1 85.7 34.3l23-23zm-229.4 245.4C170 407.4 211.1 424 256 424c66.3 0 122.7-40.2 146.7 97.3L448 352V224H320l48 48c-15.3 51.1-62.5 88-118 88-33.4 0-63.7-13.1-85.7-34.3l-23 23z"/>
</svg>
`;

switchBtn.style.position = 'absolute';
switchBtn.style.bottom = '20px';
switchBtn.style.right = '20px';
switchBtn.style.top = 'auto';

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
        console.error('WebGL non supportato');
        return false;
    }
    
    let vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    let fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    
    if (!vertexShader || !fragmentShader) {
        return false;
    }
    
    program = createProgram(gl, vertexShader, fragmentShader);
    if (!program) {
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
        console.error('Errore caricamento LUT');
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
    
    let constraints = {
        video: { 
            facingMode: usingFrontCamera ? 'user' : 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 60 }
        },
        audio: false
    };
    
    navigator.mediaDevices.getUserMedia(constraints).then(stream => {
        currentStream = stream;
        video.srcObject = stream;
        video.onloadedmetadata = () => {
            video.play();
            resizeCanvas();
            if (!animationId) {
                render();
            }
        };
    }).catch(err => console.error('Errore fotocamera:', err));
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
        console.error('LUT non ancora caricata');
        return;
    }
    
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(canvas.width * canvas.height * 4));
    
    let link = document.createElement('a');
    link.href = canvas.toDataURL('image/jpeg', 0.95);
    link.download = `photo_${Date.now()}.jpg`;
    link.click();
}

switchBtn.addEventListener('click', () => {
    usingFrontCamera = !usingFrontCamera;
    startCamera();
});

shutter.addEventListener('click', capturePhoto);

let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(resizeCanvas, 100);
});

if (initWebGL()) {
    startCamera();
} else {
    console.error('Impossibile inizializzare WebGL');
}
