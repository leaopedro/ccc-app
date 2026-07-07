import { StoreSectionTabs } from '~/components/store-section-tabs';

export default function LojaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <StoreSectionTabs />
      {children}
    </div>
  );
}
