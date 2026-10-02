import type {MetadataRoute} from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {url: SITE_URL, changeFrequency: "monthly", priority: 1},
    {url: `${SITE_URL}/privacidad`, changeFrequency: "yearly", priority: 0.3},
  ];
}
