// The multi-select of the subtitle sidebar (src/video/sidebar/sidebar.ts), as in Migaku: the user selects line cards, and
// "Create N cards" adds one card for each line, one after another, because the screenshot needs the video at that line.

// What happened to a line of a run: a card, no card because the line needs a target word, or an error of the card.
export type Outcome = 'added' | 'skipped' | 'failed';

// stop: the user asked the run to end after the card that it adds now.
type Run =
  | { kind: 'none' }
  | { kind: 'running'; done: number; total: number; stop: boolean }
  | { kind: 'done'; text: string };

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// The result of a run of total lines. outcomes has one entry for each line that the run did, in order.
export function summary(outcomes: Outcome[], total: number): string {
  const of = (outcome: Outcome) => outcomes.filter(found => found === outcome).length;
  const skipped = of('skipped');
  const failed = of('failed');
  return [
    outcomes.length < total ? 'Stopped.' : '',
    `Added ${count(of('added'), 'card')}.`,
    skipped ? `${count(skipped, 'line')} ${skipped === 1 ? 'needs' : 'need'} a target word: use + on ${skipped === 1 ? 'it' : 'each'}.` : '',
    failed ? `${count(failed, 'card')} failed: the popup shows why.` : '',
  ].filter(Boolean).join(' ');
}

export const SELECT_CSS = `
  .minerr-lines .card-head .check { flex: none; width: 22px; height: 22px; min-height: 0; margin-right: 8px; padding: 0; border: 2px solid var(--muted);
    border-radius: 6px; color: var(--on-accent); font-size: 14px; font-weight: 800; line-height: 18px; opacity: 0; }
  .minerr-lines :is(li:hover, [data-selecting] li) .check, .minerr-lines .card-head .check:focus-visible { opacity: 1; }
  .minerr-lines .card-head .check[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-fill); color: var(--on-accent); }
  .minerr-lines li:has(.check[aria-pressed="true"]) { box-shadow: inset 0 0 0 2px var(--accent-soft), var(--shadow-1); }
  .minerr-lines-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 12px 12px 16px; border-top: 1px solid var(--line); }
  .minerr-lines-foot[hidden] { display: none; }
  .minerr-lines-foot span { flex: 1 1 160px; color: var(--muted); font-size: 14px; font-weight: 600; }
  .minerr-lines-foot button { padding: 4px 14px; }
  .minerr-lines-foot button[hidden] { display: none; }
  .minerr-lines-foot .create { border-color: transparent; background: var(--accent-fill); color: var(--on-accent); }
  .minerr-lines-foot .create:hover { background: var(--accent); }
`;

export interface Selection {
  // Selects the line, or takes it out of the selection. A run keeps the selection as it is.
  toggle: (index: number) => void;
  // New lines, or the panel closed: no selection, and a run stops after its card.
  reset: () => void;
}

// The bar goes at the bottom of panel. add makes the card of a line. changed shows the selection on the cards.
export function createSelection(panel: HTMLElement, add: (index: number) => Promise<Outcome>, changed: (selected: ReadonlySet<number>) => void): Selection {
  const bar = Object.assign(document.createElement('div'), { className: 'minerr-lines-foot', hidden: true });
  const text = Object.assign(document.createElement('span'), { role: 'status' });
  const clearButton = Object.assign(document.createElement('button'), { type: 'button', className: 'clear-selection' });
  const create = Object.assign(document.createElement('button'), { type: 'button', className: 'create' });
  bar.append(text, clearButton, create);
  panel.append(bar);
  let selected = new Set<number>();
  let run: Run = { kind: 'none' };

  function render(): void {
    bar.hidden = !selected.size && run.kind === 'none';
    text.textContent = run.kind === 'running' ? `Adding card ${run.done + 1} of ${run.total}…`
      : run.kind === 'done' ? run.text : `${count(selected.size, 'line')} selected`;
    clearButton.textContent = run.kind === 'running' ? 'Stop' : 'Clear';
    clearButton.disabled = run.kind === 'running' && run.stop;
    create.hidden = run.kind === 'running' || !selected.size;
    create.textContent = `Create ${count(selected.size, 'card')}`;
    panel.toggleAttribute('data-selecting', selected.size > 0);
    changed(selected);
  }

  async function start(): Promise<void> {
    const lines = [...selected].sort((a, b) => a - b);
    const current = { kind: 'running' as const, done: 0, total: lines.length, stop: false };
    run = current;
    const outcomes: Outcome[] = [];
    for (const index of lines) {
      if (current.stop) break;
      current.done = outcomes.length;
      render();
      const outcome = await add(index).catch(() => 'failed' as const);
      outcomes.push(outcome);
      // An error (Anki is closed, an open card form) would repeat for each line.
      if (outcome === 'failed') break;
    }
    if (run !== current) return;
    // The lines without a card stay selected, so the user sees which lines need a target word.
    selected = new Set(lines.filter((_, at) => outcomes[at] !== 'added'));
    run = { kind: 'done', text: summary(outcomes, lines.length) };
    render();
  }
  create.addEventListener('click', start);

  // Clear and Esc: a run stops after its card; else the selection and the result go. False when there is nothing to clear.
  function clear(): boolean {
    if (run.kind === 'running') {
      run.stop = true;
    } else if (selected.size || run.kind === 'done') {
      selected = new Set();
      run = { kind: 'none' };
    } else {
      return false;
    }
    render();
    return true;
  }
  clearButton.addEventListener('click', clear);
  panel.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !clear()) return;
    event.preventDefault();
    event.stopPropagation();
  });

  return {
    toggle: index => {
      if (run.kind === 'running') return;
      if (!selected.delete(index)) selected.add(index);
      run = { kind: 'none' };
      render();
    },
    reset: () => {
      if (run.kind === 'running') run.stop = true;
      selected = new Set();
      run = { kind: 'none' };
      render();
    },
  };
}
