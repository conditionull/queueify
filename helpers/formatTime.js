function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;

    return mins > 0 ? `${mins} minutes` : `${secs} seconds`;
}

module.exports = formatTime;