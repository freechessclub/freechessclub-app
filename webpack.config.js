const webpack = require('webpack');

module.exports = [{
    name: 'bundle',
    entry: "./src/index.ts",
    output: {
        path: __dirname + "/assets/js/",
        filename: "bundle.js"
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
        extensions: [".webpack.js", ".web.js", ".ts", ".tsx", ".js"]
    },
    module: {
        rules: [
            // all files with a '.ts' or '.tsx' extension will be handled by 'ts-loader'
            { test: /\.tsx?$/, use: "ts-loader" },
            { test: /\.css$/, use: ['style-loader', 'css-loader'] },
            { test: /\.woff(\?v=\d+\.\d+\.\d+)?$/, use: "url-loader?limit=10000&mimetype=application/font-woff" },
            { test: /\.ttf(\?v=\d+\.\d+\.\d+)?$/, use: "url-loader?limit=10000&mimetype=application/octet-stream" },
            { test: /\.eot(\?v=\d+\.\d+\.\d+)?$/, use: "file-loader" },
            { test: /\.svg(\?v=\d+\.\d+\.\d+)?$/, use: "url-loader?limit=10000&mimetype=image/svg+xml" },
            { test: /\.html$/, use: 'raw', exclude: /node_modules/},
            { test: /\.(ttf|eot|svg|woff(2)?)(\?[a-z0-9=&.]+)?$/, use: 'file-loader' },
            { test: /\.m?js/, resolve: { fullySpecified: false } },
            { test: /\.wasm$/, use: "file-loader?name=[name].[ext]" }
        ]
    },
    plugins: [
        new webpack.optimize.AggressiveMergingPlugin(),
        new webpack.DefinePlugin({
            'process.env': {
                'NODE_ENV': JSON.stringify('production')
            }
        }),
    ],
    optimization: {
        minimize: true,
    },
    experiments: {
        asyncWebAssembly: true,
    },
    devServer: {
        client: {
            progress: true,
        },
        devMiddleware: {
            writeToDisk: true,
        },
        static: {
          directory: __dirname,
        },
        historyApiFallback: {
            rewrites: [
              { from: /^\/play/, to: 'play.html' },
            ],
          },
        compress: true,
        port: 8080,
    }
},
{
    name: 'service-worker',
    entry: './src/service-worker.js',
    target: 'webworker',
    output: {
        filename: 'service-worker.js',
        path: __dirname,
    },
}]
