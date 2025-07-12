const webpack = require('webpack');
const path = require('path');

const inputDir = 'src';
const outputDir = 'dist';

const electronPreload = {
  name: 'electron-preload',
  target: 'electron-preload',
  mode: 'production', 
  entry: path.resolve(__dirname, inputDir, 'js/preload.js'),
  output: {
    filename: 'preload.js',
    path: path.resolve(__dirname, outputDir, 'js'),
  },
  node: {
    __dirname: false,    
    __filename: false, 
  },
}

const electronApp = {
  name: 'electron-app',
  target: 'electron-main',          
  mode: 'production',                
  entry: path.resolve(__dirname, inputDir, 'js/app.ts'),       
  output: {
    path: path.resolve(__dirname, outputDir, 'js'),
    filename: 'app.js',                    
  },
  resolve: {
    extensions: ['.ts', '.js'],      
  },
  module: {
    rules: [
      { test: /\.ts$/, exclude: /node_modules/, use: 'ts-loader', },
    ],
  },
  node: {
    __dirname: false,    
    __filename: false, 
  },
}

module.exports = [electronPreload, electronApp];
