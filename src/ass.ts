import { clone, msToAss } from "./utils";
import KBPParser from "./kbp";
import stringify from "./assStringify";
import type {
  IStyle,
  IConfig,
  ISentence,
  ISyllable,
  IDialogueKV,
  IStyleKV,
  IEvents,
} from "./types";
import * as ass from "./assTemplate";

export const defaultConfig: IConfig = {
  wipe: false,
  position: false,
  border: false,
  cdg: false,
  "full-mode": false,
  transparency: false,
  "minimum-progression-duration": 100,
  fade: "300,200",
  offset: 0,
  "syllable-precision": true,
};

function generateASSLine(line: ISentence, options: IConfig) {
  const assLine: string[] = [];
  let startMs = line.start;
  const stopMs = line.end;
  let firstStart: number | null = null;
  let lastSylEnd: number | null = null;
  let gap = null;
  line.syllables?.forEach(syl => {
    gap =
      lastSylEnd != null && syl.start - lastSylEnd > 10
        ? `{\\k${(syl.start - lastSylEnd) / 10}}`
        : "";
    assLine.push(
      `${gap}{\\k${getProgressive(syl, options)}${Math.floor(
        syl.duration / 10
      )}}${syl.text}`
    );

    if (firstStart == null) firstStart = syl.start;
    lastSylEnd = syl.end;
  });
  const dialogue = clone(ass.defaultDialogue);

  dialogue.value.Start = msToAss(startMs);
  dialogue.value.End = msToAss(stopMs);
  dialogue.value.Style = line.currentStyle;

  const comment: IDialogueKV<"Comment"> = {
    key: "Comment",
    value: { ...dialogue.value, Text: assLine.join(""), Effect: "karaoke" },
  };

  // Horizontal offset only makes sense when there is a set number of pixels to center across
  const hOffset = options.cdg || line.alignment != 8 ? line.hpos : 0;
  const pos = options.position ? `\\pos(${hOffset},${line.vpos})` : "";

  // TODO: only use \anX when it differs from style? Currently line only stores style name, and style detail is not passed in.
  dialogue.value.Text = `{\\an${line.alignment}${pos}\\k${
    (firstStart ?? startMs - startMs) / 10
  }${options.dialogueScript}}${assLine.join("")}`;
  dialogue.value.Effect = "fx";

  return {
    dialogue,
    comment,
  };
}

function getProgressive(syl: ISyllable, options: IConfig) {
  // When duration exceeds the threshold, progressive wiping may be possible
  if (
    Math.floor(syl.duration / 10) >
    Math.floor(options["minimum-progression-duration"] ?? 0 / 10)
  ) {
    // If option is set to use wiping setting from the kbp file, do so, otherwise set unconditionally
    return options.wipe && !syl.wipeProgressive ? "" : "f";
    // If duration does not exceed the threshold, progressive wiping cannot be
    // used, regardless of kbp setting
  } else {
    return "";
  }
}

function sortStartTime<T>(a: IDialogueKV<T>, b: IDialogueKV<T>) {
  if (a.value.Start < b.value.Start) return -1;
  if (a.value.Start > b.value.Start) return 1;
  return 0;
}

function getStyleAss(style: IStyle): IStyleKV {
  return {
    key: "Style",
    value: {
      ...ass.defaultStyle.value,
      ...style,
    },
  };
}

function fadeToDialogueScript(fade: string) {
  let [fade_in, fade_out] = fade.split(",").map(x => parseInt(x));
  if (fade_out === undefined) fade_out = fade_in;
  if (fade_in == 0 && fade_out == 0) {
    return "";
  } else {
    return `\\fad(${fade_in},${fade_out})`;
  }
}

/** Convert KBP data (txt) to ASS */
export function convertToASS(time: string, options: IConfig = {}) {
  options = { ...defaultConfig, ...options };
  options.fade = fadeToDialogueScript(options.fade!);
  const kbp = new KBPParser(options);
  const kara = kbp.parse(time);
  const dialogues: IDialogueKV<"Dialogue">[] = [];
  const comments: IDialogueKV<"Comment">[] = [];

  const styles = clone(ass.styles);
  styles.body = styles.body.concat(
    kbp.styles.length > 0
      ? kbp.styles.map(style => getStyleAss(style))
      : [{ ...ass.defaultStyle }]
  );

  if (!("dialogueScript" in options)) {
    options.dialogueScript = ass.dialogueScript;
  }

  comments.push({
    key: "Comment",
    value: {
      ...ass.defaultDialogue.value,
      Effect: ass.scriptFX,
      Text: ass.script,
    },
  });
  for (const line of kara.track) {
    const assLines = generateASSLine(line, options);
    comments.push(clone(assLines.comment));
    dialogues.push(clone(assLines.dialogue));
  }
  comments.sort(sortStartTime);
  dialogues.sort(sortStartTime);
  const events: IEvents = {
    section: "Events",
    body: [...ass.events.body, ...comments, ...dialogues],
  };

  const header = clone(ass.scriptInfo);
  if (options.cdg) {
    if (options.border) {
      header.body.push(
        { key: "PlayResX", value: 300 },
        { key: "PlayResY", value: 216 }
      );
    } else {
      header.body.push(
        { key: "PlayResX", value: 288 },
        { key: "PlayResY", value: 192 }
      );
    }
  }
  return stringify([header, styles, events]);
}
