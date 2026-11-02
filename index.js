/**
 * Model-facing `classify_text` tool for the WeBuddhist Library.
 *
 * Fetches https://library.webuddhist.com/v2/texts/<text_id> and classifies the
 * text as a root text, a translation, or a commentary from `translation_of` and
 * `commentary_of`. No authentication is required. Failures are returned as
 * `{ error }` values instead of thrown errors.
 * @module @tenzdelek/dsh-classify-text
 */

const LIBRARY_ORIGIN = "https://library.webuddhist.com";
const TEXTS_PATH = "/v2/texts/";
const REQUEST_TIMEOUT_MS = 15000;

/** Services this plugin needs from the composition. */
const inject = ["tools"];

/** Human-readable names for the language codes the library commonly returns. */
const LANGUAGE_NAMES = {
  ae: "Avestan",
  ar: "Arabic",
  bn: "Bengali",
  bo: "Tibetan",
  de: "German",
  el: "Greek",
  en: "English",
  es: "Spanish",
  fa: "Persian",
  fr: "French",
  he: "Hebrew",
  hi: "Hindi",
  id: "Indonesian",
  it: "Italian",
  ja: "Japanese",
  km: "Khmer",
  ko: "Korean",
  la: "Latin",
  lo: "Lao",
  mn: "Mongolian",
  ms: "Malay",
  my: "Burmese",
  ne: "Nepali",
  nl: "Dutch",
  pi: "Pali",
  pl: "Polish",
  pt: "Portuguese",
  ru: "Russian",
  sa: "Sanskrit",
  si: "Sinhala",
  sv: "Swedish",
  ta: "Tamil",
  th: "Thai",
  tr: "Turkish",
  ur: "Urdu",
  vi: "Vietnamese",
  zh: "Chinese",
};

/**
 * Pick the first usable title value, preferring `en` and otherwise taking the
 * first non-blank string in the response's own key order.
 * @param title - the `title` field of a text record.
 * @returns the chosen title, or `null` when the record carries none.
 */
function pickTitle(title) {
  if (title === null || typeof title !== "object" || Array.isArray(title)) return null;
  const preferred = title.en;
  if (typeof preferred === "string" && preferred.trim().length > 0) return preferred.trim();
  for (const value of Object.values(title)) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

/**
 * Turn a model-supplied id or library URL into a bare text id.
 * @param input - a bare id or `https://library.webuddhist.com/v2/texts/<id>`.
 * @returns `{ id }` on success, or `{ error }` with a short reason.
 */
function extractTextId(input) {
  if (typeof input !== "string" || input.trim().length === 0) return { error: "text_id is required" };
  const raw = input.trim();
  if (/^https?:\/\//i.test(raw)) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      return { error: `invalid URL: ${raw}` };
    }
    const match = url.pathname.match(/^\/v2\/texts\/([^/]+)\/?$/);
    if (url.hostname !== "library.webuddhist.com" || match === null) {
      return { error: `not a WeBuddhist Library text URL: ${raw}` };
    }
    try {
      return { id: decodeURIComponent(match[1]) };
    } catch {
      return { error: `invalid URL: ${raw}` };
    }
  }
  return { id: raw };
}

/**
 * GET one library URL and report the outcome without throwing.
 * @param url - absolute URL to fetch.
 * @param outerSignal - the tool call's cancellation signal, when present.
 * @returns a discriminated outcome: `ok`, `not_found`, `http_error`,
 *   `invalid_json`, `timeout`, `aborted`, or `network`.
 */
async function fetchJson(url, outerSignal) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  if (outerSignal !== undefined) {
    if (outerSignal.aborted) forwardAbort();
    else outerSignal.addEventListener("abort", forwardAbort, { once: true });
  }
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (response.status === 404) return { kind: "not_found" };
    if (!response.ok) return { kind: "http_error", status: response.status };
    const body = await response.text();
    try {
      return { kind: "ok", data: JSON.parse(body) };
    } catch {
      return { kind: "invalid_json" };
    }
  } catch {
    if (timedOut) return { kind: "timeout" };
    if (outerSignal !== undefined && outerSignal.aborted) return { kind: "aborted" };
    return { kind: "network" };
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener("abort", forwardAbort);
  }
}

/**
 * Map a failed outcome to a short, model-readable error message.
 * @param outcome - a non-`ok` outcome from {@link fetchJson}.
 * @param id - the text id being classified, used in the message.
 * @returns the short error message.
 */
function describeFailure(outcome, id) {
  switch (outcome.kind) {
    case "not_found":
      return `text not found: ${id}`;
    case "http_error":
      return `library request failed with HTTP ${outcome.status}`;
    case "invalid_json":
      return "response from the library was not valid JSON";
    case "timeout":
      return "library request timed out";
    case "aborted":
      return "library request was cancelled";
    case "network":
      return "could not reach library.webuddhist.com";
    default:
      return "library request failed";
  }
}

