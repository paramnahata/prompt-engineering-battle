/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
  // Gemini key and Supabase secret key must only ever be read server-side
  // (route handlers / server actions). Never prefix them with NEXT_PUBLIC_.
};

export default nextConfig;
