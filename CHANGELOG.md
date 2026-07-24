# Changelog

## [0.7.0](https://github.com/poco-ai/TokenArena/compare/v0.6.2...v0.7.0) (2026-07-24)


### Features

* **cli:** add qodercli credit and Grok Build usage parsers ([67d6969](https://github.com/poco-ai/TokenArena/commit/67d69691a0f76ef0835fb30394e25520afcc149d))
* **web:** add ModelScope OAuth login ([64e162f](https://github.com/poco-ai/TokenArena/commit/64e162f0beea109da03d9d6c44341cf4ce0d99ae))


### Bug Fixes

* **cli:** normalize paths in extractQoderProject for Windows CI ([b8a9492](https://github.com/poco-ai/TokenArena/commit/b8a9492798442ad7f54c9405fd753ac400099b5b))

## [0.6.2](https://github.com/poco-ai/TokenArena/compare/v0.6.1...v0.6.2) (2026-06-08)


### Bug Fixes

* **web:** downgrade Node base image from 26-alpine to 22-alpine ([5ff6587](https://github.com/poco-ai/TokenArena/commit/5ff658754e21a1583eaf9719855109a92b1bfe59))

## [0.6.1](https://github.com/poco-ai/TokenArena/compare/v0.6.0...v0.6.1) (2026-06-08)


### Bug Fixes

* **ci:** lowercase IMAGE_NAME for registry cache ref ([b2a302a](https://github.com/poco-ai/TokenArena/commit/b2a302a471cb51edff86aa38d4f6cf71088b187e))

## [0.6.0](https://github.com/poco-ai/TokenArena/compare/v0.5.0...v0.6.0) (2026-06-08)


### Features

* **web:** add delete account dialog to account identity card ([78c80e5](https://github.com/poco-ai/TokenArena/commit/78c80e5df170de685179835eb7992eca154fc7b2))
* **web:** enable deleteUser plugin and add delete account i18n strings ([fb738e8](https://github.com/poco-ai/TokenArena/commit/fb738e8e4d5a9e51151f1c5ce38a2500e2583b5d))
* **web:** improve connected accounts card with provider ordering and last-provider guard ([611cf1d](https://github.com/poco-ai/TokenArena/commit/611cf1d9ee79f0bbed0518d0159e64993b577746))


### Bug Fixes

* **ci:** switch Docker build cache from GHA to registry type ([7e83b8e](https://github.com/poco-ai/TokenArena/commit/7e83b8ed448f0e7666db502a83713a9bdfb41c75))

## [0.5.0](https://github.com/poco-ai/TokenArena/compare/v0.4.3...v0.5.0) (2026-05-25)


### Features

* **cli:** support .jsonl format and nested subagent sessions for Gemini CLI ([cf08120](https://github.com/poco-ai/TokenArena/commit/cf081201f9e5ca8cf53a6fd4194890356f27b7be))
* **cli:** support custom Claude config directory via CLAUDE_CONFIG_DIR env var ([eb2b9a6](https://github.com/poco-ai/TokenArena/commit/eb2b9a6000b0f1a2995f98d1065d37ba2bf89d8f))

## [0.4.3](https://github.com/poco-ai/TokenArena/compare/v0.4.2...v0.4.3) (2026-05-16)


### Bug Fixes

* update DATABASE_URL in docker-compose.yml for token_arena service ([61be4b7](https://github.com/poco-ai/TokenArena/commit/61be4b7af7e634aa2d723cca2db1f9e0e34f2712))

## [0.4.2](https://github.com/poco-ai/TokenArena/compare/v0.4.1...v0.4.2) (2026-05-16)


### Bug Fixes

* update GitHub Actions coverage workflow permissions ([2f866e4](https://github.com/poco-ai/TokenArena/commit/2f866e425029d1dbf30618b377fbef9696787d2c))

## [0.4.1](https://github.com/poco-ai/TokenArena/compare/v0.4.0...v0.4.1) (2026-05-16)


### Bug Fixes

* **cli:** reload config on each daemon sync cycle ([de404e8](https://github.com/poco-ai/TokenArena/commit/de404e834dd9493bb9a76944e6ce5dc169e2a21c))
* **cli:** reload config on each daemon sync cycle ([5e1aef6](https://github.com/poco-ai/TokenArena/commit/5e1aef66c271acbfdb880c8a30312c5d08c6cb20))
