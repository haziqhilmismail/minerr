// Unit tests of the Netflix subtitle list, the choice of the track, the TTML reader, and the card of a protected video.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILTIN, type CardFields, noteDraft } from '../src/anki/anki.ts';
import { choose, type Manifest, parseTrack, parseTtml, toReply } from '../src/video/netflix/netflix-captions.ts';

const downloadable = (url: string) => ({ urls: [{ url, cdn_id: 0 }] });
// A subtitle list as the Netflix player reads it, with the none track, a forced track, and the two URL shapes.
const TIMEDTEXTTRACKS = [
  { new_track_id: 'T:none', language: null, isNoneTrack: true, ttDownloadables: {} },
  { new_track_id: 'T:ja', language: 'ja', rawTrackType: 'subtitles', isForcedNarrative: false, isNoneTrack: false,
    ttDownloadables: { 'dfxp-ls-sdh': downloadable('https://cdn.example/ja.dfxp'), 'webvtt-lssdh-ios8': downloadable('https://cdn.example/ja.vtt') } },
  { new_track_id: 'T:ja-cc', language: 'ja', rawTrackType: 'closedcaptions', isForcedNarrative: false, isNoneTrack: false,
    ttDownloadables: { 'dfxp-ls-sdh': { downloadUrls: { 7: 'https://cdn.example/ja-cc.dfxp' } } } },
  { new_track_id: 'T:ja-forced', language: 'ja', rawTrackType: 'subtitles', isForcedNarrative: true, isNoneTrack: false,
    ttDownloadables: { 'webvtt-lssdh-ios8': downloadable('https://cdn.example/ja-forced.vtt') } },
  { new_track_id: 'T:en', language: 'en', rawTrackType: 'subtitles', isForcedNarrative: false, isNoneTrack: false,
    ttDownloadables: { 'webvtt-lssdh-ios8': downloadable('http://cdn.example/en.vtt'), 'simplesdh': downloadable('https://cdn.example/en.sdh') } },
  { new_track_id: 'T:ko', language: 'ko', rawTrackType: 'subtitles', isForcedNarrative: false, isNoneTrack: false,
    ttDownloadables: { 'nflx-cmisc': downloadable('https://cdn.example/ko.img') } },
];
const reply = (tracks: unknown, selected: unknown = null) => ({ minerr: 'manifest', movieId: '81001', tracks, selected, known: ['81001'] });

test('toReply reads the tracks of the reply for the title: no none track, both URL shapes, https only', () => {
  assert.deepEqual(toReply(reply(TIMEDTEXTTRACKS, 'T:ja-cc'), '81001'), {
    known: ['81001'],
    manifest: {
      movieId: '81001',
      selected: 'T:ja-cc',
      tracks: [
        { id: 'T:ja', language: 'ja', kind: 'subtitles', forced: false, urls: { 'dfxp-ls-sdh': 'https://cdn.example/ja.dfxp', 'webvtt-lssdh-ios8': 'https://cdn.example/ja.vtt' } },
        { id: 'T:ja-cc', language: 'ja', kind: 'closedcaptions', forced: false, urls: { 'dfxp-ls-sdh': 'https://cdn.example/ja-cc.dfxp' } },
        { id: 'T:ja-forced', language: 'ja', kind: 'subtitles', forced: true, urls: { 'webvtt-lssdh-ios8': 'https://cdn.example/ja-forced.vtt' } },
        { id: 'T:en', language: 'en', kind: 'subtitles', forced: false, urls: { simplesdh: 'https://cdn.example/en.sdh' } },
        { id: 'T:ko', language: 'ko', kind: 'subtitles', forced: false, urls: {} },
      ],
    },
  });
  assert.equal(toReply(reply(TIMEDTEXTTRACKS), '81002'), null, 'the reply of another title does not count');
  assert.deepEqual(toReply({ minerr: 'manifest', movieId: '81001', tracks: null, known: ['81000'] }, '81001'),
    { manifest: null, known: ['81000'] }, 'a reply without the list says which titles the player has');
  assert.equal(toReply({ minerr: 'ask', movieId: '81001' }, '81001'), null);
});

