const { join } = require('path');
const { EnvironmentPlugin } = require('webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
  plugins: [
    new EnvironmentPlugin({
      NODE_ENV: 'development'
    }),
    new CopyWebpackPlugin([
      { context: 'static', from: '**/*' }
    ])
  ],
  entry: {
    background: join(__dirname, 'src', 'background.js')
  },
  output : {
    path: join(__dirname, 'dist'),
    filename: '[name].js'
  }
};
