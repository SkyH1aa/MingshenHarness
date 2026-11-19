# ASD-STE100 Skill Source

- Skill: `asd-ste100`
- Version: `0.4.0`
- Copyright: Copyright (c) 2026 Dustin Yuchen Teng
- License: MIT
- Upstream project identifier: `danyuchn/asd-ste100-skill`
- Packaged snapshot: 2026-11-18
- Packaged files: 9
- Packaged bytes: 231,661
- Deterministic tree SHA-256: `0886b021b0f18d8997736af0a3b51a3492dd2c3b378ebb7484bead7803e04930`

The tree digest sorts portable relative file paths, hashes each file with SHA-256, and
hashes the concatenation of each UTF-8 path, a NUL byte, and the 32-byte file digest.
The packaged source is byte-identical to `asd-ste100-skill-master`.

The upstream MIT license is at `source/LICENSE`. The source README records that ASD
Issue 9 does not permit this project to redistribute the official approved-word
dictionary. The packaged skill therefore applies structural clarity rules and treats
plain-word selection as guidance. It does not represent official ASD certification.

The Mingshen adaptation adds only the WorkAgent wrapper, source record, and host safety
boundaries. It does not relicense upstream content.
