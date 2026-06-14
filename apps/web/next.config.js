/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone', // required for Docker production image
};
module.exports = nextConfig;
