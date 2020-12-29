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
        { name: "emboss" },
    ];

    drawMenu();

    // Get A WebGL context
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

// Draw image to canvas
function render(image) {
    // Bind positionBuffer to ARRAY_BUFFER
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

    // Set a rectangle the same size as the image
    setRectangle(gl, 0, 0, image.width, image.height);

    // Provide texture coordinates for the rectangle
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

    // Upload the image into the texture
    originalImageTexture = createAndSetupTexture(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

    // Create 2 textures and attach them to framebuffers
    textures = [];
    framebuffers = [];
    for (let ii = 0; ii < 2; ++ii) {
        const texture = createAndSetupTexture(gl);
        textures.push(texture);

        // Make the texture the same size as the image
        gl.texImage2D(
            gl.TEXTURE_2D, 0, gl.RGBA, image.width, image.height, 0,
            gl.RGBA, gl.UNSIGNED_BYTE, null);

        // Create a framebuffer
        const framebuffer = gl.createFramebuffer();
        framebuffers.push(framebuffer);
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

        // Attach a texture to it.
        gl.framebufferTexture2D(
            gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    }

    // Lookup uniforms
    resolutionLocation = gl.getUniformLocation(program, "u_resolution");
    textureSizeLocation = gl.getUniformLocation(program, "u_textureSize");
    kernelLocation = gl.getUniformLocation(program, "u_kernel[0]");
    kernelWeightLocation = gl.getUniformLocation(program, "u_kernelWeight");
    flipYLocation = gl.getUniformLocation(program, "u_flipY");

    drawEffects();
}

function createAndSetupTexture(gl) {
    // Create a texture
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);

    // Set the parameters so we can render any size image
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

// For each checked filter, draw its effect
function drawEffects() {
    // Tell WebGL to use our program (pair of shaders)
    gl.useProgram(program);

    // Turn on the position attribute
    gl.enableVertexAttribArray(positionLocation);

    // Bind the position buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

    // Tell the position attribute how to get data out of positionBuffer
    gl.vertexAttribPointer(
        positionLocation, size, type, normalize, stride, offset);

    // Turn on the texcoord attribute
    gl.enableVertexAttribArray(texcoordLocation);

    // Bind the texcoord buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBuffer);

    // Tell the texcoord attribute how to get data out of texcoordBuffer
    gl.vertexAttribPointer(
        texcoordLocation, size, type, normalize, stride, offset);

    // Set the size of the image
    gl.uniform2f(textureSizeLocation, image.width, image.height);

    // Start with the original image
    gl.bindTexture(gl.TEXTURE_2D, originalImageTexture);

    // Don't y flip images while drawing to the textures
    gl.uniform1f(flipYLocation, 1);

    // Loop through each effect we want to apply
    let count = 0;
    for (let i = 0; i < tbody.rows.length; i++) {
        const checkbox = tbody.rows[i].firstChild.firstChild;
        if (checkbox.checked) {
            // Setup to draw into one of the framebuffers
            setFramebuffer(framebuffers[count % 2], image.width, image.height);

            drawWithKernel(checkbox.value);

            // For the next draw, use the texture we just rendered to
            gl.bindTexture(gl.TEXTURE_2D, textures[count % 2]);

            // Increment count so we use the other texture next time
            count++;
        }
    }

    // Draw the result to the canvas
    gl.uniform1f(flipYLocation, -1);  // need to y flip for canvas
    setFramebuffer(null, gl.canvas.width, gl.canvas.height);
    drawWithKernel("normal");
}

function setFramebuffer(framebuffer, width, height) {
    // Make this the framebuffer we are rendering to
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

    // Tell the shader the resolution of the framebuffer
    gl.uniform2f(resolutionLocation, width, height);
}

function drawWithKernel(name) {
    // Set the kernel and its weight
    gl.uniform1fv(kernelLocation, kernels[name]);
    gl.uniform1f(kernelWeightLocation, computeKernelWeight(kernels[name]));

    // Draw the rectangle
    gl.drawArrays(gl.TRIANGLES, 0, 6);
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

// Initialize WebGL program
function setupProgram() {
    // Tell the position/texcoord attribute how to get data out of positionBuffer/texcoordBuffer
    size = 2;          // 2 components per iteration
    type = gl.FLOAT;   // the data is 32bit floats
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

// Initialize a shader program, so WebGL knows how to draw the data
function initShaderProgram(gl, vsSource, fsSource) {
    const vertexShader = loadShader(gl, gl.VERTEX_SHADER, vsSource);
    const fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, fsSource);

    // Create the shader program
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    return program;
}


// Creates a shader of the given type, uploads the source and compiles it
function loadShader(gl, type, source) {
    const shader = gl.createShader(type);

    // Send the source to the shader object
    gl.shaderSource(shader, source);

    // Compile the shader program
    gl.compileShader(shader);

    return shader;
}

// Draw UI for user input
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