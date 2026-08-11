module.exports = {
    name: 'explicit',
    aliases: ['explicit'],
    modOnly: true,

    execute({ client, channel, state, args }) {
        const action = (args[0] || '').toLowerCase();

        if (action === 'on') {
            if (state.allowExplicit) {
                client.say(channel, 'Explicit songs are already allowed');
                return;
            }

            state.allowExplicit = true;
            state.saveSettings();
            client.say(channel, 'Explicit songs are now allowed');
            return;
        }

        if (action === 'off') {
            if (!state.allowExplicit) {
                client.say(channel, 'Explicit songs are already blocked');
                return;
            }

            state.allowExplicit = false;
            state.saveSettings();
            client.say(channel, 'Explicit songs are now blocked');
            return;
        }

        client.say(channel, 'Usage: !explicit on | !explicit off');
    }
};
