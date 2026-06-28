import { useEffect, useState } from 'react';

import { CoachMarkOverlay } from './CoachMarkOverlay';
import { InfoModal } from './InfoModal';
import type { PageHelpHandle } from './usePageHelp';

/**
 * Renders the right overlay for a page's help based on `content.style`:
 *   - 'info'  → InfoModal
 *   - 'coach' → CoachMarkOverlay (page must host a <CoachMarkProvider>)
 *   - 'mixed' → InfoModal first, with a「操作教學」button that hands off to
 *               the CoachMarkOverlay.
 *
 * Drop one `<PageHelpHost help={help} />` at the page root.
 */
export function PageHelpHost({ help }: { help: PageHelpHandle }) {
  const { content, visible, close } = help;
  const [tour, setTour] = useState(false);

  // Reset the mixed-mode sub-state whenever the help closes.
  useEffect(() => {
    if (!visible) setTour(false);
  }, [visible]);

  if (content.style === 'coach') {
    return content.coach ? (
      <CoachMarkOverlay visible={visible} steps={content.coach} onClose={close} />
    ) : null;
  }

  if (content.style === 'info') {
    return content.info ? (
      <InfoModal visible={visible} content={content.info} onClose={close} />
    ) : null;
  }

  // mixed
  return (
    <>
      {content.info ? (
        <InfoModal
          visible={visible && !tour}
          content={content.info}
          onClose={close}
          onStartTour={content.coach ? () => setTour(true) : undefined}
        />
      ) : null}
      {content.coach ? (
        <CoachMarkOverlay
          visible={visible && tour}
          steps={content.coach}
          onClose={() => {
            setTour(false);
            close();
          }}
        />
      ) : null}
    </>
  );
}
