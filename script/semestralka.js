"use strict";

let vsSource;
let fsSource;
let canvas;
let gl;
let program;
let kernels;
let effects;
let positionLocation;
let texcoordLocation;
let positionBuffer;
let texcoordBuffer;
let originalImageTexture;
let textures;
let framebuffers;
let resolutionLocation;
let textureSizeLocation;
let kernelLocation;
let kernelWeightLocation;
let flipYLocation;
const effectsMenu = document.querySelector("#effectsMenu");
const table = document.createElement("table");
const tbody = document.createElement("tbody");
let size;
let type;
let normalize;
let stride;
let offset;

function main() {
    // Define several convolution kernels
    kernels = {
        normal: [
            0, 0, 0,
            0, 1, 0,
            0, 0, 0
        ],
        unsharpen: [
            -1, -1, -1,
            -1,  9, -1,
            -1, -1, -1
        ],
        sharpness: [
            0,-1, 0,
            -1, 5,-1,
            0,-1, 0
        ],
        edgeDetect: [
            -1, -1, -1,
            -1,  8, -1,
            -1, -1, -1
        ],
        sobelHorizontal: [
            1,  2,  1,
            0,  0,  0,
            -1, -2, -1
        ],
        previtHorizontal: [
            1,  1,  1,
            0,  0,  0,
            -1, -1, -1
        ],
        emboss: [
            -2, -1,  0,
            -1,  1,  1,
            0,  1,  2
        ],
    };

    effects = [
        { name: "sharpness" },
        { name: "unsharpen" },
        { name: "edgeDetect" },
        { name: "sobelHorizontal" },
        { name: "previtHorizontal" },
        { name: "emboss" },
    ];

    drawMenu();

    // Get A WebGL context
    /** @type {HTMLCanvasElement} */
    canvas = document.querySelector("#canvas");
    gl = canvas.getContext("webgl");
    if (!gl) {
        alert("Cannot load webgl context. Your browser probably does not support it.");
        return;
    }

    vsSource = `attribute vec2 a_position;
                attribute vec2 a_texCoord;
                
                uniform vec2 u_resolution;
                uniform float u_flipY;
                
                varying vec2 v_texCoord;
                
                void main() {
                   // convert the rectangle from pixels to 0.0 to 1.0
                   vec2 zeroToOne = a_position / u_resolution;
                
                   // convert from 0->1 to 0->2
                   vec2 zeroToTwo = zeroToOne * 2.0;
                
                   // convert from 0->2 to -1->+1 (clipspace)
                   vec2 clipSpace = zeroToTwo - 1.0;
                
                   gl_Position = vec4(clipSpace * vec2(1, u_flipY), 0, 1);
                
                   // pass the texCoord to the fragment shader
                   // The GPU will interpolate this value between points
                   v_texCoord = a_texCoord;
                }`;

    fsSource = `precision mediump float;

                // our texture
                uniform sampler2D u_image;
                uniform vec2 u_textureSize;
                uniform float u_kernel[9];
                uniform float u_kernelWeight;
                
                // the texCoords passed in from the vertex shader.
                varying vec2 v_texCoord;
                
                void main() {
                   vec2 onePixel = vec2(1.0, 1.0) / u_textureSize;
                   vec4 colorSum =
                     texture2D(u_image, v_texCoord + onePixel * vec2(-1, -1)) * u_kernel[0] +
                     texture2D(u_image, v_texCoord + onePixel * vec2( 0, -1)) * u_kernel[1] +
                     texture2D(u_image, v_texCoord + onePixel * vec2( 1, -1)) * u_kernel[2] +
                     texture2D(u_image, v_texCoord + onePixel * vec2(-1,  0)) * u_kernel[3] +
                     texture2D(u_image, v_texCoord + onePixel * vec2( 0,  0)) * u_kernel[4] +
                     texture2D(u_image, v_texCoord + onePixel * vec2( 1,  0)) * u_kernel[5] +
                     texture2D(u_image, v_texCoord + onePixel * vec2(-1,  1)) * u_kernel[6] +
                     texture2D(u_image, v_texCoord + onePixel * vec2( 0,  1)) * u_kernel[7] +
                     texture2D(u_image, v_texCoord + onePixel * vec2( 1,  1)) * u_kernel[8] ;
                
                   // Divide the sum by the weight but just use rgb
                   // we'll set alpha to 1.0
                   gl_FragColor = vec4((colorSum / u_kernelWeight).rgb, 1.0);
                }`;

    setupProgram();
}

function render(image) {
    // Bind it to ARRAY_BUFFER (think of it as ARRAY_BUFFER = positionBuffer)
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

    // Set a rectangle the same size as the image.
    setRectangle(gl, 0, 0, image.width, image.height);

    // provide texture coordinates for the rectangle.
    texcoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        0.0,  0.0,
        1.0,  0.0,
        0.0,  1.0,
        0.0,  1.0,
        1.0,  0.0,
        1.0,  1.0,
    ]), gl.STATIC_DRAW);

    // Upload the image into the texture.
    originalImageTexture = createAndSetupTexture(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

    // create 2 textures and attach them to framebuffers.
    textures = [];
    framebuffers = [];
    for (let ii = 0; ii < 2; ++ii) {
        const texture = createAndSetupTexture(gl);
        textures.push(texture);

        // make the texture the same size as the image
        gl.texImage2D(
            gl.TEXTURE_2D, 0, gl.RGBA, image.width, image.height, 0,
            gl.RGBA, gl.UNSIGNED_BYTE, null);

        // Create a framebuffer
        const fbo = gl.createFramebuffer();
        framebuffers.push(fbo);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

        // Attach a texture to it.
        gl.framebufferTexture2D(
            gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    }

    // lookup uniforms
    resolutionLocation = gl.getUniformLocation(program, "u_resolution");
    textureSizeLocation = gl.getUniformLocation(program, "u_textureSize");
    kernelLocation = gl.getUniformLocation(program, "u_kernel[0]");
    kernelWeightLocation = gl.getUniformLocation(program, "u_kernelWeight");
    flipYLocation = gl.getUniformLocation(program, "u_flipY");

    drawEffects();
}

function createAndSetupTexture(gl) {
    // Create a texture.
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);

    // Set the parameters so we can render any size image.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    return texture;
}

