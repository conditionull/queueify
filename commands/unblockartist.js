module.exports = {
    name: 'unblockartist',
    aliases: ['allowartist'],
    modOnly: true,

    execute({ client, channel, args, state }) {
        const artist = args.join(' ').trim().toLowerCase();

        if (!artist) {
            client.say(channel, 'usage: !unblockartist <artist_name>');
            return;
        }

        const wasBlocked = state.blockedArtists.delete(artist);

        if (!wasBlocked) {
            client.say(channel, `artist was not blocked: ${artist}`);
            return;
        }

        state.saveBlacklist();
        client.say(channel, `artist unblocked: ${artist}`);
    }
};