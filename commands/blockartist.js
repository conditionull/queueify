module.exports = {
    name: 'blockartist',
    aliases: ['denyartist'],
    modOnly: true,

    execute({ client, channel, args, state }) {
        const artist = args.join(' ').trim().toLowerCase();

        if (!artist) {
            client.say(channel, 'usage: !blockartist <artist_name>');
            return;
        }

        state.blockedArtists.add(artist);
        state.saveBlacklist();
        client.say(channel, `artist blocked: ${artist}`);
    }
};