# PPT Master Source

- Skill: `ppt-master`
- Version: `6.9.0`
- Copyright: Copyright (c) 2025-2026 Hugo He
- License: MIT
- Official repository: https://github.com/hugohe3/ppt-master
- Packaged snapshot: 2026-11-18
- Packaged files: 13,089
- Packaged bytes: 39,892,466
- Deterministic tree SHA-256: `6e8023b4b8ab81e0fb4cffb71c1dcea8dd4f6f6abca490395c21fb273bfe473c`
- Excluded: `.env.example` (local provider configuration template)

The tree digest sorts portable relative file paths, hashes each file with SHA-256, and
hashes the concatenation of each UTF-8 path, a NUL byte, and the 32-byte file digest.
The packaged tree is byte-identical to `ppt-master/skills/ppt-master` when
`.env.example` is excluded.

The upstream MIT license is at `source/LICENSE`. Third-party asset terms remain in the
upstream notices:

- `source/templates/icons/THIRD_PARTY_NOTICES.md`
- `source/templates/sounds/THIRD_PARTY_NOTICES.md`
- `source/templates/sounds/CC0-1.0.txt`

The icon notice covers CC BY 4.0, MIT, CC0, and brand-trademark limits. The sound notice
covers the CC0 source libraries. The Mingshen adaptation only adds the host wrapper,
source record, path normalization, and safety boundaries. It does not relicense the
upstream source.

Bundled scripts and dependencies are not installed or executed by the host. The Python
dependency manifest names optional packages, including a separately licensed PDF
backend. Users must review dependency terms before installing anything.
