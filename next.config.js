/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['192.168.20.242:3000', 'localhost:3000'],

  onDemandEntries: {
    maxInactiveAge: 25 * 1000,
    pagesBufferLength: 2,
  },

  poweredByHeader: false,

  typescript: {
    ignoreBuildErrors: true,
  },
}

module.exports = nextConfig;
