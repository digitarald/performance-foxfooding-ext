module.exports = {
    entry: {
        background: `${__dirname}/webextension/background.js`,
    },
    output: {
        path: `${__dirname}/addon/webextension`,
        filename: '[name]-bundle.js'
    }
};
