/** Asks an agent to turn what it learned in a session into reviewed knowledge. */
export const HARVEST_PROMPT = [
  'Look back over this session for durable facts about this repository that a future agent would want: how something works, a gotcha, a convention, where something lives.',
  'For each, check it at the source, then call knowledge_propose with one self-contained sentence and a precise source (path:line or a commit hash). Propose at most 5.',
  'Skip anything knowledge_search already has, anything only about this task, and anything you did not verify.',
  'Finish with one line saying how many you proposed.'
].join(' ')
