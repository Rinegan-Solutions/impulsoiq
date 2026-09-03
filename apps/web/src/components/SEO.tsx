import { useEffect } from 'react';

interface SEOProps {
  title: string;
  description: string;
  canonical?: string;
  ogImage?: string;
  type?: 'website' | 'article';
  noIndex?: boolean;
}

export function SEO({
  title,
  description,
  canonical,
  ogImage = 'https://impulsoiq.rinegansolutions.com/og-image.png',
  type = 'website',
  noIndex,
}: SEOProps) {
  useEffect(() => {
    document.title = title;
    const setMeta = (attr: string, attrVal: string, content: string) => {
      let el = document.querySelector(`meta[${attr}="${attrVal}"]`) as HTMLMetaElement | null;
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, attrVal);
        document.head.appendChild(el);
      }
      el.content = content;
    };
    setMeta('name', 'description', description);
    if (noIndex) setMeta('name', 'robots', 'noindex,nofollow');
    setMeta('property', 'og:title', title);
    setMeta('property', 'og:description', description);
    setMeta('property', 'og:type', type);
    setMeta('property', 'og:image', ogImage);
    if (canonical) setMeta('property', 'og:url', canonical);
    setMeta('name', 'twitter:card', 'summary_large_image');
    setMeta('name', 'twitter:title', title);
    setMeta('name', 'twitter:description', description);
    setMeta('name', 'twitter:image', ogImage);
  }, [title, description, canonical, ogImage, type, noIndex]);
  return null;
}
