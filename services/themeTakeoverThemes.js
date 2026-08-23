// the listed themes must have matching height and width ratios (680x192)
// This is because other dimensions can be misframed in an existing OBS browser source
const THEME_TAKEOVER_THEMES = ['default', 'swag'];

function isThemeTakeoverTheme(theme) {
	return THEME_TAKEOVER_THEMES.includes(theme);
}

module.exports = { THEME_TAKEOVER_THEMES, isThemeTakeoverTheme };