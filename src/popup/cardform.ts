// The card form of the popup (E): every field of the note, to edit before Minerr sends it, with the screenshot and the audio.
import type { MediaFile, NoteDraft } from '../anki/anki.ts';
import { el } from './popup-view.ts';

// The other children of an editing popup hide, so the form fills the popup. The form is in the shadow root of the popup,
// so .primary of the Send button comes from the popup STYLE (src/popup/popup-view.ts).
const STYLE = `
  .popup.editing > :not(form) { display: none; }
  .card-form { display: flex; flex-direction: column; min-height: 0; }
  .card-form .fields { flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 12px 16px 4px; }
  .card-form label { display: block; margin-top: 10px; color: var(--muted); font-size: 12px; font-weight: 600; }
  .card-form textarea { box-sizing: border-box; width: 100%; padding: 6px 10px; border: 1px solid var(--line); border-radius: var(--radius-s);
    background: var(--field); color: var(--text); font: 13px/1.4 var(--font-ui); resize: vertical; }
  .card-form textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; }
  .card-form img { display: block; max-width: 100%; margin-top: 8px; border-radius: var(--radius-s); }
  .card-form audio { display: block; width: 100%; margin-top: 8px; }
  .card-form .buttons { display: flex; gap: 8px; padding: 12px 16px 14px; border-top: 1px solid var(--line); }
  .card-form .buttons button { flex: 1; min-height: 36px; padding: 8px 16px; border: 0; border-radius: var(--radius-pill); font-weight: 700; }
  .card-form .buttons .cancel { background: var(--raised); }
`;

const MIME: Record<string, string> = { jpg: 'image/jpeg', mp3: 'audio/mpeg', webm: 'audio/webm' };

function preview({ filename, data }: MediaFile): HTMLElement {
  const mime = MIME[filename.split('.').pop() ?? ''] ?? 'application/octet-stream';
  const src = `data:${mime};base64,${data}`;
  return mime.startsWith('image/') ? el('img', { src, alt: 'Screenshot' }) : el('audio', { src, controls: true, title: filename });
}

export interface FormActions {
  // Gets the draft with the fields as the user edited them.
  send: (draft: NoteDraft) => void;
  cancel: () => void;
}

export function cardForm(draft: NoteDraft, { send, cancel }: FormActions): HTMLFormElement {
  const values = Object.values(draft.fields);
  const areas = Object.entries(draft.fields).map(([name, value], i) =>
    el('textarea', { id: `ml-field-${i}`, name, value, rows: value.length > 80 ? 4 : 1, spellcheck: false }));
  const form = el('form', { className: 'card-form', ariaLabel: 'Edit the card' },
    el('style', { textContent: STYLE }),
    el('div', { className: 'fields' },
      ...areas.flatMap(area => [el('label', { htmlFor: area.id, textContent: area.name }), area]),
      ...draft.media.filter(file => values.some(value => value.includes(file.filename))).map(preview)),
    el('div', { className: 'buttons' },
      el('button', { type: 'submit', className: 'send primary', textContent: 'Send' }),
      el('button', { type: 'button', className: 'cancel', textContent: 'Cancel', onclick: cancel })));
  form.onsubmit = event => {
    event.preventDefault();
    send({ ...draft, fields: Object.fromEntries(areas.map(area => [area.name, area.value])) });
  };
  // The keys of the form stay in the form, so the page does not get them. Esc closes the form, not the popup.
  form.onkeydown = event => {
    event.stopPropagation();
    if (event.key !== 'Escape') return;
    event.preventDefault();
    cancel();
  };
  return form;
}