const manifest = (selected: string | null): Manifest => {
  const found = toReply(reply(TIMEDTEXTTRACKS, selected), '81001')?.manifest;
  assert.ok(found);
  return found;
};

test('choose takes the shown Japanese track, else the subtitles before the closed captions, WebVTT before TTML, never a forced track', () => {
  assert.deepEqual(choose(manifest(null), 'ja'), { kind: 'text', profile: 'webvtt-lssdh-ios8', url: 'https://cdn.example/ja.vtt' });
  assert.deepEqual(choose(manifest('T:ja-cc'), 'ja'), { kind: 'text', profile: 'dfxp-ls-sdh', url: 'https://cdn.example/ja-cc.dfxp' });
  assert.deepEqual(choose(manifest('T:ja-forced'), 'ja'), { kind: 'text', profile: 'webvtt-lssdh-ios8', url: 'https://cdn.example/ja.vtt' });
  assert.deepEqual(choose(manifest('T:en'), 'en'), { kind: 'text', profile: 'simplesdh', url: 'https://cdn.example/en.sdh' });
  assert.deepEqual(choose(manifest(null), 'ko'), { kind: 'image' });
  assert.deepEqual(choose(manifest(null), 'fr'), { kind: 'none' });
});

const TTML = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:tickRate="10000000" xml:lang="ja">
<body><div>
<p begin="30000000t" end="15000000t" xml:id="s0"><span>終了が先</span></p>
<p begin="25000000t" end="40000000t" region="r1" xml:id="s2"><span>&#8206;魚が</span><br/><span>好き&#x200E;</span></p>
<p begin="00:00:01.500" end="00:00:02.500" xml:id="s1">猫が<span tts:fontStyle="italic">好き</span></p>
<p begin="25000000t" end="40000000t" region="r2" xml:id="s3">（音楽）</p>
<p begin="5s" end="6500ms" xml:id="s4"></p>
<p begin="00:00:07:15" end="00:00:08:00" xml:id="s5">半分</p>
</div></body></tt>`;

test('parseTtml reads ticks, clock times, offsets, and frames, joins the regions of one time, and drops empty and reversed lines', () => {
  assert.deepEqual(parseTtml(TTML), [
    { start: 1.5, end: 2.5, text: '猫が好き' },
    { start: 2.5, end: 4, text: '魚が\n好き\n（音楽）' },
    { start: 7.5, end: 8, text: '半分' },
  ]);
});

test('parseTrack reads WebVTT with the WebVTT reader and the other formats as TTML', () => {
  assert.deepEqual(parseTrack('webvtt-lssdh-ios8', 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000 position:50%\n<c.japanese>猫</c>\n'), [{ start: 1, end: 2, text: '猫' }]);
  assert.deepEqual(parseTrack('dfxp-ls-sdh', TTML)[0], { start: 1.5, end: 2.5, text: '猫が好き' });
});

const CARD: CardFields = { word: '猫', reading: 'ねこ', sentence: '<b>猫</b>が好き', definition: 'cat', entry: null, selection: '' };

test('noteDraft without a screenshot (a protected video) has no picture file and an empty Image field', () => {
  const page = { url: 'https://www.netflix.com/watch/81001', title: 'Title' };
  const draft = noteDraft(BUILTIN, CARD, page);
  assert.deepEqual(draft.media, []);
  assert.equal(draft.fields.Image, '');
  const shot = noteDraft(BUILTIN, { ...CARD, image: { filename: 'minerr-1.jpg', data: '/9j/4AAQ' } }, page);
  assert.deepEqual(shot.media, [{ filename: 'minerr-1.jpg', data: '/9j/4AAQ' }]);
  assert.equal(shot.fields.Image, '<img src="minerr-1.jpg">');
});
