import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker } from 'react-router';
import type { FounderEmailRendered, FounderEmailTemplate } from '@proovd/shared';
import { AdminRequestError } from '../../api.js';
import { fetchFounderEmails, previewFounderEmail, saveFounderEmail } from './api.js';
import './founder-email-editor.css';

type PreviewPair = { current: FounderEmailRendered; previous: FounderEmailRendered };
type Draft = {
  copy: Record<string, string>;
  note: string;
  preview: PreviewPair;
  previewFingerprint: string;
};

function fingerprint(copy: Record<string, string>): string {
  return JSON.stringify(Object.keys(copy).sort().map((key) => [key, copy[key]]));
}

function newDraft(template: FounderEmailTemplate): Draft {
  return {
    copy: { ...template.copy },
    note: '',
    preview: { current: template.current, previous: template.previous },
    previewFingerprint: fingerprint(template.copy),
  };
}

function errorDetail(error: unknown): { title: string; detail?: string; next?: string; status?: number; fields?: Record<string, string> } {
  if (error instanceof AdminRequestError) {
    const rawFields = (error.detail as typeof error.detail & { fields?: unknown }).fields;
    const fields = rawFields && typeof rawFields === 'object' && !Array.isArray(rawFields)
      ? Object.fromEntries(Object.entries(rawFields).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
      : {};
    return {
      title: error.detail.title,
      status: error.detail.status,
      ...(error.detail.whatHappened ? { detail: error.detail.whatHappened } : {}),
      ...(error.detail.next ? { next: error.detail.next } : {}),
      ...(Object.keys(fields).length ? { fields } : {}),
    };
  }
  return { title: 'The request did not complete', next: 'Your edits are still here. Please try again.' };
}

function ErrorMessage({ error, fieldKeys = [] }: { error: ReturnType<typeof errorDetail>; fieldKeys?: readonly string[] }) {
  return (
    <div className="fee-error" role="alert">
      <strong>{error.title}</strong>
      {error.detail ? <p>{error.detail}</p> : null}
      {error.next ? <p>{error.next}</p> : null}
      {Object.entries(error.fields ?? {}).filter(([key]) => !fieldKeys.includes(key)).map(([key, message]) => <p key={key}>{message}</p>)}
    </div>
  );
}

function savedTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });
}

function EmailPreview({
  email,
  previous = false,
  plainText,
  title,
  notice = 'ready',
}: {
  email: FounderEmailRendered;
  previous?: boolean;
  plainText: boolean;
  title: string;
  notice?: 'ready' | 'updating' | 'stale';
}) {
  return (
    <article className="fee-mail" aria-label={title} aria-busy={notice === 'updating'}>
      <div className="fee-mail-envelope">
        <span className="fee-mail-label">{notice === 'stale' ? 'Last successful preview' : title}</span>
        {notice === 'updating' ? <p className="fee-preview-state" role="status">Updating preview…</p> : null}
        {notice === 'stale' ? <p className="fee-preview-state" role="status">This preview does not include your latest edits.</p> : null}
        <h3>{email.subject}</h3>
        <p><span>From</span> {previous ? 'noreply@proovd.info' : 'Proovd <hello@mail.proovd.co>'}</p>
        <p><span>To</span> Sample founder</p>
      </div>
      {plainText ? (
        <pre className="fee-plain" aria-label={`${title} plain text`}>{email.text}</pre>
      ) : (
        <iframe
          title={`${title} email body`}
          sandbox=""
          srcDoc={email.html}
          className="fee-frame"
        />
      )}
    </article>
  );
}

interface Props {
  onDirtyChange?: (dirty: boolean) => void;
  allowNavigation?: boolean;
}

