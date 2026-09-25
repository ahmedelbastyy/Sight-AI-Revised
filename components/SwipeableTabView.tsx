// This file is kept for import compatibility but the swipe logic is now handled by PagerView in _layout.tsx
import React from 'react';

interface SwipeableTabViewProps {
  children: React.ReactNode;
}

export function SwipeableTabView({ children }: SwipeableTabViewProps) {
  return <>{children}</>;
}
