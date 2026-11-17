# learn-tamil

A phone-friendly Tamil memory trainer built on the techniques in *Moonwalking with Einstein*:

- **Hooks (elaborative encoding):** every word gets a vivid sound-image that covers every syllable, plus a rough sketch.
- **Memory palaces:** sets of words (like the six tastes) are placed at spots in a place you know.
- **Chunking:** grammar patterns (near/far/question, -aa? questions, -nga politeness…) are learned once as a rule, then drilled.
- **Spaced review:** cards come back just before you would forget them. Hooks fade once a word is known.

**Use it:** https://yeokimsiang.github.io/learn-tamil/ (add it to your home screen; it works offline).

Progress is stored only in your browser. Use *Settings → Export backup* now and then.

## Repo layout
- `lessons/`: the source lesson PDFs
- `docs/`: the site served by GitHub Pages (no build step)
  - `data/lessonN.js`: lesson content (words, hooks, patterns, phrases, palaces)
  - `img/`: generated sketches, one per word
- `tools/`: maintenance scripts
  - `node tools/check-data.mjs`: validates the data and checks it covers every vocab line in the PDFs
  - `node tools/gen_images.mjs [ids…] [--seed N]`: (re)generates sketches