export function FounderEmailEditor({ onDirtyChange, allowNavigation = false }: Props) {
  const [templates, setTemplates] = useState<FounderEmailTemplate[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [selectedKey, setSelectedKey] = useState('founder_invitation');
  const [mode, setMode] = useState<'edit' | 'compare'>('edit');
  const [mobileVersion, setMobileVersion] = useState<'previous' | 'current'>('current');
  const [plainText, setPlainText] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ReturnType<typeof errorDetail> | null>(null);
  const [previewError, setPreviewError] = useState<ReturnType<typeof errorDetail> | null>(null);
  const [saveError, setSaveError] = useState<ReturnType<typeof errorDetail> | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [previewRetry, setPreviewRetry] = useState(0);
  const [savedMessage, setSavedMessage] = useState('');
  const lastField = useRef<{ key: string; start: number; end: number } | null>(null);
  const fieldElements = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>({});
  const leaveDialog = useRef<HTMLElement | null>(null);
  const previewRequest = useRef(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    void fetchFounderEmails().then(({ templates: received }) => {
      if (!active) return;
      setTemplates(received);
      setDrafts((existing) => Object.fromEntries(received.map((template) => [
        template.key, existing[template.key] ?? newDraft(template),
      ])));
      if (received.length && !received.some((template) => template.key === selectedKey)) {
        setSelectedKey(received[0]!.key);
      }
      setLoading(false);
    }).catch((error: unknown) => {
      if (!active) return;
      setLoadError(errorDetail(error));
      setLoading(false);
    });
    return () => { active = false; };
    // A deliberate retry reloads server state; changing the selector never does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retry]);

  const template = templates.find((item) => item.key === selectedKey);
  const draft = drafts[selectedKey];
  const currentFingerprint = draft ? fingerprint(draft.copy) : '';
  const dirty = !!(template && draft && (fingerprint(template.copy) !== currentFingerprint || draft.note.trim()));
  const dirtyCount = useMemo(() => templates.filter((item) => {
    const itemDraft = drafts[item.key];
    return itemDraft && (fingerprint(itemDraft.copy) !== fingerprint(item.copy) || itemDraft.note.trim());
  }).length, [templates, drafts]);
  const hasUnsavedChanges = dirtyCount > 0;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => (
    hasUnsavedChanges && !allowNavigation && (
      currentLocation.pathname !== nextLocation.pathname ||
      currentLocation.search !== nextLocation.search ||
      currentLocation.hash !== nextLocation.hash
    )
  ));

  useEffect(() => { onDirtyChange?.(hasUnsavedChanges); }, [hasUnsavedChanges, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    const previousFocus = document.activeElement;
    leaveDialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [blocker.state]);
  useEffect(() => {
    if (!hasUnsavedChanges || allowNavigation) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsavedChanges, allowNavigation]);

  useEffect(() => {
    setPreviewError(null);
    if (!template || !draft || draft.previewFingerprint === currentFingerprint) return;
    const requestId = ++previewRequest.current;
    const snapshot = { ...draft.copy };
    const timer = window.setTimeout(() => {
      void previewFounderEmail(template.key, snapshot).then((preview) => {
        if (requestId !== previewRequest.current) return;
        setDrafts((existing) => {
          const latest = existing[template.key];
          if (!latest || fingerprint(latest.copy) !== currentFingerprint) return existing;
          return { ...existing, [template.key]: { ...latest, preview, previewFingerprint: currentFingerprint } };
        });
      }).catch((error: unknown) => {
        if (requestId === previewRequest.current) setPreviewError(errorDetail(error));
      });
    }, 350);
    return () => {
      window.clearTimeout(timer);
      if (previewRequest.current === requestId) previewRequest.current += 1;
    };
  }, [template?.key, currentFingerprint, draft?.previewFingerprint, previewRetry]);

  const previewReady = !!draft && draft.previewFingerprint === currentFingerprint;
  const missingRequired = !!template && !!draft && template.fields.some((field) => (
    field.required && !draft.copy[field.key]?.trim()
  ));

  function updateCopy(key: string, value: string) {
    setSaveError(null);
    setSavedMessage('');
    setDrafts((existing) => {
      const current = existing[selectedKey];
      if (!current) return existing;
      return { ...existing, [selectedKey]: { ...current, copy: { ...current.copy, [key]: value } } };
    });
  }

  function insertVariable(key: string) {
    if (!draft || !lastField.current) return;
    const field = lastField.current;
    const original = draft.copy[field.key] ?? '';
    const token = `{{${key}}}`;
    updateCopy(field.key, `${original.slice(0, field.start)}${token}${original.slice(field.end)}`);
    const position = field.start + token.length;
    lastField.current = { key: field.key, start: position, end: position };
    window.requestAnimationFrame(() => {
      const element = fieldElements.current[field.key];
      element?.focus();
      element?.setSelectionRange(position, position);
    });
  }

  async function save() {
    if (!template || !draft || !dirty || savingKey || !previewReady || missingRequired) return;
    const target = template;
    const snapshot = { ...draft.copy };
    const noteSnapshot = draft.note;
    setSavingKey(target.key);
    setSaveError(null);
    setSavedMessage('');
    try {
      const { template: saved } = await saveFounderEmail(target.key, {
        copy: snapshot,
        version: target.version,
        changeNote: noteSnapshot.trim(),
      });
      setTemplates((existing) => existing.map((item) => item.key === target.key ? saved : item));
      setDrafts((existing) => {
        const latest = existing[target.key];
        return {
          ...existing,
          [target.key]: !latest || (fingerprint(latest.copy) === fingerprint(snapshot) && latest.note === noteSnapshot)
            ? newDraft(saved)
            : latest,
        };
      });
      setSavedMessage(`${saved.title} saved. Future emails will use this copy.`);
    } catch (error: unknown) {
      setSaveError(errorDetail(error));
    } finally {
      setSavingKey(null);
    }
  }

  const captureField = (key: string, element: HTMLInputElement | HTMLTextAreaElement) => {
    lastField.current = { key, start: element.selectionStart ?? 0, end: element.selectionEnd ?? 0 };
  };

  return (
    <section className="founder-email-editor" id="main" aria-label="Founder email editor">
      <Link className="fee-back" to="/admin/founders">← Back to Founders</Link>
      <div className="fee-heading">
        <div>
          <p className="fee-eyebrow">Templates</p>
          <h1>Founder emails</h1>
          <p className="fee-description">Edit the words, see the email, and compare what changed.</p>
        </div>
        <div className="fee-save">
          <p className="fee-save-status" role="status" aria-live="polite">
            {loading ? 'Loading…' : loadError ? 'Templates unavailable' : savingKey ? 'Saving…' : savedMessage || (hasUnsavedChanges
              ? `${dirtyCount === 1 ? 'Unsaved changes' : `${dirtyCount} emails with unsaved changes`}`
              : 'All changes saved')}
          </p>
          <button className="fee-primary" type="button" onClick={() => void save()}
            disabled={loading || !!loadError || !dirty || !!savingKey || !previewReady || missingRequired}>
            {savingKey === selectedKey ? 'Saving…' : 'Save this email'}
          </button>
        </div>
      </div>

      {loadError ? <><ErrorMessage error={loadError} /><button className="fee-text-button" type="button" onClick={() => setRetry((value) => value + 1)}>Try loading again</button></> : null}
      {loading ? <p className="fee-loading" role="status">Loading Founder emails…</p> : null}
      {!loading && !loadError && !templates.length ? <p>No Founder email templates are available.</p> : null}

      {template && draft && !loading ? <>
        <div className="fee-toolbar">
          <div className="fee-selector">
            <label htmlFor="founder-email-type">Email</label>
            <select id="founder-email-type" value={selectedKey} disabled={!!savingKey} onChange={(event) => {
              setSelectedKey(event.target.value);
              setSaveError(null);
              setSavedMessage('');
              lastField.current = null;
            }}>
              {templates.map((item) => <option key={item.key} value={item.key}>{item.title}{drafts[item.key] && (fingerprint(drafts[item.key]!.copy) !== fingerprint(item.copy) || drafts[item.key]!.note.trim()) ? ' • Unsaved' : ''}</option>)}
            </select>
          </div>
          <div className="fee-tabs" role="tablist" aria-label="Email editor view" onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 'edit' : event.key === 'End' ? 'compare' : mode === 'edit' ? 'compare' : 'edit';
            setMode(next);
            document.getElementById(`fee-${next}-tab`)?.focus();
          }}>
            <button id="fee-edit-tab" role="tab" tabIndex={mode === 'edit' ? 0 : -1} aria-selected={mode === 'edit'} aria-controls="fee-edit-panel" type="button" onClick={() => setMode('edit')}>Edit</button>
            <button id="fee-compare-tab" role="tab" tabIndex={mode === 'compare' ? 0 : -1} aria-selected={mode === 'compare'} aria-controls="fee-compare-panel" type="button" onClick={() => setMode('compare')}>Compare</button>
          </div>
        </div>
        <div className="fee-context">
          <p>{template.description} Changes apply to future emails.</p>
          <div className="fee-format" role="group" aria-label="Preview format">
            <button type="button" aria-pressed={!plainText} onClick={() => setPlainText(false)}>Formatted</button>
            <button type="button" aria-pressed={plainText} onClick={() => setPlainText(true)}>Plain text</button>
          </div>
        </div>
        {saveError ? <>
          <ErrorMessage error={saveError} fieldKeys={template.fields.map((field) => field.key)} />
          {saveError.status === 409 ? <button type="button" className="fee-text-button fee-refresh" onClick={() => {
            setSaveError(null);
            setRetry((value) => value + 1);
          }}>Refresh saved version — keep my edits</button> : null}
        </> : null}

        {mode === 'edit' ? <div className="fee-edit-grid" id="fee-edit-panel" role="tabpanel" aria-labelledby="fee-edit-tab">
          <form className="fee-fields" onSubmit={(event) => { event.preventDefault(); void save(); }}>
            {template.fields.map((field) => {
              const inputId = `fee-${field.key}`;
              const fieldError = saveError?.fields?.[field.key] ?? previewError?.fields?.[field.key];
              const describedBy = [field.help ? `${inputId}-help` : '', fieldError ? `${inputId}-error` : ''].filter(Boolean).join(' ');
              const common = {
                id: inputId,
                value: draft.copy[field.key] ?? '',
                required: field.required,
                disabled: !!savingKey,
                onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => updateCopy(field.key, event.target.value),
                onSelect: (event: React.SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) => captureField(field.key, event.currentTarget),
                onFocus: (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => captureField(field.key, event.currentTarget),
                'aria-invalid': fieldError ? true : undefined,
                'aria-describedby': describedBy || undefined,
                ref: (element: HTMLInputElement | HTMLTextAreaElement | null) => { fieldElements.current[field.key] = element; },
              };
              return <div className="fee-field" key={field.key}>
                <label htmlFor={inputId}>{field.label}{!field.required ? <span>Optional</span> : null}</label>
                {field.kind === 'textarea' ? <textarea {...common} rows={field.key === 'body' ? 4 : 3} /> : <input {...common} type="text" autoComplete="off" />}
                {field.help ? <p id={`${inputId}-help`} className="fee-help">{field.help}</p> : null}
                {fieldError ? <p id={`${inputId}-error`} className="fee-field-error">{fieldError}</p> : null}
              </div>;
            })}
            <details className="fee-details">
              <summary>Personal details &amp; protected content</summary>
              <p>Names and campaign details fill in automatically. Secure links, verification codes, operational facts, and required notices stay managed by Proovd.</p>
              {template.variables.length ? <>
                <p>Place your cursor in a field, then insert a detail:</p>
                <div className="fee-variables">{template.variables.map((variable) => <button type="button" key={variable.key} disabled={!!savingKey} onClick={() => insertVariable(variable.key)}>{variable.label}</button>)}</div>
              </> : null}
            </details>
            <details className="fee-details">
              <summary>Note about this update</summary>
              <label className="fee-note-label" htmlFor="fee-update-note">What did you change?</label>
              <textarea id="fee-update-note" value={draft.note} disabled={!!savingKey} rows={2} placeholder="Optional — a short note for your team"
                onChange={(event) => {
                  setSavedMessage('');
                  setSaveError(null);
                  const note = event.target.value;
                  setDrafts((existing) => ({ ...existing, [selectedKey]: { ...existing[selectedKey]!, note } }));
                }} />
            </details>
            {template.updatedAt ? <p className="fee-last-saved">Last saved {savedTime(template.updatedAt)}{template.changeNote ? ` · ${template.changeNote}` : ''}</p> : <p className="fee-last-saved">Using the current Proovd template.</p>}
          </form>
          <div className="fee-live-preview">
            <div className="fee-preview-heading"><h2>Preview</h2><span>Sample founder details{dirty ? ' · Unsaved' : ''}</span></div>
            {previewError ? <><ErrorMessage error={previewError} fieldKeys={template.fields.map((field) => field.key)} /><button type="button" className="fee-text-button" onClick={() => setPreviewRetry((value) => value + 1)}>Try preview again</button></> : null}
            <EmailPreview email={draft.preview.current} plainText={plainText} title="Current" notice={previewReady ? 'ready' : previewError ? 'stale' : 'updating'} />
          </div>
        </div> : <div id="fee-compare-panel" role="tabpanel" aria-labelledby="fee-compare-tab">
          <div className="fee-comparison-intro"><p>Same sample founder, two versions. The previous version is kept for reference.</p><span>Sample founder details</span></div>
          <div className="fee-mobile-switch" role="group" aria-label="Compare version">
            <button type="button" aria-pressed={mobileVersion === 'previous'} onClick={() => setMobileVersion('previous')}>Before updates</button>
            <button type="button" aria-pressed={mobileVersion === 'current'} onClick={() => setMobileVersion('current')}>Current{dirty ? ' · Unsaved' : ''}</button>
          </div>
          <div className={`fee-comparison fee-show-${mobileVersion}`}>
            <div className="fee-before"><EmailPreview email={draft.preview.previous} previous plainText={plainText} title="Before updates" /></div>
            <div className="fee-after">
              {previewError ? <><ErrorMessage error={previewError} /><button type="button" className="fee-text-button" onClick={() => setPreviewRetry((value) => value + 1)}>Try preview again</button></> : null}
              <EmailPreview email={draft.preview.current} plainText={plainText} title={dirty ? 'Current · Unsaved' : 'Current'} notice={previewReady ? 'ready' : previewError ? 'stale' : 'updating'} />
            </div>
          </div>
          <section className="fee-update-notes" aria-labelledby="fee-notes-title">
            <h2 id="fee-notes-title">What changed</h2>
            <ul>{template.notes.map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}</ul>
            {template.changeNote ? <p className="fee-saved-note"><strong>Latest saved update</strong> {template.changeNote}{template.updatedAt ? ` · ${savedTime(template.updatedAt)}` : ''}</p> : null}
          </section>
        </div>}
      </> : null}

      {blocker.state === 'blocked' ? <div className="fee-dialog-backdrop">
        <section className="fee-leave-dialog" ref={leaveDialog} role="dialog" aria-modal="true" aria-labelledby="fee-leave-title"
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); blocker.reset(); }
            if (event.key !== 'Tab') return;
            const buttons = leaveDialog.current?.querySelectorAll<HTMLButtonElement>('button');
            const first = buttons?.[0];
            const last = buttons?.[buttons.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }}>
          <h2 id="fee-leave-title">Leave your unsaved edits?</h2>
          <p>Your changes have not been saved. You can keep editing or leave without applying them.</p>
          <div><button className="fee-secondary" type="button" onClick={() => blocker.reset()}>Keep editing</button><button className="fee-primary" type="button" onClick={() => blocker.proceed()}>Leave without saving</button></div>
        </section>
      </div> : null}
    </section>
  );
}
