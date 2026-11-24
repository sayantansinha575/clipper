import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { DIRS } from '../config.ts';
import type { CaptionStyleConfig, TranscriptData, TranscriptWord } from '../types.ts';

let cachedInstalledFonts: string[] | null = null;

export function getInstalledFonts(): string[] {
  if (cachedInstalledFonts) return cachedInstalledFonts;
  try {
    const out = execFileSync('fc-list', [':', 'family'], { encoding: 'utf-8' });
    const families = Array.from(
      new Set(
        out
          .split('\n')
          .flatMap((line) => line.split(','))
          .map((s) => s.trim())
          .filter(Boolean)
      )
    ).sort();
    cachedInstalledFonts = families;
    return families;
  } catch {
    cachedInstalledFonts = ['DejaVu Sans', 'Liberation Sans', 'Noto Sans'];
    return cachedInstalledFonts;
  }
}

export function resolveAvailableFont(requestedFont: string): string {
  const installed = getInstalledFonts();
  const exact = installed.find((f) => f.toLowerCase() === requestedFont.toLowerCase());
  if (exact) return exact;
  for (const fallback of ['DejaVu Sans', 'Liberation Sans', 'Noto Sans', 'Arial']) {
    const match = installed.find((f) => f.toLowerCase() === fallback.toLowerCase());
    if (match) return match;
  }
  return installed[0] || 'DejaVu Sans';
}

function hexToAssColor(hex: string, alpha = '00'): string {
  // ASS uses &HAABBGGRR
  const clean = hex.replace('#', '').trim();
  if (clean.length !== 6) return `&H${alpha}FFFFFF`;
  const r = clean.slice(0, 2).toUpperCase();
  const g = clean.slice(2, 4).toUpperCase();
  const b = clean.slice(4, 6).toUpperCase();
  return `&H${alpha}${b}${g}${r}`;
}

function formatAssTime(sec: number): string {
  const clamped = Math.max(0, sec);
  const hours = Math.floor(clamped / 3600);
  const mins = Math.floor((clamped % 3600) / 60);
  const secs = Math.floor(clamped % 60);
  const cs = Math.round((clamped - Math.floor(clamped)) * 100);
  const adjCs = cs >= 100 ? 99 : cs;
  return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(adjCs).padStart(2, '0')}`;
}

function formatSrtTime(sec: number): string {
  const clamped = Math.max(0, sec);
  const hours = Math.floor(clamped / 3600);
  const mins = Math.floor((clamped % 3600) / 60);
  const secs = Math.floor(clamped % 60);
  const ms = Math.round((clamped - Math.floor(clamped)) * 1000);
  const adjMs = ms >= 1000 ? 999 : ms;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(adjMs).padStart(3, '0')}`;
}

function escapeAssText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}');
}

interface CaptionPhrase {
  start: number;
  end: number;
  words: TranscriptWord[];
}

function collectClipPhrases(
  transcript: TranscriptData,
  clipStart: number,
  clipEnd: number,
  wordsPerLine: number
): CaptionPhrase[] {
  const clipDur = Math.max(0.2, clipEnd - clipStart);
  const clipWords: TranscriptWord[] = [];

  for (const seg of transcript.segments) {
    if (seg.end <= clipStart || seg.start >= clipEnd) continue;
    for (const w of seg.words) {
      if (w.end <= clipStart || w.start >= clipEnd) continue;
      const localStart = Math.max(0, w.start - clipStart);
      // Cap abnormally stretched word end times from Whisper VAD gaps
      const rawLocalEnd = Math.min(clipDur, w.end - clipStart, localStart + 2.0);
      const localEnd = Math.min(clipDur, Math.max(localStart + 0.08, rawLocalEnd));
      clipWords.push({
        word: w.word,
        start: Number(localStart.toFixed(3)),
        end: Number(localEnd.toFixed(3)),
      });
    }
  }

  if (clipWords.length === 0) return [];
  clipWords.sort((a, b) => a.start - b.start);

  const groupSize = Math.max(1, Math.min(6, wordsPerLine));
  const maxPauseGapSec = 0.65;
  const phrases: CaptionPhrase[] = [];
  let current: TranscriptWord[] = [];

  const flushPhrase = () => {
    if (current.length === 0) return;
    phrases.push({
      start: current[0].start,
      end: Math.min(clipDur, Math.max(current[0].start + 0.25, current[current.length - 1].end)),
      words: current,
    });
    current = [];
  };

  for (const word of clipWords) {
    const prev = current[current.length - 1];
    if (prev && (current.length >= groupSize || word.start - prev.end > maxPauseGapSec)) {
      flushPhrase();
    }
    current.push(word);
  }
  flushPhrase();

  return phrases;
}