/** Choose the right indefinite article for a capitalized language name. */
function article(word) {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

/**
 * Compose the one-sentence summary for a classified text.
 * @param type - classified type.
 * @param language - the record's language code.
 * @param parentId - the parent text id, or null.
 * @param parentTitle - the parent title, or null when unavailable.
 * @returns one plain sentence.
 */
function buildSummary(type, language, parentId, parentTitle) {
  const languageName = typeof language === "string" ? LANGUAGE_NAMES[language] ?? null : null;
  const named = languageName !== null ? `${article(languageName)} ${languageName}` : "a";
  const parentRef = parentId !== null ? `${parentId}${parentTitle !== null ? ` (${parentTitle})` : ""}` : "";
  switch (type) {
    case "translation":
      return `This is ${named} translation of ${parentRef}.`;
    case "commentary":
      return `This is ${named} commentary on ${parentRef}.`;
    default:
      return `This is ${named} root text.`;
  }
}

/**
 * Classify one WeBuddhist Library text and, when it has a parent, fetch the
 * parent's title. Never throws for request or response problems.
 * @param input - a bare text id or a full library text URL.
 * @param signal - optional cancellation signal from the tool call.
 * @returns the structured classification, or `{ error }`.
 */
async function classifyText(input, signal) {
  const extracted = extractTextId(input);
  if (extracted.error !== undefined) return { error: extracted.error };
  const id = extracted.id;

  const primary = await fetchJson(`${LIBRARY_ORIGIN}${TEXTS_PATH}${encodeURIComponent(id)}`, signal);
  if (primary.kind !== "ok") return { error: describeFailure(primary, id) };

  const record = primary.data;
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    return { error: "response from the library was not a text record" };
  }

  const translationOf = typeof record.translation_of === "string" && record.translation_of.length > 0 ? record.translation_of : null;
  const commentaryOf = typeof record.commentary_of === "string" && record.commentary_of.length > 0 ? record.commentary_of : null;

  let type;
  let parentId;
  if (translationOf !== null) {
    type = "translation";
    parentId = translationOf;
  } else if (commentaryOf !== null) {
    type = "commentary";
    parentId = commentaryOf;
  } else {
    type = "root_text";
    parentId = null;
  }

  const language = typeof record.language === "string" ? record.language : "";
  const title = pickTitle(record.title) ?? "";

  let parentTitle = null;
  if (parentId !== null) {
    const parent = await fetchJson(`${LIBRARY_ORIGIN}${TEXTS_PATH}${encodeURIComponent(parentId)}`, signal);
    if (parent.kind === "ok" && parent.data !== null && typeof parent.data === "object" && !Array.isArray(parent.data)) {
      parentTitle = pickTitle(parent.data.title);
    }
  }

  return {
    id: typeof record.id === "string" && record.id.length > 0 ? record.id : id,
    title,
    language,
    type,
    parent_id: parentId,
    parent_title: parentTitle,
    summary: buildSummary(type, language, parentId, parentTitle),
  };
}

/** JSON Schema shared by both the success and error result shapes. */
const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    language: { type: "string" },
    type: { type: "string", enum: ["root_text", "translation", "commentary"] },
    parent_id: { oneOf: [{ type: "string" }, { type: "null" }] },
    parent_title: { oneOf: [{ type: "string" }, { type: "null" }] },
    summary: { type: "string" },
    error: { type: "string" },
  },
};

/** Render the structured value as pretty JSON, the most faithful text form. */
function renderResult(_args, value) {
  return [{ type: "text", text: JSON.stringify(value, null, 2) }];
}

/**
 * Register `classify_text` on the tool registry.
 * @param ctx - context carrying the `tools` service.
 */
function apply(ctx) {
  ctx.tools.register({
    name: "classify_text",
    description:
      "Classify a WeBuddhist Library text as a root text, a translation, or a commentary. Call this whenever a user asks what kind of text a WeBuddhist text id or a https://library.webuddhist.com/v2/texts/<id> URL refers to, or whether it is a root text, a translation, or a commentary. Returns the id, title, language, type, parent id, parent title, and a one-sentence summary.",
    parameters: {
      text_id: {
        type: "string",
        required: true,
        description: "A WeBuddhist text id such as `1JV8GzsC9Q938KzIMd5ul`, or a full URL of the form https://library.webuddhist.com/v2/texts/<id>.",
      },
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: renderResult,
    },
    timeoutMs: 20000,
    isConcurrencySafe: () => true,
    execute: (args, exec) => classifyText(args.text_id, exec.signal),
    presentCall: (args) => ({
      card: "generic",
      title: "Classify WeBuddhist text",
      kind: "other",
      rawInput: args.text_id,
    }),
  });
}

export { apply, classifyText, inject };
