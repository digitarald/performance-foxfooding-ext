const { join } = require('path');
const { EnvironmentPlugin, optimize } = require('webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
  plugins: [
    new optimize.ModuleConcatenationPlugin(),
    new EnvironmentPlugin({
      NODE_ENV: 'development',
    }),
    new CopyWebpackPlugin([{ context: 'static', from: '**/*' }]),
  ],
  entry: {
    background: join(__dirname, 'src', 'background.js'),
    deflate: join(__dirname, 'src', 'deflate.js'),
  },
  output: {
    path: join(__dirname, 'dist'),
    filename: '[name].js',
  },
};
