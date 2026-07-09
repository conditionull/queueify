export async function getSceneItemId(sceneName, sourceName) {
    const { sceneItems } = await obs.call("GetSceneItemList", {
        sceneName,
    });

    const item = sceneItems.find(i => i.sourceName === sourceName);

    if (!item)
        throw new Error(`Source "${sourceName}" not found`);

    return item.sceneItemId;
}