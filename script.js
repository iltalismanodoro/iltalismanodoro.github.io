let video = document.getElementById('video');
let canvas = document.getElementById('canvas');
let shutter = document.getElementById('shutter');
let switchBtn = document.getElementById('switch');
let gl = canvas.getContext('webgl');
let stream;
let currentFacingMode = 'environment';

// Avvio fotocamera
async function startCamera() {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: currentFacingMode }
    });
    video.srcObject = stream;

    video.onloadedmetadata = () => {
      video.play();
      resizeCanvas();
    };
  } catch (err) {
    console.error("Errore accesso fotocamera:", err);
  }
}

function resizeCanvas() {
  if (!video.videoWidth || !video.videoHeight) return;

  let aspect = video.videoWidth / video.videoHeight;
  let winAspect = window.innerWidth / window.innerHeight;

  if (winAspect > aspect) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerWidth / aspect;
  } else {
    canvas.height = window.innerHeight;
    canvas.width = window.innerHeight * aspect;
  }

  canvas.style.left = `${(window.innerWidth - canvas.width) / 2}px`;
  canvas.style.top = `${(window.innerHeight - canvas.height) / 2}px`;

  gl.viewport(0, 0, canvas.width, canvas.height);
}

window.addEventListener('resize', resizeCanvas);

// Cambio camera
switchBtn.addEventListener('click', () => {
  currentFacingMode = (currentFacingMode === 'environment') ? 'user' : 'environment';
  startCamera();
});

// Scatto con download automatico e fix immagine nera
shutter.addEventListener('click', () => {
  let tempCanvas = document.createElement('canvas');
  tempCanvas.width = video.videoWidth;
  tempCanvas.height = video.videoHeight;
  let ctx = tempCanvas.getContext('2d');
  ctx.drawImage(video, 0, 0);

  // Evita salvataggio immagine nera
  if (ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height)
        .data.some(channel => channel !== 0)) {
    let link = document.createElement('a');
    link.download = `foto_${Date.now()}.png`;
    link.href = tempCanvas.toDataURL('image/png');
    link.click();
  } else {
    console.warn("Foto non scattata: immagine nera.");
  }
});

startCamera();
