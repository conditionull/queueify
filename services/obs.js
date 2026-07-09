const { OBSWebSocket } = require("obs-websocket-js");

const obs = new OBSWebSocket();

async function connect() {
    const url = `ws://${process.env.OBS_WEBSOCKET_IP}:${process.env.OBS_WEBSOCKET_PORT}`;
    await obs.connect(url, process.env.OBS_WEBSOCKET_PASSWORD);
    console.log("Connected to OBS");
}

async function getSceneItemId(sceneName, sourceName) {
    const { sceneItems } = await obs.call("GetSceneItemList", {
        sceneName,
    });

    // console.log(
    //     sceneItems.map(item => ({
    //         id: item.sceneItemId,
    //         name: item.sourceName,
    //     }))
    // );

    const item = sceneItems.find(item => item.sourceName === sourceName);

    if (!item) {
        throw new Error(`Source "${sourceName}" not found in scene "${sceneName}"`);
    }

    return item.sceneItemId;
}

async function setTransform(transform) {
    const sceneName = process.env.OBS_SCENE;
    const sourceName = process.env.OBS_SOURCE;

    const sceneItemId = await getSceneItemId(sceneName, sourceName);

    await obs.call("SetSceneItemTransform", {
        sceneName,
        sceneItemId,
        sceneItemTransform: {
            positionX: transform.positionX,
            positionY: transform.positionY,

            scaleX: transform.scaleX,
            scaleY: transform.scaleY,

            rotation: transform.rotation,

            alignment: transform.alignment,

            cropTop: transform.cropTop,
            cropBottom: transform.cropBottom,
            cropLeft: transform.cropLeft,
            cropRight: transform.cropRight,
        },
    });

    console.log("Transform request sent");
}

async function moveSource(x, y) {
    const transform = await getTransform();

    transform.positionX = x;
    transform.positionY = y;

    await setTransform(transform);
}

async function getTransform() {
    const sceneName = process.env.OBS_SCENE;
    const sourceName = process.env.OBS_SOURCE;

    const sceneItemId = await getSceneItemId(sceneName, sourceName);

    const { sceneItemTransform } = await obs.call("GetSceneItemTransform", {
        sceneName,
        sceneItemId,
    });

    return sceneItemTransform;
}

module.exports = {
    connect,
    moveSource,
    getTransform,
    setTransform
};