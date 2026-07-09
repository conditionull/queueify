import { getCanvases } from '../services/spotifyCanvasService.js';

export const fetchCanvas = async (req, res) => {
    const { trackId } = req.query;

    if (!trackId) {
        return res.status(400).json({ error: 'Missing trackId parameter' });
    }

    try {
        //console.log("Fetching canvas for:", trackId);

        const canvasData = await getCanvases(`spotify:track:${trackId}`);

        // console.log("Canvas result:", canvasData);

        if (!canvasData) {
            return res.status(500).json({
                error: 'Failed to fetch canvas data'
            });
        }

        res.json(canvasData);

    } catch (err) {
        console.error("Canvas controller error:");
        console.error(err);

        res.status(500).json({
            error: 'Failed to fetch canvas data',
            message: err.message
        });
    }
};