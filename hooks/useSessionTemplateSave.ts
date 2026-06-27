import { randomUUID } from 'expo-crypto';
import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';

import type { ToastController } from '@/components/ui/Toast';
import { listPrograms, type ProgramSummary } from '@/src/adapters/sqlite/programRepository';
import {
  convertSessionToTemplate,
  findTemplateByTriple,
  getSessionLinkedTemplateTriple,
} from '@/src/adapters/sqlite/templateRepository';
import type { Database } from '@/src/db/types';
import { formatLocalYmdFromMs } from '@/src/domain/date/localYmd';
import { computeDefaultTemplateName } from '@/src/domain/session/sessionDetailLabels';
import { t } from '@/src/i18n';
import {
  tDuplicateTemplateTriple,
  tTemplateCreated,
  tTemplateUpdated,
} from '@/src/i18n/dynamic';

/**
 * Shared 儲存模板 / 另存模板 logic for the two screens that can convert a
 * session into a template: the in-session Today screen (`app/(tabs)/index.tsx`
 * ⋯ menu) and the session detail page (`app/session/[id].tsx` sticky bar).
 *
 * Both screens ran a byte-for-byte twin copy of `handleSaveTemplate` +
 * `handleTemplateMetaConfirm` (convertSessionToTemplate update/create flow,
 * TemplateMetaSheet state, toast feedback, 同名覆蓋 confirm, DUPLICATE_TEMPLATE
 * _TRIPLE handling). The only real divergences are which session is targeted
 * and whether a session title seeds the default name — both captured by the
 * getter params below, so each screen keeps its exact behaviour. (The detail
 * page previously called `formatDateLabel`, which is itself just a one-line
 * wrapper over `formatLocalYmdFromMs`, so folding to the latter is identical.)
 */

type TemplateMetaPrefill = {
  name: string;
  program_id: string | null;
  sub_tag: string | null;
};

export interface UseSessionTemplateSaveParams {
  db: Database;
  /**
   * Active session id, or `null` when no convertible session is available
   * (handlers no-op). Detail page → route `id`; Today screen → in-progress
   * session id.
   */
  getSessionId: () => string | null;
  /** Active session `started_at` (unix ms), or `null` when unavailable. */
  getStartedAt: () => number | null;
  /**
   * Session title to seed the default template name with, or `null`. Detail
   * page has no title column (always `null`); Today screen passes the live
   * header title (trimmed; empty → `null`).
   */
  getSessionTitle: () => string | null;
  /** Toast surface for success feedback. */
  toast: React.RefObject<ToastController | null>;
}

export interface UseSessionTemplateSaveResult {
  programs: ProgramSummary[];
  templateMetaSheetOpen: boolean;
  templateMetaPrefill: TemplateMetaPrefill | null;
  templateMetaBusy: boolean;
  handleSaveTemplate: (mode: 'update' | 'create') => Promise<void>;
  handleTemplateMetaConfirm: (args: {
    name: string;
    program_id: string | null;
    sub_tag: string | null;
  }) => Promise<void>;
  closeSheet: () => void;
}

