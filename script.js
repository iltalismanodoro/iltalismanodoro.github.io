let video = document.getElementById('video');
let canvas = document.getElementById('canvas');
let gl = canvas.getContext('webgl');
let shutter = document.getElementById('shutter');
let switchBtn = document.getElementById('switch');

let currentStream;
let usingFrontCamera = false;

// Inserisci SVG frecce circolari nel bottone
switchBtn.innerHTML = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<path d="M370.7 133.3C342 104.6 300.9 88 256 88c-66.3 0-122.7 40.2-146.7 97.3L64 160v128h128l-48-48c15.3-51.1 62.5-88 118-88 33.4 0 63.7 13.1 85.7 34.3l23-23zm-229.4 245.4C170 407.4 211.1 424 256 424c66.3 0 122.7-40.2 146.7-97.3L448 352V224H320l48 48c-15.3 51.1-62.5 88-118 88-33.4 0-63.7-13.1-85.7-34.3l-23 23z"/>
</svg>
`;

function startCamera() {
    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
    }

    navigator.mediaDevices.getUserMedia({
        video: { facingMode: usingFrontCamera ? 'user' : 'environment' },
        audio: false
    }).then(stream => {
        currentStream = stream;
        video.srcObject = stream;
        video.onloadedmetadata = () => {
            video.play();
            resizeCanvas();
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
            canvas.width = window.innerWidth;
            canvas.height = window.innerWidth / aspect;
        } else {
            canvas.height = window.innerHeight;
            canvas.width = window.innerHeight * aspect;
        }
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        gl.viewport(0, 0, canvas.width, canvas.height);
    }
}

switchBtn.addEventListener('click', () => {
    usingFrontCamera = !usingFrontCamera;
    startCamera();
});

shutter.addEventListener('click', () => {
    let imageCanvas = document.createElement('canvas');
    imageCanvas.width = video.videoWidth;
    imageCanvas.height = video.videoHeight;
    let ctx = imageCanvas.getContext('2d');
    ctx.drawImage(video, 0, 0, imageCanvas.width, imageCanvas.height);

    let link = document.createElement('a');
    link.href = imageCanvas.toDataURL('image/jpeg');
    link.download = 'photo.jpg';
    link.click();
});

window.addEventListener('resize', resizeCanvas);

startCamera();
