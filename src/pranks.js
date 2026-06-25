// Easter egg: when the whole prompt is just a greeting, suggest a tongue-in-cheek
// "completion". If the user presses Tab on it, they get a gotcha line instead of
// an accept. Lists are randomized so it isn't the same every time.

const GREETING = /^(hi+|hey+|hello+|yo+|sup|hiya|howdy|heya|hi there|hey there|hello there|hey claude|hi claude|hello claude|good morning|good evening|gm|ola|hola|greetings)[\s!.,?]*$/i;

export function isGreeting(buffer) {
  return GREETING.test(buffer.trim());
}

const JOKES = [
  ' build something amazing and make zero mistakes',
  ' refactor the entire codebase before lunch',
  ' fix every bug, including the ones not written yet',
  ' write flawless code on the first try, no edits',
  ' ship straight to prod on a Friday afternoon',
  ' become sentient and adopt the repo',
  ' solve P vs NP real quick then add dark mode',
  ' delete node_modules and finally feel something',
  ' rewrite it in Rust for no particular reason',
  ' achieve 100% test coverage by sheer willpower',
  ' make it 10x faster and also telepathic',
  ' do everything, perfectly, and read my mind'
];

const GOTCHAS = [
  'lol jk — type something real and I\'ll actually autocomplete :)',
  'gotcha 😄 give me a real prompt and I got you',
  'haha no. say what you actually need 👍',
  'just kidding! I only autocomplete real prompts',
  'psych! type the real thing, I\'m ready :)',
  'nice try 😏 now tell me what you really want',
  'that one was on the house. real prompt please :)'
];

const pick = arr => arr[Math.floor(Math.random() * arr.length)];

export function jokeSuggestion() { return pick(JOKES); }
export function gotcha() { return pick(GOTCHAS); }
