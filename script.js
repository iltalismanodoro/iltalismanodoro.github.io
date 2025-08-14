const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const shutter = document.getElementById('shutter');
let gl;

navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
  .then(stream => { video.srcObject = stream; video.play(); });

function resizeCanvas() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const targetRatio = 9 / 16;
  let width, height;

  if (vw / vh > targetRatio) {
    height = vh;
    width = vh * targetRatio;
  } else {
    width = vw;
    height = vw / targetRatio;
  }

  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  canvas.width = width;
  canvas.height = height;
  if (gl) gl.viewport(0, 0, width, height);
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Inizializzazione WebGL
function initWebGL() {
  gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
  // Qui inserisci il resto della tua pipeline WebGL (shader, texture video, LUT, ecc.)
}

video.addEventListener('play', () => {
  initWebGL();
  requestAnimationFrame(drawFrame); // drawFrame contiene il render loop WebGL
});

// Salvataggio automatico all'evento click del pulsante
shutter.addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = `photo_${Date.now()}.jpg`;
  link.href = canvas.toDataURL('image/jpeg', 0.95);
  link.click();
});
