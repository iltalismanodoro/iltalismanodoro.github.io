const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const shutter = document.getElementById('shutter');
let gl, program, positionBuffer, imageLocation, lutLocation;

navigator.mediaDevices.getUserMedia({ video: { aspectRatio: 9/16 }, audio: false }).then(stream => {
  video.srcObject = stream;
});

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

function createProgram(gl, vertexShader, fragmentShader) {
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  return program;
}

video.addEventListener('play', () => {
  canvas.width = 1080;
  canvas.height = 1920;
  gl = canvas.getContext('webgl');
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
  program = createProgram(gl, vertexShader, fragmentShader);
  gl.useProgram(program);

  const positionLocation = gl.getAttribLocation(program, 'a_position');
  positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,
    1, -1,
    -1, 1,
    -1, 1,
    1, -1,
    1, 1,
  ]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

  imageLocation = gl.getUniformLocation(program, 'u_image');
  lutLocation = gl.getUniformLocation(program, 'u_lut');

  const lutImage = new Image();
  lutImage.src = 'luts/film.png';
  lutImage.onload = () => {
    const lutTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, lutTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, lutImage);
    gl.generateMipmap(gl.TEXTURE_2D);
    drawFrame();
  };
});

function drawFrame() {
  const videoTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, videoTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, videoTexture);
  gl.uniform1i(imageLocation, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.uniform1i(lutLocation, 1);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  requestAnimationFrame(drawFrame);
}

shutter.addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = 'photo.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
});
