# learn-tamil

A phone-friendly Tamil memory trainer for Lessons 1–5 of the class, built on the techniques in *Moonwalking with Einstein*:

- **Hooks (elaborative encoding):** every word gets a vivid sound-image shown as three lines (Sound, Meaning, See it), often with a colour picture.
- **Memory palaces:** sets of words (like the six tastes) are placed at spots in a place you know.
- **Chunking:** grammar patterns (near/far/question, -aa? questions, -nga politeness…) are learned once as a rule, then drilled.
- **Spaced review:** cards come back just before you would forget them, within a time budget per bus ride. Hooks only reappear after a miss and fade once a word holds for a week.
- **Sounds:** a guide to reading the romanised spellings, and a 🔊 button where the phone has a Tamil voice.

**Use it:** https://yeokimsiang.github.io/learn-tamil/ (add it to your home screen; it works offline).

Set *Settings → Lessons your class has reached* so new words only come from lessons you've covered.

Progress is stored only in your browser. Use *Settings → Export backup* now and then.

## Repo layout
- `lessons/`: the source lesson PDFs
- `docs/`: the site served by GitHub Pages (no build step)
  - `data/lessonN.js`: lesson content (words, hooks, patterns, phrases, palaces)
  - `img/`: generated colour pictures (not every word has one)
- `tools/`: maintenance scripts
  - `node tools/check-data.mjs`: validates the data and checks it covers every vocab line in the PDFs
  - `node tools/gen_images.mjs [ids…] [--seed N]`: (re)generates pictures (set `IMG_OUT=dir` to stage them for review)