export function useSessionTemplateSave(
  params: UseSessionTemplateSaveParams,
): UseSessionTemplateSaveResult {
  // Latest-ref so the returned handlers stay referentially stable (empty deps)
  // while always reading the caller's current session getters / db / toast.
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const [programs, setPrograms] = useState<ProgramSummary[]>([]);
  const [templateMetaSheetOpen, setTemplateMetaSheetOpen] = useState(false);
  const [templateMetaBusy, setTemplateMetaBusy] = useState(false);
  const [templateMetaPrefill, setTemplateMetaPrefill] =
    useState<TemplateMetaPrefill | null>(null);

  const handleSaveTemplate = useCallback(async (mode: 'update' | 'create') => {
    const { db, getSessionId, getStartedAt, getSessionTitle, toast } =
      paramsRef.current;
    const session_id = getSessionId();
    const started_at = getStartedAt();
    if (session_id == null || started_at == null) return;

    if (mode === 'create') {
      try {
        const [progs, linked] = await Promise.all([
          listPrograms(db),
          getSessionLinkedTemplateTriple(db, session_id),
        ]);
        setPrograms(progs);
        // prefill 跟著 fallback chain (sessionTitle → linkedTemplateName →
        // dateLabel) 走，避免 freestyle session 開 TemplateMetaSheet 時 input 空白。
        const dateLabel = formatLocalYmdFromMs(started_at);
        const prefillName = computeDefaultTemplateName({
          sessionTitle: getSessionTitle(),
          linkedTemplateName: linked?.template_name,
          dateLabel,
        });
        setTemplateMetaPrefill({
          name: prefillName,
          program_id: linked?.program_id ?? null,
          sub_tag: linked?.sub_tag ?? null,
        });
      } catch (e) {
        Alert.alert(t('alert', 'loadFailed'), e instanceof Error ? e.message : String(e));
        return;
      }
      setTemplateMetaSheetOpen(true);
      return;
    }

    // mode === 'update' (儲存模板): direct overwrite of the linked template —
    // no name prompt. Freestyle (no linked template) → tell the user to use
    // 另存模板 instead (rather than silently fall through to a create dialog).
    let linked: Awaited<ReturnType<typeof getSessionLinkedTemplateTriple>>;
    try {
      linked = await getSessionLinkedTemplateTriple(db, session_id);
    } catch (e) {
      Alert.alert(t('alert', 'loadFailed'), e instanceof Error ? e.message : String(e));
      return;
    }
    if (!linked) {
      Alert.alert(
        t('alert', 'originalTemplateNotFound'),
        t('alert', 'sessionTemplateMissing'),
      );
      return;
    }
    try {
      await convertSessionToTemplate(db, {
        session_id,
        template_name: linked.template_name,
        mode: 'update',
        uuid: randomUUID,
      });
      toast.current?.show(tTemplateUpdated(linked.template_name), { icon: 'success' });
    } catch (e) {
      Alert.alert(t('alert', 'failed'), e instanceof Error ? e.message : String(e));
    }
  }, []);

  const handleTemplateMetaConfirm = useCallback(
    async (args: {
      name: string;
      program_id: string | null;
      sub_tag: string | null;
    }) => {
      const { db, getSessionId, getStartedAt, getSessionTitle, toast } =
        paramsRef.current;
      const session_id = getSessionId();
      const started_at = getStartedAt();
      if (session_id == null || started_at == null) return;

      // final fallback chain mirrors the prefill chain so the dialog default
      // and the "user submitted blank input" default agree.
      const dateLabel = formatLocalYmdFromMs(started_at);
      const defaultName = computeDefaultTemplateName({
        sessionTitle: getSessionTitle(),
        linkedTemplateName: null,
        dateLabel,
      });
      const finalName = args.name.trim() || defaultName;
      // #3 ①: convert (optionally overwriting the colliding template Y).
      const runConvert = (overwriteTemplateId?: string) =>
        convertSessionToTemplate(db, {
          session_id,
          template_name: finalName,
          mode: 'create',
          program_id: args.program_id,
          sub_tag: args.sub_tag,
          uuid: randomUUID,
          ...(overwriteTemplateId ? { overwriteTemplateId } : {}),
        });
      // #3 ①「覆蓋」: replace the colliding template Y's body with this
      // session, keeping Y's identity. Y resolved via findTemplateByTriple.
      const overwriteExisting = (targetId: string) => {
        setTemplateMetaBusy(true);
        void (async () => {
          try {
            await runConvert(targetId);
            setTemplateMetaSheetOpen(false);
            toast.current?.show(tTemplateUpdated(finalName), { icon: 'success' });
          } catch (e2) {
            Alert.alert(
              t('alert', 'failed'),
              e2 instanceof Error ? e2.message : String(e2),
            );
          } finally {
            setTemplateMetaBusy(false);
          }
        })();
      };
      setTemplateMetaBusy(true);
      try {
        await runConvert();
        setTemplateMetaSheetOpen(false);
        Alert.alert(t('status', 'savedAsNew'), tTemplateCreated(finalName));
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (message === 'DUPLICATE_TEMPLATE_TRIPLE') {
          const existing = await findTemplateByTriple(db, {
            name: finalName,
            program_id: args.program_id,
            sub_tag: args.sub_tag,
          });
          if (existing) {
            Alert.alert(
              t('alert', 'variantExists'),
              t('alert', 'overwriteTemplateConfirm'),
              [
                { text: t('common', 'cancel'), style: 'cancel' },
                {
                  text: t('button', 'overwrite'),
                  style: 'destructive',
                  onPress: () => overwriteExisting(existing.id),
                },
              ],
            );
          } else {
            Alert.alert(t('alert', 'variantExists'), tDuplicateTemplateTriple(finalName));
          }
        } else {
          Alert.alert(t('alert', 'failed'), message);
        }
      } finally {
        setTemplateMetaBusy(false);
      }
    },
    [],
  );

  const closeSheet = useCallback(() => setTemplateMetaSheetOpen(false), []);

  return {
    programs,
    templateMetaSheetOpen,
    templateMetaPrefill,
    templateMetaBusy,
    handleSaveTemplate,
    handleTemplateMetaConfirm,
    closeSheet,
  };
}
