// Instagram business accounts often auto-answer. Those are not real replies and must not
// move a lead forward or trigger a human-style answer.
const PATTERNS = [
  /thanks? (for|you for) (contacting|reaching out|messaging|your message)/i,
  /we('ve| have) received your message/i,
  /(someone|a member of our team|our team) will (get back|reply|respond|be in touch)/i,
  /this is an automated (message|response|reply)/i,
  /away (right now|at the moment)/i,
  /gracias por (contactar|escribir|comunicarte)/i,
  /(cerrando|cerrar) (el )?chat/i,
];

export function isAutoReply(text: string): boolean {
  return PATTERNS.some((p) => p.test(text));
}
