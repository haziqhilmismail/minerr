// The pauses that Minerr makes: while the mouse is on the subtitle line or the popup of a subtitle word is open (holds),
// and after a pause of the play mode, which can play again after some seconds and open the popup of the first unknown word.
import { play } from './dom.ts';
import { openWord } from './popup.ts';
import { autoLookup, autoResume, type AutoResume, pauseOnHover } from './videosettings.ts';

export type Hold = 'hover' | 'popup';

const holds = new Set<Hold>();
// True while a hold paused the video, so the end of the last hold plays it again.
let heldPlaying = false;
// True from a pause of the play mode until the video plays again.
let modePaused = false;
let resumeTimer: ReturnType<typeof setTimeout> | undefined;
let holdOn = true;
let resumeAfter: AutoResume = 'off';
let lookup = false;


export function setHold(video: HTMLVideoElement, hold: Hold, on: boolean): void {
  if (on && holdOn) {
    if (!holds.size && !video.paused) {
      heldPlaying = true;
      video.pause();
    }
    holds.add(hold);
  } else if (holds.delete(hold) && !holds.size && heldPlaying) {
    heldPlaying = false;
    play(video);
  }
}

// The user played the video, or it played after a hold: the pauses of Minerr are over.
export function played(): void {
  heldPlaying = false;
  modePaused = false;
  clearTimeout(resumeTimer);
}

// The play mode paused the video at a line; line is the overlay line with the words of that line.
export function modePause(video: HTMLVideoElement, line: HTMLElement): void {
  video.pause();
  modePaused = true;
  clearTimeout(resumeTimer);
  if (resumeAfter !== 'off') {
    resumeTimer = setTimeout(() => {
      if (modePaused && !holds.size && video.paused) play(video);
    }, Number(resumeAfter) * 1000);
  }
  const unknown = line.querySelector<HTMLElement>('.ml-word.ml-unknown');
  if (lookup && unknown) openWord(unknown);
}

pauseOnHover.watch(value => { holdOn = value; });
autoResume.watch(value => { resumeAfter = value; });
autoLookup.watch(value => { lookup = value; });
