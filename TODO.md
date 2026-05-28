# TODO

## Current cleanup plan

- [x] Refactor argument editor state into explicit `EditorState`.
- [x] Store row depth separately from row label.
- [x] Replace `arrayPath` / `arrayIndex` with one `arrayContext` object.
- [x] Move hidden-message filters into `messages.ts`.
- [x] Rename schema/arg helpers for clearer intent.
- [ ] Show a notification when terminal image conversion returns `null`.
- [ ] Pre-seed the tool selector when `/tool <unknown>` is entered.

## Later decisions

- [ ] Decide how to handle unstructured object schemas in the editor.
- [ ] Decide required-field/default validation before execution.
- [ ] Consider central image block normalization.
- [ ] Consider splitting `tool-command.ts` only if it grows again.

## Existing follow-ups

- [ ] Add explicit validation before executing: required fields with invalid/empty defaults should block with an error.
- [ ] Refine array item UX/keybindings after trying it in real tool schemas.
- [ ] Stop rendering image tool result blocks as text placeholders when inline images are shown.
- [ ] Render non-image, non-text tool result blocks better than `[type]` placeholders.
- [ ] Normalize image result blocks before terminal conversion/rendering so alternate image shapes don't bypass PNG conversion.
- [ ] Consider using native tool renderers for call/result custom messages if Pi exposes a public renderer API.
