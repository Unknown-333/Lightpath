// Scoring rules for the README 10-second test. Written and committed before any run.
// Each point is a list of regexes; an answer earns the point if any of them matches.
// Don't edit these after results exist. If one is wrong, log it and report old and new scores.

export const POINTS = {
  ran: {
    label: 'shows the code that actually ran',
    patterns: [
      /\b(code|lines?|functions?|source)\b.{0,60}\b(ran|run|runs|executed|executes|executing|execution|triggered|fired)\b/i,
      /\b(ran|executed|executes|triggered)\b.{0,30}\b(code|lines?|functions?)\b/i,
      /\b(trace|traces|tracing|traced)\b.{0,60}\b(code|lines?|execution|functions?)\b/i,
      /\b(code|execution)\b.{0,30}\b(trace|traces|tracing|path|paths|flow)\b/i,
    ],
  },
  action: {
    label: 'for a click or action in the app',
    patterns: [/\b(click\w*|actions?|interactions?|buttons?|ui events?|user events?)\b/i],
  },
  stack: {
    label: 'frontend and backend',
    patterns: [
      /front-?end.{0,80}back-?end/i,
      /back-?end.{0,80}front-?end/i,
      /full[- ]?stack/i,
      /client.{0,40}server/i,
      /server.{0,40}client/i,
    ],
  },
  agents: {
    label: 'for coding agents',
    patterns: [/\bagents?\b/i, /\bLLMs?\b/i, /\bAI assistants?\b/i],
  },
};

/** Recorded, not scored: does the answer name developers as the audience? */
export const DEVELOPERS = /\b(developers?|devs?|engineers?|programmers?)\b/i;

/** Pass line: at least 3 of the 4 points, and "ran" must be one of them. */
export const PASS_MIN_POINTS = 3;
export const PASS_REQUIRED = 'ran';

export function score(answer) {
  const text = String(answer ?? '').replace(/\s+/g, ' ');
  const points = {};
  for (const [key, point] of Object.entries(POINTS)) {
    const hit = point.patterns.find((re) => re.test(text));
    points[key] = hit ? hit.source : null;
  }
  const total = Object.values(points).filter(Boolean).length;
  return {
    points: Object.fromEntries(Object.entries(points).map(([k, v]) => [k, v !== null])),
    matchedBy: points,
    total,
    developers: DEVELOPERS.test(text),
    pass: total >= PASS_MIN_POINTS && points[PASS_REQUIRED] !== null,
  };
}
