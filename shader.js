const vertexShaderSource = `
attribute vec2 a_position;
varying vec2 v_texCoord;
void main() {
    v_texCoord = (a_position + 1.0) / 2.0;
    gl_Position = vec4(a_position, 0, 1);
}
`;

const fragmentShaderSource = `
precision mediump float;
uniform sampler2D u_image;
uniform sampler2D u_lut;
varying vec2 v_texCoord;
void main() {
    vec4 color = texture2D(u_image, v_texCoord);
    float blueColor = color.b * 63.0;
    vec2 quad1;
    quad1.y = floor(floor(blueColor) / 8.0);
    quad1.x = floor(blueColor) - (quad1.y * 8.0);
    vec2 texPos1;
    texPos1.x = (quad1.x * 64.0 + color.r * 63.0 + 0.5) / 512.0;
    texPos1.y = (quad1.y * 64.0 + color.g * 63.0 + 0.5) / 512.0;
    gl_FragColor = texture2D(u_lut, texPos1);
}
`;