function computeKernelWeight(kernel) {
    const weight = kernel.reduce(function (prev, curr) {
        return prev + curr;
    });
    return weight <= 0 ? 1 : weight;
}

function drawEffects() {
    // Clear the canvas
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Tell it to use our program (pair of shaders)
    gl.useProgram(program);

    // Turn on the position attribute
    gl.enableVertexAttribArray(positionLocation);

    // Bind the position buffer.
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

    // Tell the position attribute how to get data out of positionBuffer (ARRAY_BUFFER)
    gl.vertexAttribPointer(
        positionLocation, size, type, normalize, stride, offset);

    // Turn on the texcoord attribute
    gl.enableVertexAttribArray(texcoordLocation);

    // bind the texcoord buffer.
    gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBuffer);

    // Tell the texcoord attribute how to get data out of texcoordBuffer (ARRAY_BUFFER)
    gl.vertexAttribPointer(
        texcoordLocation, size, type, normalize, stride, offset);

    // set the size of the image
    gl.uniform2f(textureSizeLocation, image.width, image.height);

    // start with the original image
    gl.bindTexture(gl.TEXTURE_2D, originalImageTexture);

    // don't y flip images while drawing to the textures
    gl.uniform1f(flipYLocation, 1);

    // loop through each effect we want to apply.
    let count = 0;
    for (let ii = 0; ii < tbody.rows.length; ++ii) {
        const checkbox = tbody.rows[ii].firstChild.firstChild;
        if (checkbox.checked) {
            // Setup to draw into one of the framebuffers.
            setFramebuffer(framebuffers[count % 2], image.width, image.height);

            drawWithKernel(checkbox.value);

            // for the next draw, use the texture we just rendered to.
            gl.bindTexture(gl.TEXTURE_2D, textures[count % 2]);

            // increment count so we use the other texture next time.
            ++count;
        }
    }

    // finally draw the result to the canvas.
    gl.uniform1f(flipYLocation, -1);  // need to y flip for canvas
    setFramebuffer(null, gl.canvas.width, gl.canvas.height);
    drawWithKernel("normal");
}

function setFramebuffer(fbo, width, height) {
    // make this the framebuffer we are rendering to.
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

    // Tell the shader the resolution of the framebuffer.
    gl.uniform2f(resolutionLocation, width, height);

    // Tell webgl the viewport setting needed for framebuffer.
    gl.viewport(0, 0, width, height);
}

function drawWithKernel(name) {
    // set the kernel and it's weight
    gl.uniform1fv(kernelLocation, kernels[name]);
    gl.uniform1f(kernelWeightLocation, computeKernelWeight(kernels[name]));

    // Draw the rectangle.
    const primitiveType = gl.TRIANGLES;
    const offset = 0;
    const count = 6;
    gl.drawArrays(primitiveType, offset, count);
}

// Fill the buffer with the values that define a rectangle.
function setRectangle(gl, x, y, width, height) {
    const x1 = x;
    const x2 = x + width;
    const y1 = y;
    const y2 = y + height;
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        x1, y1,
        x2, y1,
        x1, y2,
        x1, y2,
        x2, y1,
        x2, y2,
    ]), gl.STATIC_DRAW);
}

function setupProgram() {
    // Tell the position attribute how to get data out of positionBuffer (ARRAY_BUFFER)
    // Tell the texcoord attribute how to get data out of texcoordBuffer (ARRAY_BUFFER)
    size = 2;          // 2 components per iteration
    type = gl.FLOAT;;   // the data is 32bit floats
    normalize = false; // don't normalize the data
    stride = 0;        // 0 = move forward size * sizeof(type) each iteration to get the next position
    offset = 0;        // start at the beginning of the buffer

    // setup GLSL program
    program = initShaderProgram(gl, vsSource, fsSource);

    // look up where the vertex data needs to go.
    positionLocation = gl.getAttribLocation(program, "a_position");
    texcoordLocation = gl.getAttribLocation(program, "a_texCoord");

    // Create a buffer to put three 2d clip space points in
    positionBuffer = gl.createBuffer();
}

//
// Initialize a shader program, so WebGL knows how to draw our data
//
function initShaderProgram(gl, vsSource, fsSource) {
    const vertexShader = loadShader(gl, gl.VERTEX_SHADER, vsSource);
    const fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, fsSource);

    // Create the shader program
    const shaderProgram = gl.createProgram();
    gl.attachShader(shaderProgram, vertexShader);
    gl.attachShader(shaderProgram, fragmentShader);
    gl.linkProgram(shaderProgram);

    return shaderProgram;
}

//
// creates a shader of the given type, uploads the source and
// compiles it.
//
function loadShader(gl, type, source) {
    const shader = gl.createShader(type);

    // Send the source to the shader object
    gl.shaderSource(shader, source);

    // Compile the shader program
    gl.compileShader(shader);

    return shader;
}

function drawMenu() {
    for (let i = 0; i < effects.length; i++) {
        const effect = effects[i];
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        const input = document.createElement("input");
        input.value = effect.name;
        input.type = "checkbox";
        input.onchange = drawEffects;
        td.appendChild(input);
        td.appendChild(document.createTextNode(effect.name));
        tr.appendChild(td);
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    effectsMenu.appendChild(table);
}

main();