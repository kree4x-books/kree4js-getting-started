module.exports = {
    hooks: {
        config: function (config) {
            var themeConfig = config.pluginsConfig["theme-icp"] || {};
            config.styles = config.styles || themeConfig.styles;

            return config;
        },
    },
};