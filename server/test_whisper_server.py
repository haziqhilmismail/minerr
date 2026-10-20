"""Run: python3 -I -B -m unittest discover -s server -v (needs no WhisperX install)."""

import unittest

from whisper_server import split_segment, subtitle_segments, video_id


class VideoId(unittest.TestCase):
    def test_youtube_urls(self):
        for url in ('https://www.youtube.com/watch?v=KfQPZZ5JmXw&list=PL1&t=30s',
                    'http://m.youtube.com/watch?feature=share&v=KfQPZZ5JmXw',
                    'https://youtu.be/KfQPZZ5JmXw?si=abc',
                    'https://www.youtube.com/shorts/KfQPZZ5JmXw'):
            self.assertEqual(video_id(url), 'KfQPZZ5JmXw', url)

    def test_rejects(self):
        for url, message in (('file:///etc/passwd', 'http or https'),
                             ('--exec=rm -rf ~', 'http or https'),
                             ('https://example.com/watch?v=KfQPZZ5JmXw', 'YouTube video URL'),
                             ('https://www.youtube.com/watch?v=../../etc', 'no YouTube video id'),
                             ('https://www.youtube.com/feed/subscriptions', 'no YouTube video id')):
            with self.assertRaisesRegex(ValueError, message, msg=url):
                video_id(url)


class SplitSegment(unittest.TestCase):
    def test_short_segment_stays_whole(self):
        self.assertEqual(split_segment({'start': 1.0, 'end': 3.0, 'text': ' 猫が魚を食べた。犬も。 '}),
                         [{'start': 1.0, 'end': 3.0, 'text': '猫が魚を食べた。犬も。'}])

    def test_long_segment_splits_at_sentence_ends_with_proportional_time(self):
        text = 'あ' * 19 + '。' + '「' + 'い' * 8 + '！」' + 'う' * 10
        self.assertEqual(split_segment({'start': 10.0, 'end': 51.0, 'text': text}), [
            {'start': 10.0, 'end': 30.0, 'text': 'あ' * 19 + '。'},
            {'start': 30.0, 'end': 41.0, 'text': '「' + 'い' * 8 + '！」'},
            {'start': 41.0, 'end': 51.0, 'text': 'う' * 10},
        ])

    def test_space_ends_a_sentence_in_a_long_segment(self):
        self.assertEqual(split_segment({'start': 0.0, 'end': 41.0, 'text': 'か' * 20 + ' ' + 'き' * 20}), [
            {'start': 0.0, 'end': 20.5, 'text': 'か' * 20},
            {'start': 20.5, 'end': 41.0, 'text': 'き' * 20},
        ])

    def test_long_segment_without_sentence_end_stays_whole(self):
        self.assertEqual(split_segment({'start': 0.0, 'end': 9.0, 'text': 'え' * 50}),
                         [{'start': 0.0, 'end': 9.0, 'text': 'え' * 50}])

    def test_empty_segments_drop_out(self):
        self.assertEqual(subtitle_segments([{'start': 0.0, 'end': 1.0, 'text': '  '},
                                            {'start': 1.0, 'end': 2.0, 'text': 'はい'}]),
                         [{'start': 1.0, 'end': 2.0, 'text': 'はい'}])


if __name__ == '__main__':
    unittest.main()
