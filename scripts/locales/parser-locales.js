import { EN_PARSER_LOCALE } from './parser-locale-en.js';
import { ZH_PARSER_LOCALE } from './parser-locale-zh.js';

const LOCALES = {
  'en': EN_PARSER_LOCALE,
  'zh': ZH_PARSER_LOCALE,
  'cn': ZH_PARSER_LOCALE,  // module.json uses "cn" as the lang code for Simplified Chinese
};

/**
 * Returns the parser locale for the current game language, falling back to EN.
 * The result is cached — call resetParserLocaleCache() if the language changes at runtime.
 */
let _cached = null;

export function getParserLocale() {
  if (_cached) return _cached;
  const lang = (game?.i18n?.lang ?? 'en').split('-')[0].toLowerCase();
  _cached = LOCALES[lang] ?? LOCALES['en'];
  return _cached;
}

export function resetParserLocaleCache() {
  _cached = null;
}
