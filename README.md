# dsh-classify-text

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) plugin that adds one tool, `classify_text`, which tells you whether a [WeBuddhist Library](https://library.webuddhist.com) text is a **root text**, a **translation**, or a **commentary**.

It reads the text record from `https://library.webuddhist.com/v2/texts/<id>` (no authentication needed) and applies this rule:

| `translation_of` | `commentary_of` | Type |
|---|---|---|
| set | — | `translation` |
| null | set | `commentary` |
| null | null | `root_text` |

When the text has a parent, the parent's title is fetched too so the answer is readable.

## Install

In a terminal, with DeepSeek Harness already installed:

```bash
dsh plugin --profile web add github:TenzDelek/dsh-classify-text
dsh web
```

Or in the dsh web UI: **Plugins → Add plugin → Install a third-party plugin** and paste
`https://github.com/TenzDelek/dsh-classify-text`.

The plugin then appears under *Installed plugins* with a toggle.

## Use

Just ask in any session:

> What type of text is `1JV8GzsC9Q938KzIMd5ul`?

> Is https://library.webuddhist.com/v2/texts/17Ui1qnL3NJCnEowPZ2ZQ a root text, translation or commentary?

The model calls `classify_text` and answers from its result.

### Tool output

```json
{
  "id": "1JV8GzsC9Q938KzIMd5ul",
  "title": "Aspiration Prayer from the Bodhicharyāvatāra",
  "language": "en",
  "type": "translation",
  "parent_id": "17Ui1qnL3NJCnEowPZ2ZQ",
  "parent_title": "སྤྱོད་འགྲོ་སྨོན་ལམ་བཞུགས་སོ།",
  "summary": "This is an English translation of 17Ui1qnL3NJCnEowPZ2ZQ (སྤྱོད་འགྲོ་སྨོན་ལམ་བཞུགས་སོ།)."
}
```

Errors come back as `{ "error": "..." }` (empty id, unknown id, timeout, network failure) rather than being thrown.

## Files

- `index.js` — registers the `classify_text` tool on `ctx.tools`
- `cordis.patch.yml` — the Cordis row that mounts this bundle into a profile
- `locale/en.json`, `icon.svg` — display metadata for the Plugins page

## Compatibility

Built and tested against DeepSeek Harness `0.1.0-rc.x`. dsh is a developer preview with breaking changes between releases; if the plugin stops loading after a dsh upgrade, open an issue.

## License

MIT
