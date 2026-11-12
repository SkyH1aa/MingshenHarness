# Native Windows Execution Runtime

Source: https://github.com/openai/codex
Release: rust-v0.166.0 (Apache-2.0)
Purpose: invoke the upstream Windows MXC process sandbox only. This application
does not invoke Codex model services or share the user's Codex credentials.

Archive: codex-x86_64-pc-windows-msvc.exe.tar.gz
Archive SHA-256: dafeb48b5a853b2898453a6b5bdae0fa0646bd5d5b73c5dfe74c97d0af4a4a0d
Extracted executable SHA-256: 9d563ee4e0441ff9d59d612013e0460ddf8e5709735c2d9f6b98b7ef8ca4eb42

The executable is renamed codex-sandbox.exe without modifying its contents.
The application verifies its SHA-256 before execution. LICENSE and NOTICE
accompany this executable. The runtime's own dependencies retain their licenses.

MXC requires a compatible Windows build. Unsupported systems fail closed. The
trusted application broker, model HTTP requests, explicitly authorized remote
MCP services and user-operated terminal are separate from the process sandbox.

The executable exceeds GitHub's normal Git file size limit. It is intentionally
ignored by Git. Run `node scripts/provision-native-runtime.mjs` after cloning;
the script downloads the pinned release and verifies it before installing it.
