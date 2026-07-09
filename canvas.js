let canvasCache = new Map();

async function getCanvas(trackId) {

    if (canvasCache.has(trackId)) {
        return canvasCache.get(trackId);
    }

    try {
        const url =
            `http://localhost:3000/api/canvas?trackId=${trackId}`;

        const response = await fetch(url);

        if (!response.ok) {
            canvasCache.set(trackId, null);
            return null;
        }

        const data = await response.json();

        const canvas =
            data.canvasesList?.[0]?.canvasUrl || null;

        if (canvasCache.size > 100) {
            const firstKey = canvasCache.keys().next().value;
            canvasCache.delete(firstKey);
        }
        
        canvasCache.set(trackId, canvas);

        return canvas;

    } catch (err) {
        console.error("Canvas lookup failed:", err);

        canvasCache.set(trackId, null);

        return null;
    }
}

module.exports = {
    getCanvas
};