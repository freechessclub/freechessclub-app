const webpack = require('webpack');
const { exec } = require('child_process');
const path = require('path');
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = (env, argv) => {
  const isProd = argv.mode === 'production';
  const inputDir = 'src';
  const outputDir = isProd ? 'www' : 'dev';

  const bundle = {
    name: 'bundle',
    mode: isProd ? 'production' : 'development',
    entry: { application: path.resolve(__dirname, inputDir, 'js/index.ts') },
    output: {
      path: path.resolve(__dirname, outputDir),
      filename: "assets/js/" + (isProd ? "bundle.[contenthash].js" : "bundle.js"),
      clean: true,
    },
    externals: {
      $: 'jquery',
	    d3: 'd3',
      '@popperjs/core': 'Popper',
      bootstrap: 'Bootstrap'
    },
    resolve: {
      // Add '.ts' and '.tsx' as a resolvable extension.
      fallback: { 'crypto': false, 'fs': false, 'path': require.resolve('path-browserify') },
      extensions: [".webpack.js", ".web.js", ".ts", ".tsx", ".js"],
      alias: { assets: path.resolve(__dirname, inputDir, 'assets') },
    },
    module: {
      rules: [
        // all files with a '.ts' or '.tsx' extension will be handled by 'ts-loader'
        { test: /\.tsx?$/, use: "ts-loader" },
        { test: /\.(woff|woff2|ttf|eot|svg)$/, type: 'asset', generator: { filename: 'assets/img/[name].[hash][ext][query]' } },
        { test: /\.m?js/, resolve: { fullySpecified: false } },
        { test: /\.wasm$/, type: "asset/resource", generator: { filename: "assets/js/[name][ext]" } },
        { test: /\.css$/,
          use: isProd
            ? [MiniCssExtractPlugin.loader, { loader: 'css-loader', options: { url: false } }]
            : ['style-loader', 'css-loader'],
        }
      ]
    },
    plugins: [
      new webpack.optimize.AggressiveMergingPlugin(),
      new HtmlWebpackPlugin({
        template: path.resolve(__dirname, inputDir, 'play.html'),
        filename: "play.html",
        inject: "body",
        minify: isProd,
      }), 
      new CopyWebpackPlugin({
        patterns: [
          {
            // copy all static assets
            from: path.resolve(__dirname, inputDir),
            to: path.resolve(__dirname, outputDir),
            globOptions: {
              ignore: [
                `${inputDir}/play.html`,
                `${inputDir}/js/**`,
                `${inputDir}/assets/css/application.css`,
                `${inputDir}/assets/css/themes/**`
              ],
            },
          }
        ],
      }),
      ...(isProd
      ? [
          new MiniCssExtractPlugin({
            filename: 'assets/css/[name].[contenthash].css',
            chunkFilename: 'assets/css/[name].[contenthash].css',
          }),
        ]
      : []),
    ],
    optimization: {
      minimize: isProd,
    },
    experiments: {
      asyncWebAssembly: true,
    },
    devServer: {
      client: {
        progress: true,
      },
      devMiddleware: {
        writeToDisk: false,
      },
      static: {
        directory: outputDir,
        watch: false,
      },
      hot: true,  
      watchFiles: [`${inputDir}/*.html`],
      historyApiFallback: {
        rewrites: [
          { from: /^\/play/, to: '/play.html' },
        ],
      },
      compress: true,
      port: 8080,
      headers: {
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Opener-Policy': 'same-origin',
      },
    }
  };

  const serviceWorker = {
    name: 'service-worker',
    dependencies: ['bundle'],
    mode: isProd ? 'production' : 'development',
    stats: 'errors-warnings', 
    entry: path.resolve(__dirname, inputDir, 'js/service-worker.js'),
    target: 'webworker',
    output: {
      filename: 'service-worker.js',
      path: path.resolve(__dirname, outputDir),
    },
    plugins: [
      {
        apply: (compiler) => {
          compiler.hooks.done.tap('RunAfterBuildPlugin', () => {
            exec(`node "${path.resolve(__dirname, 'scripts/inject-sw-manifest.js')}"`, (err, stdout, stderr) => {
              if (stdout) console.log(stdout);
              if (stderr) console.error(stderr);
            });
          });
        }
      }
    ]
  };

  return isProd ? [bundle, serviceWorker] : [bundle];
}
