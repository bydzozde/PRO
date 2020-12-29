let image = new Image();
let video;
let auxCanvas;
let auxCtx;
let width;
let height;
let isHorizontalVideo = false; // For future extension (user input)
let vRatio;
let hRatio;

function main() {
    doLoad();
}

// Draw image while video is playing
function timerCallback() {
    if (video.paused || video.ended) {
        return;
    }
    drawImage();

    requestAnimationFrame(timerCallback);
}

// Load elements and add event listener on video
function doLoad() {
    video = document.getElementById("video");
    auxCanvas = document.getElementById("aux-canvas");
    auxCtx = auxCanvas.getContext("2d");

    video.addEventListener("play", function() {
        width = video.width;
        height = video.height;
        timerCallback();
    }, false);
}

// Draw image to auxiliary canvas and calls WebGL to render modified image
function drawImage() {
    adjustImage(isHorizontalVideo);

    image.crossOrigin = "anonymous"; // enable WebGL
    image.src = auxCanvas.toDataURL();
    render(image);
}

// Adjust size of image to match the original image
function adjustImage(isHorizontal) {
    if (isHorizontal) {
        // fill horizontally - for horizontal filmed videos
        hRatio = (auxCanvas.width / video.videoWidth) * video.videoHeight;
        auxCtx.drawImage(video, 0, 0, auxCanvas.width, hRatio);
    } else {
        // fill vertically - for vertical filmed videos
        vRatio = (auxCanvas.height / video.videoHeight) * video.videoWidth;
        auxCtx.drawImage(video, 0, 0, vRatio, auxCanvas.height);
    }
}

main();