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
switchBtn.innerHTML = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<path d="M370.7 133.3C342 104.6 300.9 88 256 88c-66.3 0-122.7 40.2-146.7 97.3L64 160v128h128l-48-48c15.3-51.1 62.5-88 118-88 33.4 0 63.7 13.1 85.7 34.3l23-23zm-229.4 245.4C170 407.4 211.1 424 256 424c66.3 0 122.7-40.2 146.7-97.3L448 352V224H320l48 48c-15.3 51.1-62.5 88-118 88-33.4 0-63.7-13.1-85.7-34.3l-23 23z"/>
</svg>
`;

switchBtn.style.position = 'absolute';
switchBtn.style.bottom = '20px';
switchBtn.style.right = '20px';
switchBtn.style.top = 'auto';

function createShader(type, source) {
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

function createProgram(vertexShader, fragmentShader) {
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

function initWebGL() {
    if (!gl) {
        console.error('WebGL non supportato');
        return false;
    }
    
    // Crea shader
    let vertexShader = createShader(gl.VERTEX_SHADER, vertexShaderSource);
    let fragmentShader = createShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
    
    if (!vertexShader || !fragmentShader) {
        return false;
    }
    
    // Crea program
    program = createProgram(vertexShader, fragmentShader);
    if (!program) {
        return false;
    }
    
    // Setup attributi e uniform
    let positionLocation = gl.getAttribLocation(program, 'a_position');
    
    // Crea buffer per il quad fullscreen
    positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1,
         1, -1,
        -1,  1,
         1,  1
    ]), gl.STATIC_DRAW);
    
    // Enable attributo position
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    
    // Crea texture per il video
    videoTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, videoTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    
    // Carica LUT
    loadLUT();
    
    return true;
}

function loadLUT() {
    lutTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, lutTexture);
    
    let lutImage = new Image();
    lutImage.crossOrigin = 'anonymous';
    lutImage.onload = function() {
        gl.bindTexture(gl.TEXTURE_2D, lutTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, lutImage);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        console.log('LUT caricata');
    };
    lutImage.onerror = function() {
        console.error('Errore caricamento LUT');
    };
    lutImage.src = 'lut.png';
}

function render() {
    if (!video.videoWidth || !video.videoHeight) {
        animationId = requestAnimationFrame(render);
        return;
    }
    
    gl.bindTexture(gl.TEXTURE_2D, videoTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
    
    gl.viewport(0, 0, canvas.width, canvas.height);
    
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    gl.useProgram(program);
    
    let flipLocation = gl.getUniformLocation(program, 'u_flipX');
    if (flipLocation) {
        gl.uniform1f(flipLocation, usingFrontCamera ? -1.0 : 1.0);
    }
    
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, videoTexture);
    gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0);
    
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, lutTexture);
    gl.uniform1i(gl.getUniformLocation(program, 'u_lut'), 1);
    
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    
    animationId = requestAnimationFrame(render);
}

function startCamera() {
    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
    }
    
    navigator.mediaDevices.getUserMedia({
        video: { 
            facingMode: usingFrontCamera ? 'user' : 'environment',
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 },
            frameRate: { ideal: 30 }
        },
        audio: false
    }).then(stream => {
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
        
        if (gl) {
            gl.viewport(0, 0, canvas.width, canvas.height);
        }
    }
}

function capturePhoto() {
    let tempCanvas = document.createElement('canvas');
    tempCanvas.width = video.videoWidth;
    tempCanvas.height = video.videoHeight;
    let tempGl = tempCanvas.getContext('webgl');
    
    if (!tempGl) {
        console.error('Impossibile creare contesto WebGL temporaneo');
        return;
    }
    
    let tempVertexShader = createShader(tempGl.VERTEX_SHADER, vertexShaderSource);
    let tempFragmentShader = createShader(tempGl.FRAGMENT_SHADER, fragmentShaderSource);
    let tempProgram = createProgram(tempVertexShader, tempFragmentShader);
    
    let tempPositionBuffer = tempGl.createBuffer();
    tempGl.bindBuffer(tempGl.ARRAY_BUFFER, tempPositionBuffer);
    tempGl.bufferData(tempGl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 1, -1, -1, 1, 1, 1
    ]), tempGl.STATIC_DRAW);
    
    let positionLocation = tempGl.getAttribLocation(tempProgram, 'a_position');
    tempGl.enableVertexAttribArray(positionLocation);
    tempGl.vertexAttribPointer(positionLocation, 2, tempGl.FLOAT, false, 0, 0);
    
    let tempVideoTexture = tempGl.createTexture();
    tempGl.bindTexture(tempGl.TEXTURE_2D, tempVideoTexture);
    tempGl.texImage2D(tempGl.TEXTURE_2D, 0, tempGl.RGB, tempGl.RGB, tempGl.UNSIGNED_BYTE, video);
    tempGl.texParameteri(tempGl.TEXTURE_2D, tempGl.TEXTURE_WRAP_S, tempGl.CLAMP_TO_EDGE);
    tempGl.texParameteri(tempGl.TEXTURE_2D, tempGl.TEXTURE_WRAP_T, tempGl.CLAMP_TO_EDGE);
    tempGl.texParameteri(tempGl.TEXTURE_2D, tempGl.TEXTURE_MIN_FILTER, tempGl.LINEAR);
    tempGl.texParameteri(tempGl.TEXTURE_2D, tempGl.TEXTURE_MAG_FILTER, tempGl.LINEAR);
    
    let tempLutTexture = tempGl.createTexture();
    tempGl.bindTexture(tempGl.TEXTURE_2D, tempLutTexture);
    let lutCanvas = document.createElement('canvas');
    let lutCtx = lutCanvas.getContext('2d');
    
    tempGl.viewport(0, 0, tempCanvas.width, tempCanvas.height);
    tempGl.clear(tempGl.COLOR_BUFFER_BIT);
    tempGl.useProgram(tempProgram);
    
    tempGl.activeTexture(tempGl.TEXTURE0);
    tempGl.bindTexture(tempGl.TEXTURE_2D, tempVideoTexture);
    tempGl.uniform1i(tempGl.getUniformLocation(tempProgram, 'u_image'), 0);
    
    tempGl.activeTexture(tempGl.TEXTURE1);
    tempGl.bindTexture(tempGl.TEXTURE_2D, lutTexture);
    tempGl.uniform1i(tempGl.getUniformLocation(tempProgram, 'u_lut'), 1);
    
    tempGl.drawArrays(tempGl.TRIANGLE_STRIP, 0, 4);
    
    let link = document.createElement('a');
    link.href = tempCanvas.toDataURL('image/jpeg', 1.0);
    link.download = `photo_${Date.now()}.jpg`;
    link.click();
}

switchBtn.addEventListener('click', () => {
    usingFrontCamera = !usingFrontCamera;
    startCamera();
});

shutter.addEventListener('click', capturePhoto);

window.addEventListener('resize', resizeCanvas);

if (initWebGL()) {
    startCamera();
} else {
    console.error('Impossibile inizializzare WebGL');
}
