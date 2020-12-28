let image = new Image();
image.crossOrigin = "anonymous";
let video;
let c1;
let ctx1;
let width;
let height;
let isHorizontalVideo = false; // For future extension
let vRatio;
let hRatio;

function main() {
    doLoad();
}

function timerCallback() {
    if (video.paused || video.ended) {
        return;
    }
    computeFrame();
    setTimeout(function () {
        timerCallback();
    }, 5);
}

function doLoad() {
    video = document.getElementById("video");
    c1 = document.getElementById("aux-canvas");
    ctx1 = c1.getContext("2d");

    video.addEventListener("play", function() {
        width = video.width;
        height = video.height;
        timerCallback();
    }, false);
}

function computeFrame() {
    adjustImage(isHorizontalVideo);
    
    image.src = c1.toDataURL();
    render(image);
}

function adjustImage(isHorizontal) {
    if (isHorizontal) {
        // fill horizontally - for horizontal filmed videos
        hRatio = (c1.width / video.videoWidth) * video.videoHeight;
        ctx1.drawImage(video, 0, 0, c1.width, hRatio);
    } else {
        // fill vertically - for vertical filmed videos
        vRatio = (c1.height / video.videoHeight) * video.videoWidth;
        ctx1.drawImage(video, 0, 0, vRatio, c1.height);
    }
}

main();
