import type { ReactNode } from "react";

export default function PageToolbar({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-foreground md:text-[1.75rem]">
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-sm font-bold text-muted-foreground">{subtitle}</p>}
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  );
}
