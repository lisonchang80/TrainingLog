/**
 * Template editor route (slice 9.5).
 *
 * Thin wrapper — actual UI lives in the production TemplateEditorView
 * component which loads / commits via the v2 repository (ADR-0016).
 * `GestureHandlerRootView` is wrapped inside `TemplateEditorView` itself
 * so other routes (e.g. session, library) are not affected.
 */
import TemplateEditorView from '@/components/template-editor/template-editor-view';

export default TemplateEditorView;
