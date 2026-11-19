# Image-search source provenance

The supplied `image-search` 0.1.1 package contains five files and no `SKILL.md`. Its
plugin metadata describes an HTTP MCP server at `${ZCODE_BASE_URL}` authenticated with a
ZCode JWT provider. Mingshen does not share that account, endpoint, token format, or
transport.

This WorkAgent capability is therefore an original native rewrite. It uses
`web_search`, `web_fetch`, the Mingshen browser, approved workspace tools, and the same
permission/isolation model as other WorkAgent actions. No ZCode URL, JWT, MCP server,
proprietary image index, or downloaded image was copied.

The source plugin declares Apache-2.0. That license is not used to claim access to the
remote ZCode service or its image corpus.
