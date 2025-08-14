const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const shutterButton = document.getElementById('shutter-button');

async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.srcObject = stream;
    } catch (err) {
        console.error("Errore fotocamera:", err);
    }
}

function applyLUTAndSave() {
    const targetWidth = 1080; // proporzione 9:16
    const targetHeight = 1920;
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');

    // Sfondo nero
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, targetWidth, targetHeight);

    // Disegna il video centrato
    const videoRatio = video.videoWidth / video.videoHeight;
    const targetRatio = targetWidth / targetHeight;
    let drawWidth, drawHeight;

    if (videoRatio > targetRatio) {
        drawHeight = targetHeight;
        drawWidth = videoRatio * drawHeight;
    } else {
        drawWidth = targetWidth;
        drawHeight = drawWidth / videoRatio;
    }

    const offsetX = (targetWidth - drawWidth) / 2;
    const offsetY = (targetHeight - drawHeight) / 2;

    ctx.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);

    // Applica LUT (semplice versione simulata)
    const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
    const lutImg = document.createElement('img');
    lutImg.src = 'luts/film.png';
    lutImg.onload = () => {
        const lutCanvas = document.createElement('canvas');
        lutCanvas.width = 512;
        lutCanvas.height = 512;
        const lutCtx = lutCanvas.getContext('2d');
        lutCtx.drawImage(lutImg, 0, 0);
        const lutData = lutCtx.getImageData(0, 0, 512, 512).data;

        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            // Mappatura base RGB -> LUT
            const lutX = r % 512;
            const lutY = Math.floor(g / 255 * 511);
            const lutIndex = (lutY * 512 + lutX) * 4;

            data[i] = lutData[lutIndex];
            data[i + 1] = lutData[lutIndex + 1];
            data[i + 2] = lutData[lutIndex + 2];
        }

        ctx.putImageData(imageData, 0, 0);

        // Salva immagine
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/jpeg', 0.95);
        link.download = `foto_${Date.now()}.jpg`;
        link.click();
    };
}

shutterButton.addEventListener('click', applyLUTAndSave);

startCamera();
