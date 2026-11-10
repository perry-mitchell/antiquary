# [2.0.0](https://github.com/perry-mitchell/antiquary/compare/v1.0.0...v2.0.0) (2026-11-10)


### Bug Fixes

* **templates:** Collection-level templates + mandatory catalog matching ([#1](https://github.com/perry-mitchell/antiquary/issues/1)) ([2eb91bb](https://github.com/perry-mitchell/antiquary/commit/2eb91bb3270713a2ced65de8341a8e0b7f440eb6))


### BREAKING CHANGES

* **templates:** items no longer carry their own template — a collection's
template applies to all of its items. items.template_id is dropped, and
field values plus catalog matches are kept consistent when a collection's
template changes. Items can no longer move between collections.

* feat: adopt collection-level templates in API, MCP and web

Items inherit their collection's template: catalog matches are mandatory
for superset-bound collections in the REST API and MCP alike, items no
longer move between collections, and the web item form drops its template
picker.

# 1.0.0 (2026-11-10)


### Bug Fixes

* provision postgres service for CI tests ([33e4472](https://github.com/perry-mitchell/antiquary/commit/33e44722efb0961398cba7299936a8b84bdf4971))


### Features

* add semantic-release pipeline with tests and GHCR image publishing ([df96b8c](https://github.com/perry-mitchell/antiquary/commit/df96b8c5720d83ebeada2ac2cf108d2bddd7dc9c))
