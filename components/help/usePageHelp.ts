import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useDatabase } from '@/components/database-provider';
import { useLocale } from '@/src/i18n';

import { getHelpSeen, markHelpSeen } from './helpFlags';
import type { LocalizedPageHelp, PageHelpContent } from './types';

/**
 * Per-page help controller. A page wires help in two lines:
 *
 *   const help = usePageHelp('today', todayHelp, { autoShowOnce: true });
 *   // header:  <HelpButton onPress={help.open} />
 *   // root:    <PageHelpHost help={help} />
 *
 * It resolves the page's `LocalizedPageHelp` to the active locale (re-rendering
 * on language change via `useLocale`), and — when `autoShowOnce` is set —
 * opens the help once on the page's first-ever visit, persisting a
 * `help_seen:<pageId>` flag so it never auto-opens again.
 */
export interface PageHelpHandle {
  pageId: string;
  content: PageHelpContent;
  visible: boolean;
  open: () => void;
  close: () => void;
}

export function usePageHelp(
  pageId: string,
  localized: LocalizedPageHelp,
  opts?: { autoShowOnce?: boolean },
): PageHelpHandle {
  const db = useDatabase();
  const locale = useLocale();
  const content = localized[locale];
  const [visible, setVisible] = useState(false);
  const autoChecked = useRef(false);

  useEffect(() => {
    if (!opts?.autoShowOnce || autoChecked.current) return;
    autoChecked.current = true;
    let cancelled = false;
    void getHelpSeen(db, pageId).then((seen) => {
      if (cancelled || seen) return;
      setVisible(true);
      void markHelpSeen(db, pageId);
    });
    return () => {
      cancelled = true;
    };
  }, [db, pageId, opts?.autoShowOnce]);

  // Dismiss the overlay when the host screen blurs (deep-link / tab switch /
  // back). The RN <Modal> floats on the navigation stack, so without this it
  // stays presented on top of the next screen until manually skipped.
  useFocusEffect(
    useCallback(() => {
      return () => setVisible(false);
    }, []),
  );

  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);

  return { pageId, content, visible, open, close };
}
