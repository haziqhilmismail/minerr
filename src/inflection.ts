// How an inflected word is built from its dictionary form, as Yomitan shows it: すいてきた is すい + て (て-form)
// + き (〜てくる) + た (past). The steps come from the kuromoji tokens of the word that src/group.ts joins.
import { INFLECTING_POS, isShortCausative, wordGroups } from './group.ts';

// One token of the word: its text, and what it adds. The label of an unknown auxiliary is its basic form; the stem has none.
export interface Step {
  text: string;
  label: string;
}

// Checked before LABELS, for a token whose conjugation changes its meaning. た and だ share 特殊・タ; ず is a form of ぬ.
const FORM_LABELS: [(token: kuromoji.Token) => boolean, string][] = [
  [token => token.conjugated_type === '特殊・タ' && token.conjugated_form === '仮定形', 'conditional'],
  [token => token.conjugated_type === '特殊・タ', 'past'],
  [token => token.basic_form === 'ぬ' && token.conjugated_form === '連用ニ接続', 'negative: without'],
  [token => token.basic_form === 'ない' && token.conjugated_form.startsWith('仮定縮約'), 'must / if not'],
  [isShortCausative, 'causative'],
];

const TE_FORMS: [string[], string][] = [
  [['いる', '居る', 'てる'], '〜ている: ongoing / state'],
  [['ある'], '〜てある: done and left so'],
  [['おく', '置く', 'とく'], '〜ておく: in advance'],
  [['しまう', 'ちゃう', 'じゃう'], '〜てしまう: completely / by accident'],
  [['くる', '来る'], '〜てくる: start to / come to'],
  [['いく', '行く', 'てく'], '〜ていく: go on / away'],
  [['みる', '見る'], '〜てみる: try'],
  [['ほしい', '欲しい'], '〜てほしい: want someone to'],
  [['くれる'], '〜てくれる: for me'],
  [['もらう'], '〜てもらう: get someone to'],
  [['あげる'], '〜てあげる: for someone'],
  [['くださる', '下さる'], '〜てください: please'],
];

// The label of an auxiliary by its basic form.
const LABELS = new Map<string, string>([
  ['て', 'て-form'], ['で', 'て-form'], ['ば', 'conditional'],
  ['ない', 'negative'], ['ぬ', 'negative'], ['ん', 'negative'],
  ['ます', 'polite'], ['う', 'volitional'], ['よう', 'volitional'],
  ['れる', 'passive / potential'], ['られる', 'passive / potential'], ['せる', 'causative'], ['させる', 'causative'],
  ['たい', 'want to'], ['がる', '〜がる: shows signs of'], ['そう', 'looks like'], ['らしい', 'seems'], ['だ', 'is'],
  ['すぎる', '〜すぎる: too much'], ['やすい', '〜やすい: easy to'], ['にくい', '〜にくい: hard to'], ['なさる', '〜なさい: command'],
  ...TE_FORMS.flatMap(([forms, label]) => forms.map(form => [form, label] as const)),
]);

const labelOf = (token: kuromoji.Token) =>
  FORM_LABELS.find(([fits]) => fits(token))?.[1] ?? LABELS.get(token.basic_form) ?? token.basic_form;

// The head shows a label only for a form that means something without an auxiliary: 行け, 寒く, 書き.
function headLabel(head: kuromoji.Token, alone: boolean): string {
  if (head.conjugated_form.startsWith('命令')) return 'imperative';
  if (!alone) return '';
  if (head.pos === '形容詞' && head.conjugated_form === '連用テ接続') return 'adverb';
  return head.conjugated_form === '連用形' ? 'stem' : '';
}

// The steps of the text when it is one inflected verb or adjective, else none (a dictionary form, a noun, two words).
export function inflection(tokens: kuromoji.Token[]): Step[] {
  const [word, ...others] = wordGroups(tokens);
  if (!word || others.length) return [];
  const [head, ...auxiliaries] = word;
  const label = headLabel(head, !auxiliaries.length);
  if (!INFLECTING_POS.has(head.pos) || (!auxiliaries.length && !label)) return [];
  return [{ text: head.surface_form, label }, ...auxiliaries.map(token => ({ text: token.surface_form, label: labelOf(token) }))];
}

// The steps as one line: すい + て (て-form) + き (〜てくる: start to / come to) + た (past).
export const stepsText = (steps: Step[]) => steps.map(({ text, label }) => (label ? `${text} (${label})` : text)).join(' + ');
