// Non-ASCII text: 🛒 カート 购物车 कार्ट. V8 counts UTF-16 code units, so each emoji is two.
const GREETINGS = { ne: 'नमस्ते 🙏', ja: 'こんにちは 👋' };

export function greet(lang, name) {
  const greeting = GREETINGS[lang];
  if (!greeting) {
    return `👋👋 ${name}`;
  }
  return `${greeting}, ${name} 🎉`;
}

export function run() {
  return [greet('ne', 'आयुष'), greet('ja', '花子'), greet('xx', 'Sam')];
}
