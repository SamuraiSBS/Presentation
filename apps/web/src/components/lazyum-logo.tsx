import Image from "next/image";

export function LazyumLogo({ className }: { className?: string }) {
  return (
    <span className={className} aria-hidden="true">
      <Image src="/lazyum-logo.png" alt="" width={64} height={64} sizes="64px" priority />
    </span>
  );
}
