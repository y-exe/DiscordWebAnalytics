"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps, ReactNode } from "react";

type NextThemesProps = ComponentProps<typeof NextThemesProvider>;

export default function ThemeProvider({
  children,
  ...props
}: Pick<NextThemesProps, "attribute" | "defaultTheme" | "enableSystem"> & {
  children: ReactNode;
}) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="light" enableSystem {...props}>
      {children}
    </NextThemesProvider>
  );
}
