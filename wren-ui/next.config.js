/* eslint-disable @typescript-eslint/no-var-requires */

// 1️⃣ Patch fs to prevent EMFILE errors
require('graceful-fs').gracefulify(require('fs'));


const path = require('path');
const withLess = require('next-with-less');
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

const resolveAlias = {
  antd$: path.resolve(__dirname, 'src/import/antd'),
};

/** @type {import('next').NextConfig} */
const nextConfig = withLess({
  output: 'standalone',
  staticPageGenerationTimeout: 1000,
  compiler: {
    styledComponents: {
      displayName: true,
      ssr: true,
    },
  },
  lessLoaderOptions: {
    additionalData: `@import "@/styles/antd-variables.less";`,
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      ...resolveAlias,
    };
    return config;
  },
  async redirects() {
    return [
      {
        source: '/setup',
        destination: '/setup/connection',
        permanent: true,
      },
    ];
  },
  typescript: {
    ignoreBuildErrors: true, // temporary workaround for GraphQL type issues
  },
});

module.exports = withBundleAnalyzer(nextConfig);
