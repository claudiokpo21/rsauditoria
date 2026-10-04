/**
 * Dictado por voz con la Web Speech API del navegador (Chrome/Edge en Android y escritorio, Safari en iPhone).
 * En la mayoría de los equipos el reconocimiento lo hace el servicio del navegador y necesita conexión;
 * sin señal conviene usar el micrófono del teclado del celular, que en muchos equipos funciona sin conexión.
 */

type SRResult = { isFinal: boolean; 0: { transcript: string } };
type SREvent = { resultIndex: number; results: ArrayLike<SRResult> };
export interface SpeechRec {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SRCtor = new () => SpeechRec;

export function speechCtor(): SRCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
export const dictationSupported = () => !!speechCtor();

/** Comandos de voz habituales en un acta: "punto", "coma", "punto y aparte", "nueva línea"… */
const COMMANDS: [RegExp, string][] = [
  [/\s*\bpunto y aparte\b\s*/gi, '.\n'],
  [/\s*\b(nueva l[ií]nea|nuevo rengl[oó]n)\b\s*/gi, '\n'],
  [/\s*\bpunto y coma\b/gi, ';'],
  [/\s*\bdos puntos\b/gi, ':'],
  // "punto" sólo como signo: no en "punto de encuentro", "punto 3", etc.
  [/\s*\bpunto( seguido)?\b(?!\s+(de|del|a|al|en|cr[ií]tico|cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|\d))/gi, '.'],
  [/\s*\bcoma\b/gi, ','],
  [/\s*\bsigno de pregunta\b/gi, '?'],
  [/\s*\babrir par[eé]ntesis\b\s*/gi, ' ('],
  [/\s*\bcerrar par[eé]ntesis\b/gi, ')'],
  [/\s*\bguion\b\s*/gi, ' - '],
];

export function applyCommands(t: string): string {
  let s = t;
  for (const [re, rep] of COMMANDS) s = s.replace(re, rep);
  return s.replace(/([.,;:?)])(?=[^\s\n.,;:?)])/g, '$1 ').replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' ').trim();
}

/** Une el texto dictado al existente: espacio o salto según corresponda y mayúscula al empezar oración. */
export function joinDictation(prev: string, chunk: string): string {
  let c = applyCommands(chunk);
  if (!c) return prev;
  const base = prev.replace(/[ \t]+$/, '');
  const sentenceStart = !base || /[.?!:\n]$/.test(base);
  if (sentenceStart) c = c.replace(/^(\s*)(\p{L})/u, (_, sp: string, ch: string) => sp + ch.toUpperCase());
  c = c.replace(/([.?!]\s+|\n)(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
  const sep = !base || base.endsWith('\n') || c.startsWith('\n') || /^[.,;:?)]/.test(c) ? '' : ' ';
  return base + sep + c;
}

/** Fija el valor de un textarea controlado por React y dispara los eventos que React escucha. */
export function setNativeValue(el: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export function dictationErrorText(code: string): string {
  switch (code) {
    case 'not-allowed': case 'service-not-allowed':
      return 'El navegador no tiene permiso para usar el micrófono. Habilítelo en el candado de la barra de direcciones (o en Ajustes del celular) y vuelva a intentar.';
    case 'network':
      return 'El dictado de este navegador necesita conexión. Sin señal, use el micrófono del teclado del celular o escriba el texto.';
    case 'audio-capture': return 'No se encontró un micrófono disponible.';
    case 'language-not-supported': return 'El navegador no tiene reconocimiento de voz en español.';
    case 'no-speech': return 'No se escuchó nada. Hable cerca del micrófono y vuelva a intentar.';
    default: return 'No se pudo usar el dictado por voz (' + code + ').';
  }
}
