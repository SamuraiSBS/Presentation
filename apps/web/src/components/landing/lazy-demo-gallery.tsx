"use client";

import type { ComponentType } from "react";
import { useEffect, useRef, useState } from "react";

export function LazyDemoGallery() {
  const placeholderRef = useRef<HTMLDivElement>(null);
  const [Gallery, setGallery] = useState<ComponentType | null>(null);

  useEffect(() => {
    const placeholder = placeholderRef.current;
    if (!placeholder) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        void import("@/components/landing/demo-gallery").then(({ DemoGallery }) => setGallery(() => DemoGallery));
        observer.disconnect();
      }
    }, { rootMargin: "320px" });

    observer.observe(placeholder);
    return () => observer.disconnect();
  }, []);

  return Gallery ? <Gallery /> : <div ref={placeholderRef} aria-hidden="true" />;
}