export function generateClipSubtitles(params: {
  clipId: string;
  transcript: TranscriptData;
  clipStart: number;
  clipEnd: number;
  style: CaptionStyleConfig;
  playResX: number;
  playResY: number;
}): { assPath: string; srtPath: string; cueCount: number } {
  const { clipId, transcript, clipStart, clipEnd, style, playResX, playResY } = params;
  const assPath = path.join(DIRS.subtitles, `${clipId}.ass`);
  const srtPath = path.join(DIRS.subtitles, `${clipId}.srt`);

  const fontName = resolveAvailableFont(style.font);
  const scaleRatio = playResX / 1080;
  const fontSize = Math.max(24, Math.round(style.fontSize * scaleRatio));
  const outline = Math.max(1, Math.round(style.outlineWidth * scaleRatio));
  const shadow = Math.max(0, Math.round(style.shadowDepth * scaleRatio));

  // ASS Alignment: 2=bottom-center, 5=middle-center, 8=top-center
  let alignment = 2;
  let marginV = Math.round(playResY * 0.22); // lower-middle screen placement for 9:16
  if (style.position === 'middle') {
    alignment = 5;
    marginV = 0;
  } else if (style.position === 'top') {
    alignment = 8;
    marginV = Math.round(playResY * 0.14);
  }

  const primaryAss = hexToAssColor(style.primaryColor);
  const secondaryAss = hexToAssColor(style.primaryColor);
  const highlightAss = hexToAssColor(style.highlightColor);
  const outlineAss = hexToAssColor(style.outlineColor);
  const backAss = '&H99000000';

  const header = [
    '[Script Info]',
    '; Generated by AI Shorts Studio',
    'ScriptType: v4.00+',
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${fontName},${fontSize},${highlightAss},${primaryAss},${outlineAss},${backAss},-1,0,0,0,100,100,0,0,1,${outline},${shadow},${alignment},48,48,${marginV},1`,
    `Style: Static,${fontName},${fontSize},${primaryAss},${secondaryAss},${outlineAss},${backAss},-1,0,0,0,100,100,0,0,1,${outline},${shadow},${alignment},48,48,${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const phrases = collectClipPhrases(transcript, clipStart, clipEnd, style.wordsPerLine);
  const dialogueLines: string[] = [];
  const srtBlocks: string[] = [];

  phrases.forEach((phrase, idx) => {
    const renderedWords = phrase.words.map((w) => {
      const text = style.uppercase ? w.word.toUpperCase() : w.word;
      return { ...w, display: escapeAssText(text) };
    });

    // Build SRT entry
    srtBlocks.push(
      `${idx + 1}\n${formatSrtTime(phrase.start)} --> ${formatSrtTime(phrase.end)}\n${renderedWords
        .map((w) => w.display)
        .join(' ')}\n`
    );

    if (style.preset === 'minimal_white' || style.animationIntensity === 'none') {
      const fadeTag = style.preset === 'minimal_white' ? '{\\fad(80,80)}' : '';
      dialogueLines.push(
        `Dialogue: 0,${formatAssTime(phrase.start)},${formatAssTime(phrase.end)},Static,,0,0,0,,${fadeTag}${renderedWords
          .map((w) => w.display)
          .join(' ')}`
      );
      return;
    }

    if (style.preset === 'karaoke') {
      // Smooth fill karaoke line using \kf
      const karaokeTags = renderedWords
        .map((w) => {
          const cs = Math.max(10, Math.round((w.end - w.start) * 100));
          return `{\\kf${cs}}${w.display}`;
        })
        .join(' ');
      dialogueLines.push(
        `Dialogue: 0,${formatAssTime(phrase.start)},${formatAssTime(phrase.end)},Default,,0,0,0,,{\\fad(60,60)}${karaokeTags}`
      );
      return;
    }

    // Word-by-word active highlighting with pop-in scale animation
    const popScale = style.animationIntensity === 'high' ? 114 : 106;
    for (let wIdx = 0; wIdx < renderedWords.length; wIdx++) {
      const active = renderedWords[wIdx];
      const nextWord = renderedWords[wIdx + 1];
      const segStart = wIdx === 0 ? phrase.start : active.start;
      const segEnd = nextWord
        ? Math.min(Math.max(active.start + 0.08, nextWord.start), active.end + 0.45)
        : phrase.end;

      const lineContent = renderedWords
        .map((w, j) => {
          if (j === wIdx) {
            return `{\\1c${highlightAss}\\fscx${popScale}\\fscy${popScale}\\t(0,90,\\fscx100\\fscy100)}${w.display}{\\1c${primaryAss}}`;
          }
          return `{\\1c${primaryAss}}${w.display}`;
        })
        .join(' ');

      const entryAnim =
        wIdx === 0 && style.animationIntensity === 'high'
          ? '{\\fscx92\\fscy92\\t(0,75,\\fscx100\\fscy100)}'
          : '';

      dialogueLines.push(
        `Dialogue: 0,${formatAssTime(segStart)},${formatAssTime(segEnd)},Default,,0,0,0,,${entryAnim}${lineContent}`
      );
    }
  });

  const assContent = [...header, ...dialogueLines, ''].join('\n');
  fs.writeFileSync(assPath, assContent, 'utf-8');
  fs.writeFileSync(srtPath, srtBlocks.join('\n'), 'utf-8');

  return { assPath, srtPath, cueCount: phrases.length };
}
