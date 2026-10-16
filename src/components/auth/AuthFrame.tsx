import { BrandMark } from '@/components/layout/Brand';
import { BuiltBy, MgmLogo, SwayambhuLogo } from '@/components/layout/EventLogos';

/** Shared frame for the two sign-in screens: brand at top, one focused card. */
export default function AuthFrame({ children, aside }: { children: React.ReactNode; aside: React.ReactNode }) {
  return (
    <main className="relative min-h-screen px-4 py-6 sm:px-8">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
        <div className="flex items-center gap-4"><MgmLogo size="md" /><span className="hidden sm:block"><BrandMark /></span></div>
        <SwayambhuLogo size="md" />
      </div>
      <div className="mx-auto mt-[6vh] grid max-w-5xl items-start gap-10 lg:grid-cols-[1fr_26rem]">
        <div className="hidden pt-6 lg:block">{aside}</div>
        <div className="peb-panel p-6 sm:p-8">{children}</div>
      </div>
      <div className="mx-auto mt-10 flex max-w-5xl justify-center"><BuiltBy /></div>
    </main>
  );
}
