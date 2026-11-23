# Mingshen Harness User Guide

Version 1.3.6 · Windows 10/11 x64 · 新哲文院算法社

## Workspace layouts

Choose **Settings → Appearance & language → Interface style** to select **Simple** or **Light Trails**. Simple is the default and retains the original interface; Light Trails has its own workbench composition. Both styles use the same conversations, tools, settings, permissions and project data, with existing memory settings and commands. Interface style is application-wide; each workspace saves its layout, panel widths and open states separately for each style.

Your style choice saves automatically. After it saves successfully, choose **Reload and apply** or quit normally and restart for it to take effect. Reload and apply waits for appearance preferences, composer draft writes and attachment reads to finish. Save failures cancel reload with a retryable error; saved unsent content returns after reload. Unsaved creative workstation drafts are not included in that reload protection; see **Creative workstation** below. Unsaved file, message and plan edits still block this action, so save those edits first. Active main/child tasks, send preparation, manual compaction and pending approvals/answers also block this action. Finish or explicitly stop the relevant work first; the button does not stop tasks for you. Shutdown cleanup and update installation handoff also block this reload action.

Both styles support day and night themes, which switch immediately without reloading. Light Trails uses a white conversation pane on a pale gray-green shell by day and low-saturation ink-teal surfaces with cyan-green edges by night. Motion respects the system reduced-motion setting or the application's Off option; animation pauses while the window is hidden. Running, approval, error and completion states continue to reflect actual events.

### Desktop experience

Version 1.3.5 adds two independent groups under **Settings → Desktop experience**: the startup presentation and the desktop companion. The presentation covers the primary screen in a topmost window without using exclusive fullscreen, animating the existing atom mark and orbits while reporting real startup stages. It is enabled by default and can be turned off or on here. When the presentation displays normally and the main window is ready, it lasts about five seconds. Click the skip control to continue, or press `Esc` when the startup window has keyboard focus. Errors or an approximately eight-second fallback end the presentation without blocking the main window; actual scheduling depends on system load. Reduced motion retains the status and control without orbit or entrance/exit motion.

For users who have already accepted the policies, the app may warm a bounded set of local conversation index pages while the presentation is active, without reading conversation bodies or API keys. Database opening and migration still occur before the presentation, and a speedup is not guaranteed. On first use, policy reading time starts only after the presentation ends and the main window is actually shown; the existing minimum five-second reading and confirmation requirements remain.

The desktop companion is disabled by default. When enabled, it opens as a transparent, draggable window with 36 built-in transparent actions derived from the supplied character videos. Settings control always-on-top, size (96–320 px), opacity (35%–100%), greeting, idle-chat and animation frequency, quiet mode, inactivity rest (0–240 minutes), task hints and the working-conversations panel. On Windows, pinning uses Electron's `screen-saver` window level. While pinned, a 200 ms watchdog checks for hidden or minimized state and reapplies the topmost level and Z order while the pet remains visible, including cases where another topmost window covers it without causing blur; Z-order reassertion pauses while the companion's native context menu is open. After a system hide it attempts an inactive restore after 120 ms. This is best-effort handling for `Win+D` and other system hides; it does not guarantee that every Windows Shell state is observable or recoverable. Menu hiding, closing the companion, disabling it or turning pinning off stops recovery, so the app will not reopen a window the user intentionally hid. It cannot cover the UAC secure desktop; exclusive-fullscreen and system-level windows may still appear above it. Position is stored in local preferences and clamped to the current monitor work area; **Reset position** returns it to the default corner. On a smaller screen work area, the window reduces the actual avatar and panel display sizes as needed, and panel contents can scroll; this does not rewrite the saved size preference.

The working-conversations panel opens by default when a task starts. Use the status bar or panel button to collapse or reopen it; it retracts when no tasks remain. It shows conversation titles, states and locally calculated elapsed time. Multiple runs in the same conversation are combined, with waiting for confirmation taking priority. Selecting a row opens that conversation subject to the existing navigation guards. Right-click the companion to inspect task states and open a conversation, launch Quick Chat, play interactions or preview actions, rest/wake, lock its position, adjust display options or open desktop settings. Previewing an action does not change a real task's status. A manually resting companion is not awakened by ordinary task events; background work continues. Quick Chat retains its own session and network controls and gains no extra permissions through the companion.

Companion navigation refuses a switch that would discard unsaved message edits, project-memory edits or file edits in another workspace. Save or cancel these edits before switching. Image Studio operations, unapplied prompts and creative drafts that could not be saved also receive leave protection. If several conversations are still loading, the latest valid selection takes priority.

Conversation titles are shown in the panel and context menu by default; titles themselves may contain sensitive information and may be visible to people nearby. Turn off **Conversation titles** in Desktop experience and wait for the save to succeed to use anonymous labels; the main process then does not send titles to the companion window. If saving fails, the settings page retains the pending change and shows the error; titles may still be visible until the save succeeds. Select **Retry save** and confirm that it has saved. Other than titles, the companion window does not receive conversation bodies, file contents, workspace paths, command arguments or approval details. Idle chat selects from built-in local phrases and does not call a model or use the network. Set idle chat to **Off** to prevent unsolicited messages, or inactivity rest to `0` to disable automatic rest.

**Idle animations** occasionally play short actions only while no tasks are active. Choose Off, Low (about 3–5 minutes), Normal (about 90–180 seconds) or High (about 45–90 seconds); playback also depends on the window, animation and system reduced-motion states. **Quiet mode** pauses automatic greetings, idle chat, idle animations and automatic rest without stopping tasks or disabling manual interaction. Temporary hiding leaves the feature enabled; closing the companion disables it persistently. Restore or re-enable it from settings. Quitting releases the window and timers while keeping local preferences. Paused or reduced-motion playback uses static feedback, and a video load or decode failure falls back to the character image. After a transient failure, request a new action or reopen the companion to retry; a persistent failure can still fall back to the image. Original character videos are not overwritten; background removal and character consistency still require human review. See the [animation notes](COMPANION_ANIMATIONS_1.3.5.md).

Windows installer resources keep the existing atom application icon and include branded header, sidebar and mark assets for the installer flow; the welcome page embeds eight atom-animation frames, `00–07`, and rotates them on a timer. Formal install, upgrade, uninstall and animation behavior remain subject to the actual package build and Windows runtime acceptance; source-resource checks are not installer acceptance.

Version 1.3.5 retains the 1.3.4 reliability fixes while tightening Simple-theme hierarchy and spacing, hiding empty task placeholders, and adding the independent startup presentation and optional desktop companion. Version 1.3.4 focuses on runtime reliability: DeepSeek thinking tool-chain continuation, native Memory summary budgets, bounded sandbox-stop settlement, conversation-catalog delta recovery, host restore path races, invalid tool-cache entries and stale persistent-command cleanup errors. Unconfirmed cleanup still retains the write barrier and resource leases, and recovery remains an explicit user action rather than bypassing existing permissions.

Version 1.3.3 refines Light Trails into an enterprise workbench. The sidebar, conversations, execution timeline, review, terminal and task panes share one surface hierarchy and heading rhythm. Decorative gradients and glows are removed; continuous workplanes, hairlines, flat selection and real running-state lines now establish hierarchy while retaining the atom mark. Composer focus produces one short light trail, running nodes and status-strip signals breathe only during a real run, streaming text keeps full opacity from its first frame while settling with a small offset, and disclosure transitions move only to explain state. Reduced motion removes travel and loops while preserving content, focus and status color.

Simple's titlebar offers Focused chat, Code workbench and Agent collaboration, with names available on hover. Focused chat opens the inspector on demand. Code workbench opens files/review/Git/commands/browser on the right. Collaboration places plans, task trees and child output on the right.

Light Trails starts with a 56px unframed titlebar. A separate 48px tool rail and Workspace conversation sidebar sit below it, followed by a breadcrumb for the folder and conversation and a central chat/composer. The rail opens chat, files, Agents, terminal, review and settings; the breadcrumb header also switches the three layouts. The upper-right pane shows review, files or terminal, retaining Git and browser controls. The lower-right pane simultaneously shows plans, the Agent tree or saved plans, with real child-task summaries on the Plan tab. Closing the right panels hides both panes. A bottom status strip shows the project, local-run indicator and actual task state. Regions share 12px insets and 8px gaps; the square-edged breadcrumb and status rows are 44px and 24px.

All three layouts share the running session; switching does not resend work and retains the current draft, reading position and unsaved editor content. Drag the splitters or focus one and use arrow keys; Home/End select the width limits. Simple's sidebar/inspector default to 260/460px; Light Trails defaults to 228/360px. Their adjustable ranges remain 220–320px and 360–720px. When space is limited, panels become drawers; click the backdrop to close. Settings → Appearance & language configures the default for new projects and system/off motion behavior.

In a narrow Light Trails window, layout labels yield first and the lower task pane defaults to 160px. When the chat pane itself is 600px or narrower, the model selector takes the first composer row and Agent/workspace controls share the second. Below 700px height, tool buttons and the input area tighten as well. If a file editor is open in a short window, the task pane also defaults to 160px; a saved custom height still applies within the available window bounds. Right-side content remains accessible through a drawer, which covers the background conversation while open; close it to resume typing. Drawer calculations include the complete rail, insets and splitters to preserve the space needed by the conversation.

Model and Agent controls live above the composer input. The selected model shows “Model (Provider)”; long names shorten independently, with the complete provider, display name and model ID available on hover. Enabled custom and built-in Agents include brief role labels. Workspace names have full-path tooltips. Light Trails places permission mode and the isolation/patch-only disclosure in the composer footer; Simple retains its original position. Approval surfaces show Allow once and Deny directly; More authorization options exposes session, similar-operation, automatic and project-wide choices. Review the scope before expanding access.

Settings use six groups: General, Models & Agents, Connections, Project & security, Automation & records, and Data & application. Search filters category names/identifiers; choose a result to navigate. Provider details have Connection, API Keys and Models tabs. Background refresh preserves edit focus and IME.

MCP supports connection search and a detail region for configuration, tools and test results. Schedules filter enabled/paused tasks and reveal prompts by selecting a name. History filters records and mounts trajectory details on demand, 100 steps per batch. Step summaries are a separate disclosure and follow the same batch limit; long review command lists also use batches of 100. Embedded guides and changelogs include chapter navigation.

Simple's task summaries default to collapsed and empty task bands are hidden. Light Trails places its task pane at the lower right so plans and child status can remain visible alongside review above. Drag the horizontal splitter to resize it, or focus the splitter and use Up/Down in 16px steps and Home/End for the current bounds. Escape cancels an active drag; Enter or double-click restores the responsive default height. Use the task header's collapse button to reduce the pane to one row and expand it again; opening the child Agent task tree also reveals the pane. Height and collapse state are saved per workspace separately from Simple's layout preferences. Both styles support plan editing and the project plan library.

Review can switch between Git, branch, session and previous-turn diff scopes. Select a file to inspect its line numbers and changes, including deleted files. The historical command-record panel can dock at the inspector bottom; it is separate from the interactive terminal. The browser remains an embedded page.

### Expand complete details

Simple's runtime activities initially show a compact summary; expand the activity bar, then a record's arrow for details. Light Trails organizes actual tool calls and states into an Execution records timeline. Groups start expanded, and each record independently expands/collapses to reveal commands, arguments and stored output. Message headers show the user or primary/child Agent identity and actual message time. Retry diagnostics, final errors, compaction failures and long integration diagnostics also have disclosures. Historical tool records separate commands, arguments and output; Review and Commands expose expandable records. Focus a disclosure title with Tab and press Enter or Space to toggle it.

Version 1.3.1 fixes chat displacement when long diagnostics are expanded or
collapsed and reduces long tool-history rendering costs during typing and
streaming. Details appear on demand, retaining complete stored content and copy
controls.

Long lines wrap and long details scroll independently. Select text or use the copy icon to copy complete content, regardless of which lines are visible. Opening chat details pauses automatic following so later output preserves your reading position; the down-arrow returns to the latest content and resumes following. Historical commands remain expandable during new runs. When several composer errors are open in a small window, scroll the composer region to reach each diagnostic and the input. Child previews retain recent content only; when a truncation notice appears, use its open-conversation icon to read the full child conversation. Existing tool-output, HTTP-response and preview capacity limits still apply; expansion cannot restore content already omitted at its source.

## Creative work and project collaboration

### Creative workstation

Open the workstation and combine category, output-format and multi-keyword filters to find **780 original work scenarios** across 65 task structures and 12 categories. Each offers brief and detailed versions, for 1,560 selectable versions without double-counting scenarios. Edit the subject, audience, constraints and sections, reorder sections, undo or redo, and import or export a JSON draft. Local drafts are saved per workspace.

Brief mode retains the outline, workflow and acceptance framework. Default Chinese detailed prompts contain at least 800 Han characters, combining scenario-specific inputs, methods, deliverables and risks with shared professional workflows and execution rules, plus real built-in Skill IDs and reasons; English versions provide corresponding guidance. The count does not mean each scenario has 800 independently written characters, guarantee length after editing or establish deliverable quality; actual acceptance is still needed. New drafts default to detailed, while old drafts without a mode restore as brief. Switching modes preserves titles, requirements, notes and sections and participates in undo/redo and JSON persistence. Full preview, copying and WorkAgent handoff use the same current draft and output format. Recommended Skills still require the current enabled state and permissions to load.

Office scenarios cover Word, Excel and PowerPoint, plus offline content, specifications or handoff workflows for Outlook, OneNote, Teams, SharePoint, Forms, Visio, Project, Access and Power BI. Actual deliverables use supported DOCX, XLSX, PPTX, PDF or HTML formats. Templates do not promise native `.mpp`, `.vsdx`, `.accdb` or `.pbix` files, email delivery or cloud publication. See the [workstation template guide](WORKSTATION_TEMPLATES.md) for scope and examples.

Choosing a template or importing JSON requires confirmation before replacing the current draft; the replacement can be undone. If an autosave write fails, the unsaved version is held in the current running renderer. Return to that workspace after switching surfaces to recover it, then retry saving or export it. This temporary copy does not survive a reload, exit or crash. Retry or export the JSON before reloading or quitting; after switching surfaces, the unsaved copy does not block either action. If the stored draft is invalid or unreadable, autosave pauses without overwriting the original. When there is no pending failed-write copy to recover, new edits remain only in the current workstation view, so export them before leaving.

**Hand to WorkAgent** appends the prepared request to the composer while retaining existing text and attachments. Review and edit it, then send it yourself; selecting a template does not create an artifact or start a task. If workspace selection is cancelled, saving fails or a draft conflict occurs, resolve the visible error before retrying.

### Image Studio

If returned dimensions differ from the request, images that pass format, decoding and safety-budget checks are still saved to the library at their actual size and may be added to the canvas. A dismissible per-image warning shows requested and actual dimensions; the application does not resize the image to pretend the provider honored the request.

Open Image Studio from the main interface. Supply and select an image model using an **OpenAI Images-compatible endpoint that returns Base64 images**. The image and language models are selected separately, and image-only models are excluded from ordinary text chats. The settings panel supports Auto/Low/Medium/High/XHigh/Max quality, Auto/1K/2K/4K/custom resolution, width and height, 16-pixel alignment, aspect ratios, transparent backgrounds and 1–10 output images. Auto resolution uses the model's default size; transparent-background requests currently select PNG output. Support varies by model and compatible gateway. Unsupported parameters surface the provider error rather than silently changing the requested settings. Prompt polishing uses the selected language model and presents a suggestion for review and approval before adoption. Image-to-prompt requires a language model that accepts images. Provider calls can incur charges; the application does not follow remote image URLs returned by a provider.

Import local assets, pan and zoom the canvas, edit layers, export PNG, or import and export a portable project bundle containing its assets. Assets are kept in a fixed subdirectory of local application data and do not depend on the original file path after import. Each library item has a Download button that opens the native save dialog to export the original image to a chosen local path; cancelling the dialog does not export. Selecting image frames in order can assemble a GIF; this is frame assembly, not text-to-AI-video generation.

The canvas toolbar opens or closes the asset library and settings panel. Narrow windows start with both sides closed so the canvas, zoom, Fit canvas and PNG export controls remain available. Use Fit canvas after opening a panel to frame the whole canvas again; toggling panels does not change layer positions.

Version 1.3.6 adds a local canvas library to Image Studio. New and imported canvases are stored as independent projects under local application data. The open tab provides Rename and Close actions, while **My Canvases**, next to the asset library, can search and reopen closed projects and copy, delete or reveal their files. Closing a tab does not delete its project; only an explicit delete from My Canvases removes the local canvas file. The import entry distinguishes assets from canvas projects: assets enter the shared image library, while a canvas project retains its own layers, dimensions and asset references. A damaged or incompatible project, or one that would escape the local canvas directory, must be rejected without overwriting the original file. Do not manually move shared assets that existing canvas projects reference.

### AutoDrive and coordination

In a primary CodeAgent/WorkAgent conversation, the task pane offers AutoDrive. When explicitly requested, the current model can use the conversation, saved plan and bounded project evidence permitted by the active profile to propose **three to five directions**. Planning is read-only and exposes no command or file-editing tools to the model. If the selected worktree has not yet been established, AutoDrive asks you to run a task in that conversation first; it does not create the worktree or fall back to the main directory. Choosing a proposal only appends it to the draft; review and send it yourself.

The 18 built-in Agent roles include a coordinator, implementation and test specialists, document work and an independent quality verifier. Choose the coordinator and describe the goal; the model can split it into two to six work packages, select available roles and dispatch real child tasks. The parent can continue independent work after dispatch and collect results later. Existing concurrency limits, approvals and file-write coordination still apply. The task pane reports execution, verification and QA separately: missing evidence, blocked verification commands or failures cannot be turned into a pass by QA text alone. A Test Engineer's file authoring remains subject to its approval policy, while the quality verifier does not edit files.

### Search, terminal and review

Press `Ctrl+Shift+P` to search commands available in the current mode, conversations and workspace files. Project navigation shows workspaces and unread status. Branch and worktree attribution comes from the conversation's actual established records; when an older conversation has no record, its attribution remains unknown rather than being inferred from the current checkout. A conversation fork is not a Git branch.

The right-side terminal is a user-operated, interactive multi-tab Shell with input, resizing and stop controls; it is not a new model tool. It is available only in the main window for trusted Code/Work projects with Full Access, patch-only mode off, and host execution or an actually established worktree. Chat, Quick Chat and actual SubAgents cannot use it. The Shell runs with your Windows account permissions, so inspect commands yourself. If process cleanup cannot be confirmed on close or exit, the interface retains an error and a retryable state. The historical command-record panel and the model's pipe-based `exec_command` / `write_stdin` remain separate.

Local review switches among Git, branch, session and previous-turn scopes; branch comparison allows a base selection. Select an old or new line, or a contiguous range, and write numbered comments to append to the current draft without sending automatically. Files and diffs are rechecked before handoff. Changed content retains the pending comments and requires a refresh and recreation of affected comments; handed-off comments are cleared only after the draft saves successfully.

When the review pane is short, scroll the whole pane to reach the comment editor and Put in composer action. Long code and pending-comment lists also scroll independently.

### Draft assistance

Under **Settings → Context and compaction**, choose an independent text model for draft polishing, or leave it unset to use the current conversation model. Explicitly request polishing in the composer, compare the original and suggestion, and choose whether to apply it. A changed draft requires conflict handling first. The polish request sends the draft to the selected model provider.

The composer also offers a one-turn temporary instruction and a workspace tone shared by CodeAgent and WorkAgent. A temporary instruction does not rewrite the draft or message history, is retained with its corresponding queued item, and does not carry over to later unrelated turns. Neither it nor the workspace tone expands tool access or permissions.

## Agent modes

Use the CodeAgent, WorkAgent and ChatAgent controls in the main titlebar to choose how the next turn works. A mode is not a separate provider: all three share configured providers, models, reasoning levels, context compaction and other base runtime settings.

| Mode | Page and workspace | Capability boundary |
| --- | --- | --- |
| CodeAgent | Uses the existing Code/Work conversation catalog and workspace | Code, files, commands, code index, diagnostics, tests, review and engineering verification |
| WorkAgent | Shares that catalog and workspace with CodeAgent | The same controlled engine plus office skills and `office_document`, focused on documents, workbooks, presentations, research and polished deliverables |
| ChatAgent | Separate conversation page with no workspace, organized by groups, pins and archives | Only web search/fetch and read-only parsing of files the user deliberately uploads; no local-file modification |

CodeAgent and WorkAgent can change type within the same conversation. The switch does not create a folder, copy history or reset context; messages, plans, drafts, attachments, built-in/installed capability references and project memory remain. Mode controls are disabled while that task is running, preparing a send, waiting for approval or an answer, or compacting, and the main process also rejects a forged mode update. Finish the task or press Stop before switching. The new mode applies to the next model request; it does not rewrite history or resend the previous message. If no enabled Agent profile supports the target mode, the switch is rejected with an error.

ChatAgent cannot be converted directly into CodeAgent or WorkAgent. Its existing chats stay in their own grouped catalog with independent titles, messages, drafts and attachments. In Light Trails, its dedicated page uses a 264px grouped conversation sidebar, solid chrome and a 1px selection line, with 13px titles, 12px supporting text and a fixed 24px empty title; below 900px the sidebar becomes a drawer instead of compressing the chat. It has no workspace picker, task tree, review, terminal, Skills/MCP references, local slash commands or `@` subagents. A Windows path or `file://` string in a message is text, not permission to read the local file.

Each named Chat group and the Ungrouped heading has a plus button. It immediately creates and selects a blank conversation in that group without opening the full New conversation dialog. The new chat inherits the provider, model, reasoning level and chat settings from the most recently updated unarchived Chat in that group. Inheritance follows update time rather than pinned display order. An empty group falls back to the most recently updated unarchived Chat; when no Chat exists, the app uses the default available configured model. History, drafts, attachments and runtime state are not copied, and the CodeAgent/WorkAgent workspace is never inherited. The model remains adjustable in the composer. The sidebar header and Chat empty-state New actions also create an Ungrouped chat directly. If the source model was deleted or is invalid, the app asks you to repair it instead of silently substituting another model.

Use **Manage conversations in bulk** at the top of the ChatAgent sidebar to select conversations individually or select all matches across groups for the current search. Expand **Archived** to include archived conversations; changing the search or archive expansion clears the selection. Archive requires unarchived selections, Restore requires archived selections, and permanent deletion can include both. Archive and Delete request confirmation; Restore does not. Stop running conversations before archiving. Archiving retains drafts and pauses associated scheduled tasks; restoring conversations does not automatically re-enable those schedules. Permanent deletion first stops related tasks, then removes messages, drafts and attachments from the selected conversations and their children; it cannot be undone. Results are reported per conversation: successful items stay completed, and failed items remain selected with their reasons for retry.

During bulk processing, conflicting input, creation and navigation are suspended. Before archiving, the app waits for drafts in open windows to persist; a failed save or cross-window revision conflict prevents that conversation from being archived. Quick Chat temporarily locks input while creating, hiding or archiving its current conversation and waits for send preparation, message rewrites and draft saves to finish. Submit or cancel any unsubmitted message edit first.

### Quick Chat and global shortcuts

By default, `Ctrl+M` toggles Quick Chat. While Mingshen is running, press it from this application or another Windows application to open a compact ChatAgent window; pressing the same shortcut while the compact window is visible hides it. The first activation creates a separate Chat conversation. Hiding and activating it again within the **ten-minute** lease reopens that quick conversation and renews the lease for another ten minutes. After it expires, the next activation creates a new Chat conversation; the previous conversation remains in the Chat catalog and is not deleted. Sending a message or waiting for a reply does not extend the lease; only another Quick Chat activation does.

The compact titlebar can create a conversation, open the main window at the current Quick Chat conversation, toggle **Always on top**, or hide the window. The pin choice persists across normal restarts and uses the native window's always-on-top state; Windows security surfaces and system-level dialogs can still appear above it. `Esc` also hides the window when focus is not inside an open menu or dialog and IME composition is inactive. Hiding does not discard the current draft; the next activation within the lease resumes it. The titlebar's New conversation control starts another Chat conversation after pending input work and draft saving finish; a save failure keeps the original conversation. An unexpired lease can resume after a normal application restart; once expired, the next activation starts a new conversation. If no enabled text model is available, the window opens provider settings through the main interface instead of pretending that a chat is ready.

Quick Chat retains the ChatAgent boundary. It can use `web_search`, `web_fetch`, read-only parsing of files you deliberately upload, and the shared provider/model/compaction settings. It cannot read local paths, modify files, run commands, use MCP, Skills, hooks or subagents, and cannot turn into CodeAgent or WorkAgent. The quick window's IPC and runtime events are limited to its current Chat conversation.

By default, `Ctrl+Alt+L` toggles the main interface/tray: a visible, focused window is hidden; otherwise the main window is restored, shown and focused. You can record and customize both global shortcuts in Settings. The recorder accepts three- or four-key chords, while the existing two-key defaults remain valid. Each combination must include at least one Ctrl, Shift or Alt modifier and one primary key, and the two shortcuts cannot conflict. Saving registers the bindings immediately. If a combination is occupied or registration fails, Mingshen keeps the previous valid bindings, shows an error and allows the defaults to be restored. Both shortcuts are system-wide registrations and work only while Mingshen remains running. Shortcuts only control windows and never send messages, approve operations or change permissions.

If the agreements or built-in guide step are not yet complete, `Ctrl+M` opens the main window so onboarding can finish; it does not bypass consent by creating a quick conversation.

### CodeAgent specialization

CodeAgent keeps the full engineering workbench and strengthens the working loop:

- Built-in engineering, frontend, backend/data, debugging and verification skills are discovered through metadata. Each entry can load a deeper reference only when the task needs it. `use_skill` loads bounded instruction pages on demand instead of copying the entire Skill catalog into every request.
- The composer **+** reference panel offers built-in Skills/Plugins plus installed and enabled extensions. Manually selected built-in capabilities and extensions take priority, while other matching capabilities remain available to automatic discovery. When a task involves a relevant domain such as databases, design, documents or review, CodeAgent searches that capability index and loads matching Skill instructions by exact ID. Disabled items never appear. Discovery, loading and MCP tool declarations do not execute scripts or grant permissions. Selecting built-in GitHub or browser plugin metadata records only a tool preference; it does not connect an account, sign in or start an external service.
- Code index, LSP/diagnostics, file reads and diffs establish the real caller and constraints before a narrow change. Cross-module work also checks types, IPC, persistence, UI and failure paths.
- The same failing tool with unchanged arguments is recognized instead of blindly replayed. The Agent must inspect arguments, state, permissions or environment, then change its hypothesis, input or strategy. Denied approval, missing dependencies, timeouts and product assertion failures remain distinct classes.
- Each tool result retains at most 4,000,000 UTF-16 characters, rendered with head and tail excerpts and an explicit marker for the omitted middle. Each conversation retains at most 40 results and 16,000,000 cumulative UTF-16 characters. `read_tool_output` can page through that bounded retention area by `call_id` and character offset, but cannot recover omitted, evicted or never-captured content.
- Only managed file-tool writes in a primary conversation with Full Access and host execution create per-file local checkpoints before writing. Each file is limited to 25 MiB; a checkpoint and the per-turn total are subject to the `128 MiB / 128 checkpoints` budget. Commands and external MCP side effects are not covered by the per-file snapshot guarantee; the project snapshots and traces kept after a run also do not imply those side effects can be fully rolled back. Interrupted work must inspect actual state instead of assuming an uncertain side effect completed.
- Delivery uses tests, type checking, lint, build or real UI checks according to risk. Configured project verification supports up to three failure/fix/rerun attempts; a shell exit or a model's claim is not the final acceptance.

### WorkAgent specialization

WorkAgent shares CodeAgent's permissions, isolation, approvals, writer locks, cancellation and atomic-write rules. Its office focus comes from task methods, bundled skills and controlled Office tools, not broader access:

An empty WorkAgent conversation in Light Trails offers Word, Excel and PowerPoint starters. Selecting one appends the suggested text to the current draft; you can edit and send it yourself. It does not start a task or create a file automatically.

- It establishes audience, decision, tone, facts, sources, deliverables, structure and visual constraints before drafting. Titles state a claim, and tables, charts or callouts appear only when they help comparison, decision or risk. Empty slogans, repeated conclusions and unsupported adjectives are removed. Long documents use an outline, decks use a storyboard, and workbooks use an input/calculation/output model. Claims require sources, and an unread page or file is never presented as inspected.
- Word, PDF and PPTX artifacts can use the controlled `executive`, `consulting`, `editorial` and `minimal` design presets with `airy`, `balanced` or `compact` density and one accent color. DOCX/PDF can add a cover. Layouts share a heading hierarchy, safe areas, typography and spacing rather than changing colors arbitrarily or stacking cards on every page.
- PPTX can organize a story with cover, section, content, statement, cards, timeline, data and closing `slide.kind` layouts. `metric_grid` is for two to six genuinely comparable measures, and `callout` is for a decision, risk or next action rather than filling every slide.
- `office_document` creates or edits native XLSX with typed cells, ranges, formulas, formatting, tables, filters, frozen panes, widths, merges and structural inspection. A sheet presentation can define title/header/body ranges, grid lines, print area, repeated heading rows, orientation and fit-to-page; an existing workbook can apply those surfaces with `format_sheet`. Writing a formula, a stored cached value and an actual Excel recalculation are reported separately.
- Controlled PPTX draft edits cover supported shape/placeholder text, table cells and notes. The Agent reads structure and SHA-256 first and submits operations against that source snapshot. Untouched package parts retain source bytes; macros, signatures, OLE, SmartArt, animation and complex-master compatibility are not promised lossless.
- DOCX draft structure reads, placeholder-free text/body-section edits, paragraph layout, templates, native equations, charts, headers/footers and footnotes remain available. Outputs default to a new file and fail on a changed source hash, ambiguity, protected structure or capacity overrun.
- Bundled research, data-analysis, Word, Excel, PowerPoint, operations and artifact-quality skills load deeper editorial-quality, report-surface, story/layout and format-acceptance references for complex work. They emphasize editable native objects, hierarchy, grids, typography, spacing, readable charts/tables, story, sources and accessibility rather than a screenshot that merely looks finished.
- The built-in domain catalog contains 21 foundation entries: five Code, twelve Work, three Creator and one shared artifact-quality entry. Nineteen are original workflows; Work-only `builtin:work-ppt-master` and `builtin:work-asd-ste100` adapt PPT Master 6.9.0 and ASD-STE100 0.4.0. CodeAgent exposes nine foundation entries and WorkAgent sixteen, plus **98 active source Skills** from `WorkAgentSkill/`. Semantic-version selection shows only the latest version of the same source and path, hiding 26 historical entries in nine groups from both discovery and manual selection. Independent sources and distinct workflow variants remain separate; names or body hashes alone never merge them. Old selections display their current equivalent, deselection removes historical aliases, and existing deny/ask rules remain effective. All 124 physical sources, 104 unique body SHA values, 93 names and historical files remain for provenance, including 82 unchanged design bodies and 22 original adaptations. PDF retains production, viewer, reading and loose sources; its ten physical entries and historical Viewer 0.2.1 body are preserved. Bodies load on demand rather than entering the default prompt wholesale. PPT Master scripts, Python dependencies and paid services never install or run automatically, and binary references such as WAV cannot load through `use_skill`. ASD-STE100 includes no official dictionary or certification, and private authentication, viewers, canvas, scripts and host APIs do not become runnable through a Skill.
- Like CodeAgent, WorkAgent supports automatic discovery, manual built-in selection and other installed/enabled extensions. Manual selections take priority while other matches remain discoverable and loadable on demand. Work-only entries such as `builtin:work-ppt-master` and `builtin:work-asd-ste100` are hidden after switching to Code and restored when Work returns; forks and child conversations copy the selection. ChatAgent has no such access, and disabled extensions are neither discovered nor called.
- Built-in selections are conversation-scoped and limited to 32 entries; they are not installed extensions. Changes are disabled while running, preparing a send, waiting for approval or an answer, or while any child is busy. When the active Agent Profile permits `use_skill` and no interactive approval is required, including the default read policy, selected Skill bodies may be preloaded into the first-turn system prompt with a 64,000-character total budget. `ask`, `deny`, unavailable or over-budget entries retain exact IDs and follow the real `use_skill` approval path. Plugin IDs are never passed to `use_skill`, and selection grants no connection, login, service-start or tool permission.

`office_document verify` first checks package structure and content. If Microsoft Office is installed and policy permits it, WorkAgent may request Excel COM recalculation or Word/Excel/PowerPoint PDF export for a rendering check. This is possible only in a WorkAgent conversation with Full Access, host execution and no parent session; Office must already be installed and idle and must not be blocked by isolation or organizational policy. The application never installs Office automatically or takes over a document the user is editing.

When Office verification is unavailable, fails or is denied, structural evidence remains and the result explicitly marks formula recalculation, PDF rendering or page-by-page visual review as unverified. Successful package creation, formula writing, actual Excel calculation and Word/PowerPoint page layout are different evidence. COM also does not certify every Office version, font, DPI, printer driver or third-party extension.

### ChatAgent boundary

ChatAgent provides conversation, read-only parsing of user-selected uploads, and `web_search`/`web_fetch` when enabled for that conversation. It does not use custom Agent profiles and has no local path read, create/modify/delete, command, terminal, browser click/login, GitHub operation, MCP, Skill, hook, custom tool or subagent capability. Forged or model-generated calls to forbidden tools are rejected by the main process before execution; a null workspace alone is not treated as the security boundary.

The ChatAgent composer has a per-conversation **Allow internet / Block internet** control. It defaults to allowed to preserve existing behavior. When allowed, `web_search` and `web_fetch` run without per-request approval; webpage fetches still enforce HTTP(S) and public-target security checks. When blocked, both tools are removed from the model's tool list and the main process rejects forged direct calls. The control is locked while preparing or running a send and while waiting for approval. A grouped conversation, fork or renewed Quick Chat created from an existing Chat conversation inherits its blocked state; a Chat with no source conversation defaults to allowed.

Each `web_search` or `web_fetch` call has a 90-second request budget. Search-provider fallback shares the same budget rather than resetting it per source. User cancellation, the 90-second timeout and web-service errors are reported separately. Network failures, remote denials or incompatible responses can still prevent a search; retry or use another reliable source without bypassing public-target or protocol checks.

This control only governs agent-initiated web search and webpage fetch. It does not block the configured model provider connection, application update checks or network use needed to send user-uploaded attachments to the selected model. Use a local model or avoid submitting sensitive material when cloud transmission is not acceptable.

Attachments use only the bytes the user deliberately supplies. Images follow model vision capability; PDF, Word, Excel and PowerPoint use the application's local read-only parsing and, when supported, the selected provider's native modality. Attachments may contain sensitive data, so confirm the selected provider's policy before sending. ChatAgent may provide text, code or formulas in its reply but cannot claim that it saved a local artifact or completed an external action.

## Token Saver

Open **Settings → Skills and plugins → Token Saver**, or search for “Token Saver”. It is built in; no extension download is needed. Saved request reductions and response guidance apply to the next model request; system prompt modules reload on the next user turn. The master switch stops new optimizations. Original messages, permissions, approvals, isolation, tool order and failure handling remain intact.

New configurations retain the latest **5 user turns**, **disable early turn-count summaries** and use **Auto** response guidance. Explicit existing choices survive upgrades. If you enable early summaries, after **12 turns** and **2048 estimated tokens** in the older prefix, the existing primary/fallback compaction models generate a continuation summary. Adjust all three limits; the threshold must exceed retained turns. The threshold counts visible text and bounded media estimates, rather than treating base64 or opaque state bytes as ordinary text. Summaries prioritize goals, decisions, preferences, constraints, errors and unresolved work and retain source message identifiers, but remain lossy; verify important facts.

The existing **85% window safeguard** remains independent and can include newer complete history when necessary. Cancellation, invalid/nonshrinking summaries and fallback retain their existing safeguards. Disabling does not undo saved summaries; originals remain available. Summarization incurs additional model usage and short chats may not save tokens overall.

### Provider prompt caching

Native Google Gemini fixes the family to Gemini and uses implicit caching at a `/v1beta` or gateway-supported `/v1` Base URL. Returned native Parts, thinking summaries, optional call IDs and signatures are retained with local messages. Replay requires matching authentication scope as well as provider, model, protocol, endpoint, visible text and tool identities. The compatible-endpoint detection rules below continue to apply to other protocols.

A provider can reuse an identical prefix from an earlier request, reducing repeated input processing. This differs from local tool-result deduplication. Mingshen keeps system rules and tool ordering stable, appending changing plans, memory, permissions, diagnostics and selective coding guidance as chronological host-state updates instead of inserting random run identifiers into system instructions. The latest state takes precedence; execution still verifies approvals, isolation and plan revisions independently, and historical state cannot grant permissions.

Token Saver preserves the representation of history already sent to the model. Moving the recent-five-turn window, asking a new question or adding another duplicate does not rewrite that emitted prefix; new history follows the current strategy. Changing plugin settings, editing history, switching models/tools or creating a new summary may deliberately establish a new prefix, so the first request afterward can have fewer cache hits. Original messages and recall remain available. The latest input reduction estimate is separate from provider cache hit rate.

Source-message hashes, reduced replacement excerpts and chronological host-state snapshots are stored in the local database. Snapshots include the plans, memory excerpts and diagnostics used at the time and may accompany later requests as history. The latest state takes precedence without erasing historical text. Rewinding and rewriting or deleting a conversation clears its corresponding snapshots and representations; original messages and summaries retain their own lifecycle. Disabling automatic memory stops new automatic injections, rather than erasing previously sent chat content.

Choose a model family and cache mode when creating a provider, or open **Settings → Providers and models → select a provider → Connection → Prompt caching** for an existing one. Select documented capabilities, then save. Changes apply to the next run:

- **Provider model family** offers OpenAI, Claude, Gemini, DeepSeek and Other or mixed models. Automatic detection matches the complete official endpoint and protocol rather than provider names or model IDs. Alongside the existing OpenAI / Claude `/v1` endpoints, it recognizes Gemini Chat Completions at `https://generativelanguage.googleapis.com/v1beta/openai`; DeepSeek Chat Completions at `https://api.deepseek.com`, `/v1` or `/beta`; DeepSeek Responses at the root or `/v1`; and DeepSeek Anthropic Messages at `https://api.deepseek.com/anthropic/v1`. A trailing slash is accepted. Unknown gateways need an explicit family selection and confirmed native-field forwarding. Family selection does not change models, translate protocols or certify compatibility; use separate providers for mixed families.
- **No client cache hints** omits hints without disabling the provider's implicit caching.
- **OpenAI compatible cache key** requires documented `prompt_cache_key` support and uses an opaque stable key per conversation, not conversation text.
- **Claude automatic caching / explicit breakpoints** requires gateway and model support. Static tools, system, the valid leading summary and moving history share at most four markers. Explicit mode omits the top-level automatic marker. The default is five minutes; one hour is opt-in, requires support and can cost more for writes.

**Use Automatic caching for Gemini / DeepSeek.** Both rely on server-managed implicit prefix reuse. The application keeps system instructions, tools and emitted history stable without automatically adding OpenAI cache keys or Claude breakpoints or creating billable Gemini explicit-cache resources. The Claude lifetime setting does not control their server retention. Confirm a gateway's behavior in its documentation.

Version 1.3.2 also retains native continuation fields actually returned by the API: Gemini Chat Completions message/tool signatures, and DeepSeek Chat `reasoning_content`, Responses plain-text reasoning items and Anthropic thinking blocks. Only validated, bounded, completed state is retained, preserving tool order. The application never reconstructs it from displayed reasoning. Replay requires the same provider configuration, model, protocol and endpoint, with matching visible content and tool identities, arguments and order. Token Saver preserves these messages, and independent text summaries do not forward `provider_state` or opaque signatures. Returned DeepSeek reasoning and opaque Gemini signatures are local conversation data, separate from credential encryption; see the [Privacy Policy](PRIVACY_POLICY.en.md).

For DeepSeek Chat, choosing a reasoning level explicitly sets thinking: `none` disables it, while configured enabled levels set thinking and effort. Responses uses `reasoning.effort`; Anthropic uses thinking / effort. An unset level leaves the server default intact. Current official Chat documentation gives `thinking` priority over `reasoning_effort`; omitted/null thinking follows effort, and omitting both enables thinking. Check the current model/gateway documentation and keep the reasoning level appropriate for the task.

Upgrades cannot invent missing native history. Existing conversations may not immediately improve; observe consecutive requests with real tool continuations in a new conversation using consistent configuration. Compare cache reads, report coverage and prefix diagnostics in CTX → Token Saver. Missing reports remain unknown; explicit zero means zero hits. Minimum lengths, expiry and routing vary by model and are not hardcoded or guaranteed by the app. See the repository's [provider caching notes](PROVIDER_CACHING.md) for research and protocol scope.

Unsupported parameters can fail requests. Consult your provider documentation and return to Automatic or No client cache hints if needed; the app does not silently guess or downgrade cache capabilities. Minimum length, expiry, routing and model/configuration changes affect hits. The same key does not guarantee identical rates across clients; no 90% rate or fixed billing reduction is promised.

Same-provider/model compaction can reuse the most recent actual text-only request in this process, preserving system, tools and reasoning, then append a summary instruction and recallable source-message index with tool selection disabled. History/configuration matching, complete tool boundaries, redaction and window checks must pass. Restart, missing/oversized snapshots, any attachment or image-bearing tool result, independent/fallback models and incompatible input use the existing segmented path. An explicit HTTP400/422 rejection of tool-selection or thinking reuse parameters can fall back once to the original same-model summary path; authentication failures, cancellation and returned tool calls do not trigger that compatibility retry. Summaries incur usage; continuation creates a new prefix. Up to eight snapshots, bounded to 2 MiB by serialized size, remain only in memory, without another full disk copy. This is not a cap on the application's whole JavaScript heap.

**Using a separate cheaper compaction model:** the main model keeps its own fixed instructions and tools. The first compaction establishes a summary baseline. Later compactions preferably summarize only newly compactable history and append a segment after earlier summaries without changing their text, order or IDs. Earlier summaries provide reference context for the compactor; new segments record changes and completed work without repeating the old conclusions. Later progress takes precedence while user constraints remain. Token Saver rebuilds history only from the first changed entry, retaining the matching leading representation.

At most eight summary segments share an estimated combined budget of 15% of the current main model's context window, reserving room for the new summary and a safety margin before appending. Each generation is also limited by the compactor's configured output maximum and usable context. Smaller windows reserve additional space for historical input and rolling summaries; reasoning and visible text share the resulting output allowance. Segment/budget limits, an insufficient compactor window or newly recognized credentials cause a merged new baseline. Output exhaustion requests a shorter summary and a smaller history fragment under the bounded recovery rules below. Oversized/invalid responses, nonshrinking summaries and cancellation do not replace the last complete checkpoint. A backup starts again from the original compactable history and complete old summaries. Segments persist with the existing local checkpoint and survive restart/fork; original messages remain.

This preserves opportunities to reuse earlier summary prefixes, but main-model and compaction-model caches are independent and cannot share hits across models. Replaced raw history and the following suffix still need rebuilding; a merged baseline also changes the summary prefix. Provider expiry, minimum lengths and routing still apply. Do not retain unlimited history just to increase a cache ratio. Activities identify appended segments versus a new baseline; CTX → Token Saver shows separate reported usage and diagnostics for main and compaction requests.

### Reduction and response guidance

Exact duplicate references, safe JSON/YAML minification, compact runtime context and selective coding prompts default on. JSON strings and numeric lexemes are preserved. Uncertain YAML, comments, aliases, tags, special keys and unsafe numbers stay verbatim. Core, safety, permission, tool, user/project instructions and referenced skills remain.

Response modes are Minimal, Auto, Standard and Detailed. New configurations use Auto, matching detail to task complexity and preserving complete work and verification evidence. Existing explicit modes remain. Explicit requests for detail take priority; deliverables and tool arguments must not be truncated for brevity. Lists, tables, code and incremental changes are encouraged only when appropriate.

Messages containing native Responses / Gemini / DeepSeek state or image-bearing tool results retain exact visible text, without minification, excerpts or deduplication that could invalidate replay or visual evidence. Source fingerprints include scoped state and image-content hashes; replacement ledgers do not duplicate opaque state or image bytes.

Advanced excerpts default off: older low-relevance assistant explanations, AST outlines of long historical assistant JS/TS, and head/tail excerpts of long successful tool results. These may omit details and require original recall before relying on them. They apply only when the `recall_context` tool is available. Recent turns, user constraints, errors and tool pairing are protected. Prefer the existing code index, function/line ranges, diffs and error-adjacent evidence; read more source when needed. Already-decided 2–8-step tool chains still perform each approval and isolation check; no unknown side effects are cached or replayed.

### Usage and originals

Open **CTX → Token Saver** or plugin settings to inspect the selected conversation:

- **Cumulative reported usage** includes chat/tool reasoning, compaction, model review, project memory summaries and title generation from this version onward. Failed/retried attempts count if usage was reported. Missing and partial reports are labeled and not filled with estimates; this is not a provider bill.
- **Cache reads and writes** show provider-reported token counts and reporting coverage. Hit rate divides cached input tokens by input tokens only for requests with valid cache-read reports, excluding requests with unknown caching. An explicit zero is a zero hit; absent fields and older records remain unknown. Cache writes are separate and provider pricing applies. Cached reads and writes still occupy the full context window and are not subtracted from CTX.
- Version 1.3.2 accepts DeepSeek hit/miss counters and native Gemini `usageMetadata` / `usage_metadata` aliases, including gateway-forwarded fields. Valid standard usage wins, including explicit zero; conflicting or invalid counters are not combined into a cache report. Native Gemini output includes reported thinking tokens, and cache hits are not added twice to a complete input total. Gateways are not guaranteed to report these fields.
- **Cache prefix diagnostics** compares consecutive actual requests per conversation and purpose: first observation/restart, provider/protocol/endpoint/model/authentication changes, tools/system changes, rewritten/shortened history, append-only or unchanged prefixes. Generation settings and cache-policy changes are separate facts; moving a breakpoint does not rewrite history. Blocks are not tokens. Detailed comparison is bounded to 2048 blocks, with an explicit limit state if the full prefix cannot be verified. Matching structure does not prove server cache validity; absent usage is not zero.
- **Latest request input estimate** compares before/after history transformations with identical prompt/tools. It is not an actual billing counterfactual, excludes some prompt savings, and does not subtract summary overhead. Zero reduction is valid.
- **Latest request changes** shows up to 100 strategy records and before/after estimates. View original offers read-only pagination, including single lines beyond 16,000 characters. Model recall is restricted to the same conversation, with no workspace access or side effects.

Settings, usage totals, latest optimization metadata, summary estimates and cache diagnostics remain local database records. Diagnostics retain bounded keyed digests and safe change/block/usage summaries, without request text, file paths or API keys. The random key exists only in the current process; restart establishes a new comparison baseline. No new cloud collection or full chat disk copy is added. Deleting a conversation removes its records. Rewriting history clears stale optimization/summary displays and cache diagnostics but retains incurred usage. Keep source files and backups; a model summary is not a substitute.

## Quick start

1. Open Mingshen Harness from the desktop or Start menu. Review the Terms of Service, Privacy Policy and Disclaimer, tick all three separate checkboxes and wait at least five seconds before continuing. This permanently embedded guide opens after acceptance. Reopen it using the titlebar book icon or Settings → About → User guide; no external manual URL is required.
2. Add a model provider with its name, API Base URL, protocol and API key. Generic endpoints end in `/v1`; official Gemini / DeepSeek exceptions are listed under Provider prompt caching. `Chatgpt Pro` is an editable example name, not an included subscription.
3. Fetch models, select an exact Model ID and configure its context window, output limit, input modalities, tool support and reasoning levels. Connection tests send a real minimal request and may incur provider charges.
4. Create a conversation, select a model and workspace, and review the workspace trust prompt. Start with Request Approval.
5. Try a read-only task, then a small change with a clear acceptance test. Review actual tool output and diffs before using generated code.

Choose Start using or close the guide to finish onboarding. Subsequent normal launches do not automatically show policies or the guide. If the application closes or reloads after consent but before this step, it restores the guide without repeating the checkboxes. First use is based on complete consent records in the current Windows user data directory. Reinstalling while retaining data keeps that consent; a different installation folder is not a new profile. Do not delete existing data to test onboarding.

The titlebar book button switches between User guide and [Changelog](CHANGELOG.en.md). Both documents are embedded and available offline. The changelog covers versions 1.2.1 through 1.3.6.

## Automatic retries

From 1.2.9, connection interruptions, prematurely ended streams, HTTP 408/409/425/429 and temporary 5xx errors retry the current model request. The default is **five reconnection attempts per interruption**, excluding the initial request. Settings → Runtime and integrations → Automatic model request retries accepts integers **0–20**; zero disables retries and twenty permits twenty consecutive reconnection attempts per interruption. Search settings for “retry” to find it.

The allowance applies to each interruption, **not the whole conversation, task or streaming reply**. If the connection recovers at 3/5 and disconnects later, the new interruption starts at 1/5. Forward progress in text, reasoning or tool arguments resets the count and backoff. Merely connecting, empty responses, heartbeats, usage frames or replayed incomplete output do not reset it; persistent failures still exhaust the current allowance. Each successfully completed model request also leaves a fresh allowance for the next request.

Main conversations, subagents and scheduled tasks use this request path. Reconnecting shows the current retry/limit; expand the activity for the error and wait. Execution continues after recovery. Backoff waits approximately 1, 2, 4, 8, 16 then 30 seconds, capped at 30 seconds thereafter; a server-requested delay is bounded to five minutes. Stop immediately cancels requests and waits. The app must remain running; this does not resume tasks after quitting.

Only the failed model request is resent. Completed tools and results remain; partial text and unfinished tool arguments from the failed attempt are discarded. Incomplete tool calls never execute. Permissions, isolation, locks and uncertain-effect recovery barriers remain active. Tool failures and unknown side effects are not automatically replayed. Authentication/permission failures, invalid addresses/arguments, certificate failures and content-policy restrictions need correction; exhausting retries preserves the final full error and redacted local logs.

Approval and compaction also retry transport errors within the existing primary/backup order. Valid denials remain final; invalid verdicts/summaries follow the original fallback rules. Each reviewer retains a 45-second total timeout and each summary fragment a 300-second total timeout including waits, so fallback/manual handling can occur before all retries are used. Repeated model requests may incur extra API usage. External ACP editors cannot retract streamed chunks and receive an explicit discarded-attempt/retry separator.

### Controlled tool chains

When the next tool actions are fully determined, Mingshen can let the model declare 2–8 static actions in one response and execute them in dependency and literal-guard order. This removes only the extra model round trip for an already-decided next step; it is not a cross-task cache of model judgment. Each action still validates arguments, requests approval, enters isolation, acquires the workspace write lease, records activity and creates a checkpoint. Diagnostics, plan changes, denial, cancellation or uncertain side effects stop the remaining actions and return control to the model. Completed writes, commands and MCP effects are never replayed, and tests/builds/complex commands are not cached.

### Project memory

When creating the first conversation for a new project, select its workspace, then choose Native Memory or TencentDB Agent Memory (local core) under Project memory. Later conversations, forks, actual child sessions and associated worktrees inherit that choice. Settings → Project instructions and trust lets you select a workspace manually and change its memory backend, even before creating a conversation. Finish its conversations, children and running memory maintenance before changing configuration. Exactly one backend is active at a time; an explicit switch retains both directories without deleting, renaming, migrating or merging data. Selecting a child workspace or associated worktree resolves settings to the top-level parent's workspace and displays the actual memory workspace. Ambiguous legacy directories or conflicting configuration still block continuation until you explicitly save the intended backend here. Configuration, selected-directory and initialization failures remain visible and never silently switch backends.

For TencentDB, each workspace can select a primary analysis model and an optional fallback. Leaving the primary unset uses the current primary conversation model; a fallback may be configured alone. Explicit primary and fallback selections must differ. Necessary conversation text and candidate memories are sent to the selected provider and incur API usage; the fallback may use another provider. A failed call or invalid structured result restarts the entire extraction and conflict operation with the fallback. A valid empty result means no new memory and does not trigger fallback or raw-answer excerpts.

Native Memory maintains a visible `.harness-memory/` directory in the selected workspace: `preferences.md` for compact preferences, `memory.md` for task conclusions, `index.md` for keyword references and `archive/` for older diary summaries. Short-term context stays in the current session; new runs load preferences first and search diary history only when relevant. Successful tasks may produce a factual 50–100 word/character summary. It must not copy raw dialogue, temporary context or secrets, and may create additional model usage.

Both backends support `/remember content`, `/forget ID or phrase`, `/memory search keywords` and `/memory stats`. Native Memory can directly capture explicit durable language such as “from now on” or “always”; quoted blocks and code examples are excluded from direct preference capture. The main chat model must request confirmation before saving an inferred preference through memory tools. TencentDB replaces that rule capture with separate semantic analysis, producing automatic records that need review as described below. Settings → Project instructions and trust → Project memory supports viewing, editing, search, deletion, refresh and disabling automatic maintenance. Disabling stops new automatic memory injections and task-memory extraction from the next model request; explicit management commands remain available. Previously sent memory snapshots, tool results and summaries remain part of the original chat history. Disabling, editing, deleting source memory or using `/forget` does not retroactively erase that history. Start a new conversation to stop carrying old content and delete the original chat as needed. Drafts remain separate by tab, and external edits cause a revision conflict instead of silent overwrite.

Only primary sessions can write through memory tools. Actual child sessions cannot use ordinary edit tools to modify memory directories. Their commands use a read-only workspace under both native MXC and Docker, including before memory directories exist. Approved managed file tools may still edit ordinary project files, excluding memory directories. Primary-session command policy remains unchanged. Host custom tools, hooks, LSP and stdio MCP are unavailable to children. Read-only remote MCP remains a trusted third-party boundary, not a certified read-only guarantee. Read-only Plan does not automatically create memory files or diary entries. Memory remains correctable project data subordinate to current instructions and safety rules.

Native Memory preferences are limited to 6 KiB. Once the active diary exceeds 50 KiB, older task summaries move into archives intact without truncating conclusions. Retrieval returns at most five excerpts / 3000 characters; up to 40 archives and 2 MiB of combined retrieval sources are supported before manual cleanup is required. Deduplication matches normalized identical content, not guessed semantic equivalence. Entries are already concise task summaries; archival does not call another model to rewrite them. The derived index can be rebuilt after direct file corrections, with a 256 KiB preview limit. Reaching that preview limit does not delete entries or exclude retained sources from search.

The TencentDB local core embeds the upstream v2.0.3 L1 extraction scheduling, quality filtering, candidate recall and conflict decisions, writer and SQLite full-text retrieval. The analysis model runs the pinned upstream generic conversation extraction and conflict prompts, distilling useful facts into `persona`, `episodic` or `instruction` records and choosing `store/skip/update/merge`. Complete answers and `Assistant result excerpt` are no longer used directly as automatic memories. Tencent work/team prompts are not used. Host-committed atomic snapshots in `.harness-tencent-memory/records.jsonl` are authoritative, bounded to 2000 records / 2 MiB. Upstream product-storage fallback is disabled; the full-text index is rebuilt temporarily in memory without another persisted SQLite database. Preferences are bounded to 6 KiB; searches return at most five excerpts / 3000 characters, with at most 800 characters each. This preset has no automatic archive: shorten or delete entries in Settings when reaching its limits. Deleting an entry removes it from the current snapshot.

Both extraction and conflict system prompts and user templates use the pinned upstream `chat` text unchanged, without appended host rules or current primary Agent instructions. Input scope, capacity, source validation and confirmed-preference protection remain enforced by the host. Storage and fallback models are application adaptations.

The TencentDB settings editor displays existing records as a JSON array of `{id,type,content}`. Edit `content` or remove entries while preserving their existing `id` and `type`; add entries with `/remember` or approved memory tools. Do not paste native Markdown into this editor. Automatic analysis records can be updated or merged. Confirmed `persona`/`instruction` preferences are excluded from the mutable conflict store and cannot be rewritten or deleted by this flow. Saved status requires a committed change; duplicates and valid empty results report no additions and the stored count. Errors, invalid output, cancellation, changed configuration and revision conflicts preserve the committed snapshot without failing the original task. Upgrades and backend switches do not bulk-delete or rewrite old excerpts. Later semantic maintenance can still update or merge unprotected old records; you can also review, correct or delete them in Settings.

No Tencent account, TencentDB service or OpenClaw is needed. The preset excludes Tencent business workflows, cloud/team services, telemetry, L0 raw-transcript archival, the complete L0–L3 pipeline and vector/embedding APIs. It combines the upstream L1 semantic workflow with local storage rather than embedding the complete Tencent product. Model requests go to your configured provider.

Only successful primary tasks attempt automatic maintenance. Native Memory continues to use the current model with a 30-second summary deadline; TencentDB uses the workspace's configured primary and fallback analysis models. Model-generated memories can be incorrect; complete sensitive-data detection and fixed Token savings are not guaranteed. Review entries and avoid storing secrets or private transcripts. Normal chat still calls the configured model and may include preferences and retrieved excerpts. Local storage does not imply offline model analysis: necessary conversation text and candidate memories reach the analysis provider, and fallback may add another recipient. The project library does not use a Mingshen or Tencent memory service. These are ordinary workspace text files that your Git, sync and backup tools may include; check them before publishing.

### Task workbench

From 1.2.7, completed/cancelled active plans remain visible for the current turn and clear at the next user message. The current model reviews unfinished old plans using `review_plan`: keep related progress, discard superseded/unrelated tasks, then create a new plan when needed. During review, old progress has a static Reviewing previous plan label. Invalid decisions produce a bounded error and retain the plan; retry or clear steps in the plan editor. This metadata housekeeping does not request additional approval.

Resume from checkpoint explicitly continues the existing unfinished plan and preserves progress. An ordinary text request to continue is assessed by the model. Interruption alone does not imply abandonment. Cleanup does not erase chat history, saved project plans or uncertain-effect safety barriers.

The sidebar counts only parent conversations toward each folder's recent three. The arrow beside a parent's ellipsis expands/collapses its workers, including workers with separate worktrees. Right-click opens the same menu; child search results include their parents. A local incremental database index supports paged startup/search, and Load more fetches further records. Long lists use virtual scrolling. Search covers all unarchived conversations without expanding every folder.

Task plan shows the Agent's real `update_todos` steps and progress: above the chat or in Simple's collaboration inspector, and in Light Trails' lower-right Plan tab. Edit descriptions, dependencies and status, add steps, pause/resume or set a breakpoint before a step. Simple's compact task band also expands/collapses. Revision checks reject concurrent overwrites. Dependencies must be acyclic and complete before a dependent step starts. Saved plans survive restarts and full conversation forks. Breakpoints depend on the Agent marking the step in progress before its next tool.

While a plan edit is unsaved, switching to another conversation or ChatAgent, creating a new conversation, or archiving the current conversation or one of its ancestors is blocked. The task workbench opens the Plan tab and prompts you to save or cancel; switching CodeAgent/WorkAgent within the same conversation remains available. The guard neither saves nor discards edits automatically, and unsaved plan edits are not guaranteed to return after a restart.

An in-progress step spins only while its conversation is running and the plan is not paused. Stopped tasks show Interrupted, paused plans show Paused, approvals/questions show Waiting for user, failures show Failed, and unfinished steps in an idle conversation show Awaiting continuation. These labels do not erase progress or mark incomplete steps complete.

Agent task tree shows actual parent/child conversations and queued/running/waiting/interrupted/failed states. A child's arrow expands a bounded output pane within the main conversation; only its name opens the full child conversation. Recent text, reasoning summaries and collapsible tool output update while streaming and remain available from local records after completion or reload. Refresh retries loading. Long histories are truncated with a notice; open the child for complete history. Collapsing stops preview loading. The configured concurrency limit and no-recursive-workers rule remain enforced.

Expanding reveals that child within the task tree without moving the main timeline. Output scrolls independently and initially follows the latest content; scrolling up pauses preview following, and returning to the bottom resumes it. Simple's compact task band stays above the composer. Docked tasks, including Light Trails' lower-right pane, use a dismissible drawer when the window is narrow. Expand reasoning summaries or tool output separately to inspect details.

Project plans saves named plans independently of the source chat. In another conversation with the same workspace, choose Attach to this conversation. Completed steps remain completed and previously active steps become pending; Reset progress on attach starts over explicitly. Deleting the source conversation does not remove a saved plan. With pending plan steps, the engine requires `begin_plan_step` before side effects, checks dependencies and pauses at configured breakpoints.

New profiles are Code Review / Review Worker, Operations / Operations Worker, Inspiration and Brainstorm. Reviews, investigation workers and Brainstorm are read-only. Operations requires human confirmation for commands and mutations even with Full Access. All enabled built-in and custom profiles appear in conversation selectors; introductions scroll.

`code_index` uses bundled parsers for JavaScript/TypeScript, Python, Go, Rust, Java, C/C++ and C#. Query definitions, references, callers, callees and imports with path/line/column evidence. These are syntax candidates; dynamic dispatch, overloads and cross-language bindings need LSP/source confirmation. Fingerprints support incremental updates. Defaults are 10,000 code files and depth 32; `max_files` / `max_depth` allow up to 20,000 / 64, with additional bounded directory, file and symbol limits. Protected reads still require approval and isolation.

Unchanged file reads return concise references after real content verification; `refresh: true` requests full content. Concurrent equivalent reads share execution after authorization, and writes invalidate results. Exact runtime version probes briefly reuse results. Literal `Get-Content -LiteralPath`, `Get-ChildItem -LiteralPath` and `Test-Path -LiteralPath` use structured, dependency-verified reads. Test/build/install commands, complex shell expressions and mutations are never cached.

`read_file` accepts `start_line` with `limit` or `end_line`. Continue a long first line with its UTF-16 `char_offset`. Output identifies the actual range and returns JSON arguments for the next read when needed. Range-specific cache entries still check the full source hash; pagination never bypasses external-change protection.

With parallel tool calls enabled for the model, at most three adjacent independent built-in reads from one response run concurrently: file/document/image reads, listings, searches, code indexing and web reads. Every call keeps its own permission, approval, isolation and budget checks. Commands, writes, chains, browsers, MCP and custom tools are excluded.

`exec_command` starts a managed long command and returns a `command_session` identifier while it is running. `write_stdin` polls new output, sends input, closes stdin or stops it. Empty polls do not repeat execution approval; input still follows current policy. Sessions belong to the original conversation/run, cannot be reused across chats or restarts, and managed processes stop with cleanup when the run stops or ends. Unconfirmed cleanup retains the workspace write barrier and lease. Failed cleanup is not automatically retried, so recovery may require restarting the application; verify process/container termination and partial effects before clearing a barrier. This uses pipes rather than a PTY; full-screen or TTY-dependent applications are not guaranteed. Deliberately detached host background processes are not guaranteed automatic cleanup. The command panel remains an execution-record view.

Code work enters an explicit verification phase using declared project test/lint/typecheck scripts. Real failures feed back for up to three verification attempts. Checks use the existing approved/isolated command gateway and remain in history. Missing configuration or denied checks are not reported as passing; document-only changes do not trigger code diagnostics.

JavaScript/TypeScript projects use `package.json` scripts and `packageManager`. Without that manifest, Rust uses `cargo test/clippy/check`, Go uses `go test/vet`, and Python projects with `pyproject.toml` try `pytest` and `ruff`. Missing dependencies produce visible failures instead of silent installation. To customize checks, put `mingshen.verify.json` at the workspace root with 1–6 nonempty commands, for example:

```json
{
  "commands": ["npm run test -- --run", "npm run lint", "npm run typecheck"]
}
```

Review these commands because they execute project code. Unreadable or invalid configuration is not a successful check. Avoid development servers and watch commands; each verification command has a 120-second timeout. Up to three failed verification attempts are fed back for correction; remaining code or environment failures require review.

Conflicting writers require a human choice. Transfer stops and waits for the original task; the pending operation is not executed. The engine requires a fresh file read, or `list_files` for a directory transfer, before retrying. Workers cannot stop an ancestor to seize ownership. Commands, writable MCP, custom tools and plugin hooks conservatively lease the workspace. Built-in edits detect content changed since the Agent's last read and ask to re-read or stop. These are application coordination leases, not OS locks against arbitrary external programs; extensions can also affect remote/out-of-workspace resources.

A conflict requiring your decision sends a Windows reminder when its conversation is not visible in the focused window. Click the body or Resolve conflict to return to that conversation and choose the writer or re-read in the application. The notification itself never stops another Agent, transfers ownership or overwrites files.

Approve similar in this session scopes grants to workspace reads/writes or simple command prefixes, including currently pending matching requests. It does not switch permission mode, cross sessions or survive restart. Explicit manual policies, dangerous operations and shell hooks are excluded.

Resume continues in the same conversation with the latest persisted plan revision, step IDs, completion/cancellation/in-progress statuses, dependencies and breakpoints, including edits saved after interruption. It unpauses the plan without recreating it or resetting completed steps. Every subsequent model request re-reads the current plan so older tool history cannot supersede new edits. It does not automatically complete or replay child tasks or bypass inspection of uncertain effects.

Resume preserves history and plans. Confirmed tool/argument fingerprints are not directly replayed; uncertain executing calls block further side effects across retries/restarts. The Agent must inspect real state, then call `resolve_interrupted` with successful inspection call IDs and a factual summary for your confirmation. MCP timeout/cancellation may stop only transport while a remote operation continues; new writes in that workspace remain blocked pending inspection. Confirm remotely that execution has stopped before continuing. Arbitrary external effects and semantically equivalent commands cannot be guaranteed exactly once.

Selecting all three checkboxes and continuing affirms that you have fully read,
understood and accepted the three agreements and will comply with their terms.
You acknowledge the consequences, responsibilities and effects of model use,
commands and file changes. To the extent permitted by law, responsibility for
your independent choices and authorizations remains yours rather than the
developers' or 新哲文院算法社's. Liability that cannot lawfully be excluded remains
subject to applicable law. Revised policies require renewed acceptance.

Example first task:

```text
Read this project and explain its startup commands and key modules.
Do not edit files yet. Identify three issues with file references.
```

## Providers and models

| Protocol | Appended to the Base URL |
| --- | --- |
| Anthropic Messages | `/messages` |
| OpenAI Responses | `/responses` |
| OpenAI Chat Completions | `/chat/completions` |
| Google Gemini | `/models/{Model ID}:streamGenerateContent?alt=sse` |

Generic Base URLs end in `/v1`. Native Gemini uses `https://generativelanguage.googleapis.com/v1beta` with `x-goog-api-key`; its official Chat Completions Base URL is `https://generativelanguage.googleapis.com/v1beta/openai`. Official DeepSeek also supports protocol-specific root, `/beta` or `/anthropic/v1` paths listed under Provider prompt caching. Do not repeat the request endpoint in the Base URL. Use one protocol per provider; create separate entries for different protocols. Authentication supports Bearer, `x-api-key`, `api-key`, `x-goog-api-key` and custom headers. Prefer HTTPS for public providers and HTTP only for trusted local services.

Native Gemini accepts bare model names such as `gemini-2.5-flash` or a `models/` prefix. Discovery reads all pages and lists models supporting `generateContent`. New native models default to `auto` reasoning; empty or `auto` leaves the API default. Use `auto` for Gemini 2.5; Flash also supports `none`, while Pro cannot disable thinking. For 3 and later, configure only the specific model's supported `minimal,low,medium,high` levels. The app does not invent token budgets. Configure context/tool capabilities from the upstream model. Text output and enabled image/audio/native PDF inputs are supported; other files retain extracted-text handling, while output media are not supported.

Returned native Parts and `thoughtSignature` values retain their order, with function results paired to calls. Only optional server-issued call IDs go back on the native wire. Truncated, blocked, cancelled or malformed turns do not execute tools. Native Gemini uses implicit caching without creating explicit resources. This protocol does not implement Vertex AI or Google Interactions. Gateways must implement GenerateContent at a Base URL ending in `/v1beta` or `/v1`; an OpenAI-compatible endpoint is a separate protocol.

Each model has its own ID, name, context window, maximum output tokens, modalities and tool capabilities. Configure only capabilities actually supported upstream. Reasoning levels are ordered comma-separated values such as `none,low,medium,high,xhigh,max`; they generate the chat slider. Anthropic uses adaptive thinking and effort rather than a manually entered thinking token budget.

New models entered manually or selected from discovery apply the following editable preset once, on the first supported prefix. Later ID changes in that draft and editing saved models do not overwrite custom settings. Presets are not detected provider capabilities:

| Model ID prefix | Context | Maximum output | Inputs | Reasoning |
| --- | --- | --- | --- | --- |
| `gpt-6` (including `gpt-6.1`) | 1000000 | 128000 | text, image, file | `none,low,medium,high,xhigh,max` |
| `deepseek-` | 1000000 | 384000 | text, image, file | `low,high,max` |

The new GPT model form offers an unchecked-by-default long-context billing checkbox. Checking sets context to 200000; unchecking restores 1000000. Output keeps its entered value, initially 128000. This local form control neither detects nor changes provider billing; the actual numeric context is saved.

Context and output inputs accept `K/k` for 1000 and `M/m` for 1000000: `100k` and `100K` both mean 100000; `1.5M` means 1500000. Only these decimal units are supported, and conversion must produce a safe positive integer. Saved values are integers and output still cannot exceed context.

Edit a saved provider's name, Base URL, API protocol or authentication on its Connection tab, then choose Save connection. Existing provider, key, model and conversation references remain. While any conversation is active, endpoint/protocol/authentication changes are rejected with drafts retained; name-only changes remain available. These connection changes clear stale context-usage calibration for that provider's conversations and estimate again, preserving summaries, original history and cumulative usage. A protocol change resets incompatible cache mode/lifetime settings to Automatic/five minutes, ready for reconfiguration.

Responses can retain provider-issued encrypted reasoning/compaction items and assistant `commentary` / `final_answer` phases. Native state is stored with local messages and replayed only when provider, model, endpoint, visible text and tool identities match; switching configurations does not send opaque state to another model or endpoint. Official endpoints request encrypted reasoning state; gateway support and returned fields depend on its implementation, with ordinary history used when state is absent. These are opaque provider-issued items, not readable raw hidden chain of thought or unlimited context.

Context estimation does not count reasoning/compaction ciphertext string length as tokens. It reserves 1024 tokens per item, capped at 8192 in total and 5% of the current model's context window, while actual provider usage continues to calibrate the estimate. This bounded allowance cannot reveal the size of native state or guarantee an exact token count.

Model menus group models by provider. Multiple keys can be stored, enabled, prioritized, replaced or deleted. Full keys are not revealed by the UI. Rotation does not bypass quotas or service limits.

Provider, key and model fields support continuous typing, IME composition and selected-text replacement. Background conversation and approval updates do not move focus to the close button. Use the corresponding Save button to persist changes. Escape or the close button exits settings without submitting unsaved drafts.

Model menus use the available space above or below their trigger and scroll internally when providers or models exceed it. Use arrows, Home/End, Enter to select and Escape to dismiss the menu first. Skills references, CTX details, `/` and `@` lists also have bounded scrolling and reposition when the window or composer changes size.

### Provider order and starred models

In Settings → Providers and models, hold a provider row or its drag handle, then drag and release at the desired position. Provider headings inside model menus work the same way, sharing one display order across settings and menus. Focus a handle and use Alt+Up/Down to move a provider; horizontal provider lists also accept Alt+Left/Right. Holding near a scrollable edge continues scrolling, and Escape cancels a drag.

On a provider's Models tab, use the star beside each model to star or unstar it. Chat, new-conversation, automatic-approval, compaction, child-agent and TencentDB memory-analysis selectors all have a collapsible Starred models group at the top, labeled “Model ID (Provider)”. Stars in this group and the ordinary provider groups update favorites without selecting a model or closing the menu. Selecting the model itself uses that entry's existing selection and save behavior.

Stars belong to exact model configurations. Matching model IDs at different providers can be starred separately; deleting and recreating a configuration requires starring it again. Each starred group respects its selector's eligibility: disabled models are unavailable, memory analysis still requires text input/output, and its backup excludes the selected primary analysis model. Temporary ineligibility retains the star for when the model becomes available again; deleting a model or provider removes its preference. Starred rows follow provider display order and each provider's existing model order.

Order and stars save automatically on this device and survive page changes and normal restarts. New providers append to the display list. These preferences do not change current conversations, default/backup models, child-agent inheritance or API key priority. Use main conversation model, Use current model and existing clear-backup controls retain their usual meaning; unstarring a model does not clear an existing selection. Read or save failures display a reason and Retry; consider the preference saved after a successful retry.

## Conversations and workspaces

The sidebar groups conversations by folder. Its plus button immediately creates and selects a conversation using the most recently updated, unarchived primary conversation's provider, model, reasoning level, agent, permission mode, execution backend, system prompt, patch setting and referenced extensions in that folder. It does not open workspace setup or copy history, approval grants, titles or runtime state. Use the main New conversation button to choose a different folder or configure from scratch. Invalid source model or agent settings must be repaired before retrying. Collapse a group or the entire sidebar for more space. Multiple conversations may run simultaneously.

Each folder initially shows only its three most recently opened or updated conversations. Choose Show all to reveal the others and collapse again when finished. Search includes hidden, unarchived conversations. Opening an older chat moves it into the recent list. The expanded list retains pin and parent/child ordering. Hiding a row never stops its task or deletes its history.

History is stored locally. Automatic compaction summarizes context at 85%; original history remains local. See Context and automatic compaction below for timing and model choices. Copy, edit and retry controls are available on messages. Editing or retrying replaces that message and all later history after confirmation.

The copy icon beneath a completed reply copies that reply's full original Markdown, including lists, links and code fences, without reasoning summaries, tool logs or other messages. Each Markdown code block also has a top-right copy icon that copies only its code, retaining indentation, newlines and special characters without the language label or fences. During generation you can copy the code currently available; the full-reply button appears once the message is saved. A check mark confirms success, and failures can be retried. Copying never changes the conversation.

Hover a sidebar conversation and open its ellipsis menu to rename, fork, pin/unpin, archive or delete it. Pinned conversations lead their folder group. Deletion requires confirmation, stops related work, and removes the conversation, its children, message history and application snapshots. It does not delete project files.

Choose Open in File Explorer to open that conversation's working directory in Windows File Explorer, without selecting the conversation first. It is also available while a task is running. If an isolated worktree has been created during this application run, it opens that editing directory; otherwise it opens the configured folder without creating a worktree. The option is disabled when no directory is set. Missing or inaccessible folders produce an in-app error; the action does not create folders or modify files.

### Manage conversations by folder

Open **Settings → Conversations and data → Manage conversations by folder** and choose a workspace. The selector includes folders with only archived records and conversations without a workspace. It loads the complete conversation list independently of the sidebar's expanded or loaded rows. Choose Unarchived, Archived or All, then search root conversation titles.

Check individual roots, or use Select all matching conversations to select every matching root across pages. Each page contains 50 rows in an independently scrolling list. Paging retains selection; changing the folder, scope or search clears it. All children follow their selected root, including children using separate worktree directories.

Archive and delete confirmations show the actual root and child counts. Finish related running work before archiving. Archive retains history and drafts and pauses associated schedules. Select archived roots to restore them in bulk; reenable schedules separately. Permanent deletion stops and waits for related work, then removes messages, drafts, attachments and application snapshots. It cannot be undone; project files remain in their workspace.

Settings stays open while the batch runs. Results show success counts and each failure reason. If a confirmed conversation's children, folder or archive status change, processing stops for that root and asks you to refresh, protecting newly added or moved conversations from deletion. Successful operations are retained; failed roots remain selected so you can resolve the cause and retry.

### Question history navigation

After at least two questions have been sent, short markers appear along the right edge of the chat. Each represents a sent question. Hover to preview its opening, a text excerpt and attachment names; click to jump to the original message. A longer, brighter marker follows your reading position. Previews use local message text without an extra model request or API usage.

For long histories, scroll over the rail to reach other markers. Tab can focus a marker; arrow keys and Home/End select, Enter jumps and Escape dismisses the preview. Jumping to history during generation pauses following, so new output does not pull you back down. Scroll back to the bottom to resume following. Switching conversations uses that conversation's own questions. Editing/retrying removes markers for replaced history. Attachment-only messages are included.

### Fork a conversation

Send `/fork` or choose Fork conversation in the sidebar ellipsis menu. A new independent conversation opens with all saved messages (including attachments, reasoning summaries and tool calls/results), model, reasoning, Agent, system prompt, permission/automatic-review choice, execution mode, extension references, todos and valid compaction checkpoint. The source remains unchanged. Later messages, rename, archive and deletion are independent. Forks are primary conversations, not subagents, and do not consume subagent slots. Wait for active work to finish or stop it first; a cutoff cannot split unfinished tool calls from their results.

Pending approvals, temporary grants, schedules, snapshots and active jobs are not copied. Forking a chat does not fork files or create a Git branch. Both chats still affect the same workspace unless you choose a separate worktree. Uncommitted files are not automatically copied to worktrees.

### Composer slash menu

Type `/` to open the menu and continue typing to filter. Arrow keys select, Enter/Tab executes and Escape closes. Enter during IME composition does not execute commands. Built-in commands run locally rather than being sent as ordinary model messages:

| Command | Action |
| --- | --- |
| `/rename` or `/rename New name` | Open the app-styled rename prompt or rename directly |
| `/compact` | Summarize complete history immediately, below 85% too |
| `/archive` | Confirm and archive; restore in Settings |
| `/fork` | Copy full context into an independent chat |
| `/skills`, `/plugins` | Search and reference enabled local extensions, or open their management page |
| `/status` | Open context and model details |
| `/plan` | Switch to an enabled read-only planning Agent |
| `/mcp` | Open MCP settings |

Project/global Markdown commands remain available; choose one and add its arguments before sending. Built-ins take precedence on name collisions. A slash inside ordinary text or a path does not open the menu. Remove attachments before running chat commands; wait or stop active work before compaction, forking or state changes.

Archiving hides the conversation and its children from the sidebar and excludes them from automatic cleanup. Stop running work first. Associated enabled schedules are paused. Open Settings → Conversations and data → Manage conversations by folder, choose its folder and the Archived scope, then select it and choose Restore to continue. Restoration refreshes its last opened date. Re-enable schedules separately if needed.

In Conversations and data, choose Never delete (the default) or an inactivity period from 1 to 36500 days. Enabling cleanup requires confirmation. The application checks shortly after startup, then hourly. Archived, currently open, unsent-draft, running, approval-waiting, send-preparation and enabled scheduled-task conversations are protected, as are parents with protected children. Background updates do not refresh the last opened date. Cleanup permanently removes history and associated snapshots. Archive or export important records first.

### Unsent drafts

New chats, existing conversations and child conversations automatically save their own drafts without a setting. Complete text, including whitespace, source/format state and pending attachment contents stay in the local user data directory. Switch away and return, or quit normally and restart, then open the same conversation to restore them. Saved attachment contents remain available if the original files are moved or deleted. Saving a draft does not call a model or send it to a provider; formatted display still follows Appearance settings.

The submitted draft is consumed when the application accepts the message into history, or when you explicitly delete text, remove attachments or delete the conversation. Pre-accept send failures retain it. A model failure after acceptance leaves the message in history rather than restoring a duplicate unsent draft. Late send replies cannot clear newer input. Archiving and automatic retention preserve pending drafts.

Normal exit and reload wait for attachment reads and draft writes. Save or restore failures show a composer error with a retry icon; a failed save cancels exit. Resolve the cause and retry saving before quitting. Drafts belong to local application data; quit normally before backing up the complete data directory.

## Agent Questions

When an unresolved requirement or preference materially changes the work, Mingshen can call `ask_user` and wait for your answer, then continue the same task. Work conversations, Plan and custom independent Agent profiles can use it when the model supports tools and the profile permits the question tool. Whether it asks remains a model decision. You can explicitly request clarification before implementation.

- Each question has up to four choices, with a title and description, plus an application-provided Other text entry.
- Single choice accepts one option or Other. Multiple choices accept several options and can include additional Other text. Selecting Other requires text before submission.
- Usually one question is shown, with up to three related questions in a batch. Previous/Next lets you review answers; all are submitted together. Open-ended questions can use text only.
- The conversation says Awaiting your answer. The ordinary composer collapses while Stop remains available. Long options scroll inside the panel. Radio buttons and checkboxes support the keyboard; Ctrl+Enter in the text entry submits. Switching or reloading restores the pending question; unsubmitted selections are not accepted answers.
- Submit answer sends each selection and custom text to the current conversation model and resumes the original task. Questions and responses remain in tool history with the conversation context.
- Submission errors preserve the current choices for retry. Buttons recover after five seconds without confirmation. Stopping cancels the request without inventing answers. Full Access, automatic approval and session grants never answer for you.

Clarification is separate from file, command and MCP approval and never increases permissions. Avoid entering keys, passwords or secrets. Answers are sent to the selected conversation provider. Delegated child agents report questions to the parent, which consolidates them for the user. An independent conversation created with General, Explore or a custom Subagent profile can ask directly.

When the app is in the background, minimized to the tray or showing another conversation, a Windows question reminder can appear. Click it or View question to return to the matching conversation and submit your choices in the original panel. Dismissing the reminder does not answer the question. The active foreground conversation keeps its inline panel. Settings → Appearance → Agent questions and file conflict alerts controls both reminder types.

## Context and automatic compaction

Context includes system instructions, tool definitions, messages and tool results. CTX shows the percentage used. Click it for details such as `32.5K / 128K tokens`, count source, the 85% threshold, current model and last compaction time. K means 1000 tokens. Provider usage calibrates the count when available; otherwise the request is estimated. Tokenizers and multimodal accounting vary by provider. Configure each model's real context limit.

**No message is needed after restarting:** opening an existing chat restores its valid saved usage and shows Restored from local records. Older views missing model identifiers can recover using matching provider observations. New chats, forks, edited histories and model switches receive a Local context estimate based on the current model, effective summary/history, bundled instructions and locally known tools. An empty chat can use more than 0% because prompts and tools also consume context. Restoration makes no model request, starts no MCP server or project script, and incurs no model API usage. Other historical chats restore when opened rather than all being recalculated at startup.

Local estimation is not a precise tokenizer. Project instructions, full skill text and dynamic tools not yet loaded may differ; the next real request recalibrates with actual content. Another model's usage is never reused. Unknown usage is retained only when no valid model configuration is available; select an available model. Restoring a count does not trigger compaction by itself: the 85% check still happens before the next model request.

At **85% or more of the conversation model's context window**, compaction runs before the next model request. If the response has already finished, it waits for your next message rather than making a background request. During active tool work, the current tools finish first; compaction runs at the next safe request boundary without splitting pending tool calls from their results.

The composer displays Compacting context and explains that it may take a few minutes and original history is retained. Automatic compaction keeps the task running and resumes with the current instruction afterward. You may switch conversations, read earlier messages, reload to restore the notice, or stop.

**Manual compaction:** after a complete turn, send `/compact`, choose it in the slash menu or click CTX → Compact now. It attempts to summarize complete history regardless of the 85% threshold using the same current/global/custom and backup model rules. It adds no user message, starts no tools/MCP servers, produces no ordinary answer and sends no task-completion notification. Afterward it waits for your next message; originals remain visible. Stop or retry as needed. Missing compactable history, nonshrinking summaries and upstream errors are reported without saving a partial result.

After successful compaction, CTX immediately estimates the summary, retained recent messages, system instructions and tool costs, updating both its percentage and K-token count. This state persists across restart. Uncompressed history and observations from an older checkpoint do not refill the count. Large fixed instructions/tools still occupy space, so no particular reduction percentage is guaranteed. The next real request recalibrates against provider usage; CTX measures current context, not cumulative token consumption.

Click CTX → Compaction settings, or open Settings → Context & compaction:

| Choice | Behavior |
| --- | --- |
| No global selection | Each conversation uses its current model |
| Global default model | Conversations inheriting the default use this model; the chat model is unchanged |
| Conversation: Inherit global default | Uses the global choice, or the current model if none is set |
| Conversation: Always use the current conversation model | Uses the current model even when a global default exists |
| Conversation: Choose a compaction model | Uses that conversation's own provider/model, taking priority over the global default |

Save the global or conversation settings after selecting. The grouped model picker reuses saved provider credentials. Ordinary new conversations inherit the global default; folder-plus and child conversations inherit the source's model choice, without copying its summary or history.

On the same page, choose Backup compaction model (optional) and save it. The backup applies to all conversations, whether the effective primary comes from the current model, global default or a conversation override. Network errors, timeouts, lost streams, empty/error responses or summaries that do not reduce context trigger one backup attempt with a visible notice. The backup starts again from original history and the last complete checkpoint, never a partial primary result. Each candidate has one logical attempt; from 1.2.9 it may retry transport errors using the global setting within its total timeout. An effective duplicate is skipped; the saved global primary and backup cannot be identical. Clearing a selection also requires saving.

Total compaction output is constrained by **15% of the current main conversation model's context window**, the compactor's configured `maxOutputTokens`, and its usable context. Smaller compactor windows reserve room for historical input and rolling summaries, which can lower the allowance further. Actual request input and a safety margin tighten it again before sending. A **200,000-token main window** therefore allows at most **30,000 total output tokens**, and the actual allowance may be lower. **Reasoning and visible summary text share that allowance**; the full amount is not guaranteed to become visible text. Both primary and backup compactors follow this rule, and prompts specify the summary limit and the current request's summary-body target, reserving space for reasoning.

When output is exhausted, a notice explains that the app is requesting a shorter summary and reducing the history fragment; it also lowers the summary-body target. Each compactor allows at most **four bounded recovery attempts**. Each fragment request has a five-minute timeout including its transport retry waits, with at most 128 logical summary requests per compactor. Transport retries and output-limit recovery have separate bounds. Failure, cancellation or stopping preserves original messages and the last complete checkpoint without adopting truncated or partial summaries. Check output and reasoning settings or select another compactor if recovery is exhausted.

Older history becomes a summary for future requests while the current instruction and recent tool steps are preserved where possible. Original messages and tool records stay visible locally. Smaller summary models can merge history in chunks, but tiny context/output limits, an oversized single input or oversized fixed instructions can still prevent compaction. Parsed documents and text attachments contribute at most their first 120,000 characters with an explicit truncation marker; legacy saved attachments are also parsed locally when possible. Unparsed binary attachments contribute metadata and paths, not a claim to understand omitted content. Reattach important media when needed and verify important facts; a summary can omit details.

The selected provider receives historical messages, tool content and text attachments; compaction may incur additional API usage. Confirm its data policy and your authorization before choosing a separate provider. HTTP errors, empty summaries, tool calls and summaries that do not reduce context do not replace the existing checkpoint. Errors and original records are retained. If the original context still fits, the task continues without repeated attempts in the same run and retries on the next turn. If it no longer fits, an explicit error asks you to check the summary model, shorten the input or select a larger conversation window. Stopping or quitting does not save an incomplete summary.

## Permissions and isolation

ChatAgent always uses a restricted chat policy: only search, web fetch and uploaded-attachment parsing are available, with no local path read, file modification, commands, MCP, Skills, hooks, browser automation or subagents. It has no local-tool path to escalate to Full Access. CodeAgent and WorkAgent retain the existing Request Approval / Full Access and isolation settings; WorkAgent's office tools never broaden them. Optional Office COM is attempted only for WorkAgent with Full Access, host execution and no parent session when Office is already installed and policy allows it. Failure downgrades to structural verification with an explicit unverified state and never installs Office.

Request Approval reviews protected agent file access, commands and MCP operations. Examine the complete arguments and scope before allowing once, for a period, or for the session. You can reject with an explanation.

Allow for session remembers only the displayed path or command scope. A different operation can still require approval. Completing an older approval does not clear a newer one. Switching conversations or reloading restores pending operations from the main process; other conversations keep their own pending approvals.

Approvals and Agent questions both recover when the window regains focus, when you switch conversations and through background synchronization every three seconds. You do not need to stop and regenerate to recover a missed prompt. Submitting a decision shows a status row; if it remains unconfirmed after five seconds, the pending controls return with a retry message. Submission errors restore usable buttons, and an older acknowledgement cannot hide the next request. Use Refresh requests to synchronize immediately while a recovery status is shown. New prompts return to the visible part of the composer. Restoring the interface never approves an operation automatically.

### Automatic approval

1. Open Settings → Permissions & security → Automatic approval model. Choose an existing provider/model and save. The provider's current available API key is reused.
2. Select Automatic approval in the conversation permission menu or approval panel. Without a configured reviewer, an app dialog links to settings and the current operation remains pending.
3. Tool names, commands, paths and parameters are sent for individual review. File-operation arguments may include proposed content. Reviews do not include the entire conversation or executable tools. Check the provider's data policy; reviews may incur additional API usage.
4. The reviewer is prompted for a JSON verdict: `decision` must be `allow` or `deny`; `reason` may use any language. A single explicit Chinese/English verdict, case variations and a fenced JSON object are also accepted. Conflicting verdicts, missing reasons and ambiguous replies never grant access. Allow executes only that operation; deny returns the reason to the agent. Actual decisions appear in activity history.
5. You can decide manually during a review, stop the task or switch back to Request approval. Late results cannot grant access after returning to manual review.

Choose Backup approval model (optional) in the same settings block, then Save approval model. A network error, timeout, lost stream or invalid primary verdict triggers the backup once. A valid primary denial is final and never rerouted to seek approval. Each model uses its own provider URL, protocol and credentials, preferring a configured lower reasoning level. Each review attempt has a 45-second timeout, so two attempts can take nearly 90 seconds. Manual decisions remain available. Stopping, returning to manual mode or changing reviewer configuration cancels the obsolete review. Oversized operation arguments, shell hooks and explicit manual-only rules cannot bypass human review through a backup.

If both fail, the approval stays pending with both sources and HTTP details. Invalid-format errors include a redacted, bounded response preview to help identify upstream errors, output truncation or formatting issues. Free-form text in an unknown language is not guessed to mean approval. `Upstream HTTP/2 stream failed` identifies an upstream or gateway stream failure, not necessarily a local network problem. Check provider status, consider an independent backup provider or decide manually.

A backup reviewer receives the same operation data; a backup compaction provider receives the same history and tool content. Both may incur additional API usage. Confirm authorization for both providers. Backups are unconfigured by default and are not contacted after successful primary results. Clear and save the backup selection to disable it.

Automatic approval retains the protected execution backend, Plan restrictions and catastrophic-command protection. Shell hooks and explicit manual-only profile rules still require human approval. Models can misjudge risk. Saving a reviewer does not enable all conversations. Folder-plus conversations inherit the source's automatic approval selection, as do subagents from their parent.

The default protected backend is the native Windows MXC process sandbox, using a pinned upstream Codex executor. File tools and commands run within the selected workspace, command children inherit containment and command networking is disabled. The trusted application broker handles approvals, model requests, credentials, snapshots and UI outside that process sandbox. Unavailable or unsupported isolation fails closed, without silently falling back to host execution.

MXC needs recent Windows 11 updates: 24H2 build 26100.9278 or 25H2 build 26200.9278 and later. Windows 10 and older Windows 11 installations can select Docker. Being able to run the application does not imply that MXC is supported. Use Runtime and Integrations → Check dependencies to run an actual probe.

Host custom scripts, shell preprocessing, automatic LSP/formatter execution and hooks are restricted in protected sessions. Run project checks through approved isolated commands. Browsers, trusted broker operations, user-operated terminals and external MCP services have separate boundaries. Approving a local stdio MCP startup grants that third-party process host-account permissions, as stated in the startup prompt; it does not place the MCP process in the native sandbox.

Host file tools still use trusted main-process code with approval, path and link checks. This is not an operating-system sandbox for the entire Windows application. MCP servers, browser processes and user-operated terminals have separate boundaries.

Full Access allows broader execution with fewer prompts. Catastrophic-command pattern protection remains, but it is not a malware detector. Use Full Access only with trusted work and keep backups.

Full access for project in an approval panel shows an app confirmation. Confirming resolves the current ordinary approval immediately and applies Full Access to existing and future conversations in that folder, including the ongoing run. Switching the permission menu back to Request approval restores that project permission. Without a workspace, only the current conversation changes. Shell hooks and explicit manual-only profile rules remain separate, and catastrophic command protection stays active.

## Docker and Git worktrees

Check dependencies in Runtime and Integrations. Official Docker Desktop installation may require WSL2, virtualization, administrator approval or a restart and has separate subscription terms.

Select Docker in the conversation isolation menu. The default Linux PowerShell container mounts the selected workspace at `/workspace`, has a read-only root, dropped capabilities, resource limits, no Docker socket and no network for protected commands. It does not include every development tool; configure a suitable image or Dockerfile as needed. Native and Docker are alternative execution backends, both combined with application approvals; the Docker engine is not nested inside MXC. Containers cannot be promised impossible to escape.

Git worktrees provide separate editing directories for parallel agents in repositories with a commit. They are not security sandboxes. Uncommitted source changes are not automatically copied, and dirty worktrees are not silently force-deleted.

## Progress, diffs and recovery

Activity records show tool execution, commands and file edits. Counts shown while edit arguments stream are estimates; the final diff is authoritative. Click a file to preview it in the side panel and expand commands for full output. Local traces remain available after completion.

Thinking and elapsed time appear immediately after sending. Seconds automatically roll into minutes and hours, for example `1m 5s` or `2h 3m 8s`; hours continue past 24. Status changes reflect tool execution, approvals, completion, interruption and failure. The timeline, sidebar and change summary show the current or most recent turn's duration, stop counting at completion, and restore the latest timing after switching conversations or reloading. Elapsed time does not expose private model reasoning.

New output follows the conversation while you stay at the bottom. Scroll up to read earlier reasoning summaries or tool records and your reading position is retained; later output and completion will not pull you down. Return to the bottom to resume following. Mouse-wheel, scrollbar and keyboard scrolling are supported.

While following is paused, a single down-arrow appears at the lower-right side of the chat, labelled “Jump to latest and resume auto-follow”. Clicking it immediately returns to the latest content and resumes following; the button then hides. Scroll up again to pause. It sits in the reading column's side gutter, separate from the question-history rail, to keep text clear. The same button works after completion and supports Tab and Enter.

Simple's live editing progress starts as one collapsed row and resets to collapsed for each run; Light Trails initially shows the execution timeline. Expand a record for full details or a file's diff preview. Collapse it at any time; later edits do not force a collapsed record open. The latest completed change summary remains expandable.

Math supports `$...$`, `$$...$$`, `\(...\)`, `\[...\]` and block formulas enclosed by standalone single-dollar lines. Fenced and inline code preserve literal characters rather than interpreting them as math.

New input starts with editable source. Pasting, ordinary typing, IME composition and shortcuts do not switch to formatted preview automatically. Only a manual click on the eye button opens preview. A saved draft restores the source/preview choice selected by the user, and sending always uses source. Settings → Appearance and language → **Show the Markdown and math preview controls in the composer** controls only whether the source/preview footer buttons appear. Escape or typing from preview resumes source editing. Enter sends as before, and Shift+Enter adds a line. Ctrl+A returns to source and selects only this draft. The first Ctrl+X from preview only opens source editing; review the selection before cutting. Right-clicking preview opens the existing editor menu in source mode.

Formatting changes only the display. Sending retains the original Markdown/LaTeX and interior whitespace, with the existing trimming of leading/trailing whitespace. Preview does not open links or load remote images, and pasted images remain attachments. Drafts over 30,000 characters, 1,024 parsed nodes or 128 formulas stay in source mode; their complete content can still be sent. Arbitrary TeX without formula delimiters is not guessed to be math. Return to source to correct incomplete or invalid formulas.

Git discard operations back up file and index state first. Recovery is available after restarting; changed HEAD state prevents unsafe index restoration. Review carefully because discarding can affect your own uncommitted work.

Snapshots support up to 1 GiB and 100,000 files, excluding `.git`, dependencies and build caches. Restoring creates a safety snapshot first and may remove newly created managed files. Snapshots are not whole-disk backups; also use Git commits and external backups.

## Attachments

Use the composer plus menu or drag files into the window. Each message accepts at most 10 files, 25 MiB per file and 50 MiB total; count and declared sizes are checked before file content is read. PDF, DOC/DOCX, XLSX/XLS, PPTX, ODT and common text/code attachments are parsed locally from uploaded bytes without another file path, Office or external parsers. Word 97-2003 binary DOC and modern DOCX support text extraction without running macros; images and original layouts are not preserved. Other media follow configured capabilities; there is no live-recording promise.

### ChatAgent read-only attachments

ChatAgent accepts user-selected PNG/JPEG/WebP/GIF/BMP/TIFF/AVIF raster images, PDF, Word (`.doc`/`.docx`), Excel (`.xls`/`.xlsx`) and PowerPoint (`.pptx`) files for read-only questions. It processes only the uploaded bytes placed in the composer. A local path, network-share path or `file://` string in the message does not trigger a read. The main process checks declared image MIME types against file signatures; SVG, disguised content and legacy binary `.ppt` files are not accepted as supported attachments. Save legacy `.ppt` as `.pptx` first. Each message is limited to 10 files, 25 MiB per file and 50 MiB total; partial-extraction notices, model-modality errors and local parsing boundaries still apply.

Uploading a file does not grant file-editing capability. The model can answer from the uploaded, read-only content, but cannot create, overwrite or delete a local file and cannot invoke Office, commands, MCP or Skills. Switch to CodeAgent or WorkAgent with an actual workspace when the task requires local Office generation or project edits.

After copying a screenshot or image, focus the composer and press `Ctrl+V`, or right-click it and choose Paste, to add an attachment. Paste several images in succession and remove any before sending. Plain text still pastes at the cursor; image URLs are not automatically downloaded. Pasting does not send a message. Each image retains the 25 MiB limit and requires an image-capable model before sending. The context menu also offers Cut, Copy and Select all. The application handles clipboard content only when you initiate Paste; it does not monitor the clipboard in the background.

An image-capable model can also use `view_image` to inspect actual pixels in workspace screenshots, generated images or rendered document pages. PNG, JPEG, WebP and GIF are supported up to 20 MiB per image; URLs and SVG are rejected. Existing path, read-approval and native MXC/Docker gateways apply. The image is saved with local tool history and sent to the selected vision model in subsequent requests. Text-only models do not receive this tool. Successful delivery does not guarantee the model's visual interpretation.

PDF input is selected automatically: Responses / Anthropic models configured with file input receive the original PDF. Otherwise image-capable models receive numbered page images for scans, handwriting, diagrams and equations. Text-only models use bundled offline Simplified Chinese/English OCR, also available to approved `read_document` / `read_file` calls. No separate OCR service or Key is required. Configure capabilities to match the provider; a PDF/image vision model is recommended for handwriting. OCR may misread handwriting, equations and complex tables; verify important results against the original.

Extraction retains at most 120,000 characters, inspects the first 200 PDF pages, and processes at most 20 pages for vision or OCR. Rendered images are limited to 20 MiB total and a 2,000-pixel longest edge; parsing times out after 180 seconds and can be stopped. Partial coverage is reported; split large documents as needed. Native PDF provider limits are separate. Encrypted, corrupt or oversized archives return concrete errors. Extracted text is saved with the local message and can reach the configured compaction model; rendered images exist only in requests and a bounded memory cache, not as extra database records. Switching models prepares PDFs for the new capabilities.

## Document authoring

Ask the Agent to create a document, or explicitly use `create_document`, to generate `.docx`, `.pptx` or `.pdf` in the current workspace. The target extension selects the format. Supported content includes headings, paragraphs, lists, tables, page breaks, slides, speaker notes and PNG/JPEG images read from the workspace after a separate approval. DOCX keeps editable Office text and tables, PPTX keeps editable slide content, and PDF text remains selectable.

Authoring is offline and does not require Office, Python, pandoc or network assets. Chromium performs local PDF layout, while mature Office Open XML authoring libraries create DOCX/PPTX. The default font is the system `Microsoft YaHei` (with normal system fallback when unavailable). Legacy `.doc` / `.ppt` are not output formats. Existing DOCX files support the localized edits below, without a general lossless Office round-trip guarantee.

Version 1.3.1 converts common LaTeX fractions, roots, scripts, integrals, sums, matrices, cases and aligned expressions into native editable DOCX equations, either standalone or inline. Markdown becomes headings, lists, tables, code, quotes, links and math. DOCX also supports footnotes, TOC fields, headers/footers, page numbers and margins; DOCX/PPTX charts include embedded data workbooks. Accurate TOC page numbers require a field update in Word.

Version 1.3.2 supports multiple paragraphs, mixed formatting, Markdown, lists, code, quotes and native editable equations inside DOCX table cells, with corresponding PDF layout. Ask the Agent to use `{"blocks":[...]}` cells in `table.rows`. Existing string cells remain literal text without guessing Markdown or equation syntax. PPTX tables still accept only plain-text cells. Each structured cell allows at most 50 blocks and 20,000 combined text characters, counted toward the document limits. Complete examples are in `docs/DOCUMENT_TOOLS.md`.

Version 1.3.3 edits DOCX drafts without placeholders. The Agent first reads `read_document` with `structure:true` for original indices and SHA-256, then uses `create_document.edit` to replace a unique inline text match, table-cell text, complete body paragraphs/tables, or paragraph formatting. Inline edits retain surrounding run formatting; block replacements can insert native equations, rich tables, approved images and charts. Output defaults to a new file. Changed sources, ambiguous text, overlapping edits, or ranges containing bookmarks, comments, revisions, cross-paragraph fields, section breaks and other protected structures fail explicitly. Unselected content and unrelated package parts are retained; XML/ZIP are serialized again and changed text can affect pagination.

DOCX/PDF layout controls include paragraph spacing, line-spacing multipliers, first-line and side indentation, justified alignment, keep-with-next, keep-together and page-break-before. Tables accept relative `column_widths`, such as `[1,3]`. Existing DOCX paragraphs can use `format_paragraph` without rebuilding their text, runs or equations. PPTX does not accept these layout controls. Units and examples are in `docs/DOCUMENT_TOOLS.md`.

WorkAgent's `office_document` extends this into structured office workflows. `create_spreadsheet` and `edit_spreadsheet` create or update native XLSX; `edit_presentation` performs source-SHA-bound edits to supported PPTX text shapes, tables and notes; `inspect` checks DOCX/XLSX/PPTX structure and formula state; `verify` performs structural validation and can optionally use an installed Microsoft Office. WorkAgent structures audience, decision, outline, input/calculation/output and visual grid before validating editability, formula state and rendering.

Office COM is an optional enhancement; Office is neither packaged nor installed automatically. Excel recalculation and Word/Excel/PowerPoint PDF export are attempted only for **WorkAgent + Full Access + host execution + a primary, non-child conversation**, with Office already installed and idle and no isolation or organizational policy blocking it. The application uses temporary copies rather than taking control of a document the user is editing. Office version, fonts, DPI, printer driver and macro/third-party differences can still affect output. Request Approval, Docker, a child session, missing Office or COM failure leaves structural validation in place and marks recalculation or rendering **unverified**. A successful package write, cached formula value or text extraction is not proof of recalculation or native layout.

Existing DOCX templates can be filled at unique standalone paragraph markers such as `{{body}}`, normally into a new output file. Template reads require separate authorization; protected structures and missing or duplicate markers are rejected. PDF supports math layout but not editable Office equations; PPTX equation blocks are not supported yet. Unsupported math fails explicitly without silently becoming an image. This is not a full TeX package engine or a general lossless editor for arbitrary Office files. Equation read-back is a linear text summary, not a layout inspection. The repository's `docs/DOCUMENT_TOOLS.md` provides parameters, examples and the format matrix.

Generation remains subject to the current Agent's Plan, patch-only mode, profile, approval, isolation, writer leases, external-change checks and cancellation. Existing files are not overwritten by default; `overwrite:true` is required and the current file is read and version-checked first. Images are read only from the workspace, never fetched from URLs. Existing profiles inherit their `write_file` eligibility and restrictions; assets must also satisfy `read_file` policies. Read-only Plan and patch-only sessions do not offer authoring.

Choose A4 or Letter paper and portrait or landscape orientation; Letter is the default. PPTX uses 16:9 slides. One request allows at most 500,000 text characters, 1,000 total content blocks, a 1 MiB specification, 25 MiB output, 20 MiB of images and 100 slides. Template replacements have the same capacity limits. Text and table frames in PPTX are checked for overflow; reduce content or split slides when needed. PDF rendering has a 60-second timeout and can be stopped. Ordinary failure or cancellation preserves existing output without committing a partial document. Forced termination or a system crash may leave a temporary file.

## Skills and plugins

Import a local folder containing `SKILL.md` at any level. Nested skills, YAML descriptions, scripts and resources are supported. Codex plugin manifests use `.codex-plugin/plugin.json`. Imported copies do not continuously synchronize with their sources.

Each local extension and each marketplace skill allows up to 20,000 files, including `SKILL.md`, with a 64 MiB total size limit. Local scanning and copying ignore `.git`, `node_modules`, `.cache`, `dist` and `out` directories; marketplace preflight conservatively counts all remote files. Exactly 20,000 files passes the count check; exceeding it fails before copying or downloading.

### Native local plugins

Mingshen also supports native `.mingshen-plugin/plugin.json` plugins and local development markets described by `marketplace.json`. Import compatibility also recognizes `.codex-plugin`, `.zcode-plugin` and a legacy root `plugin.json`, but those manifests do not gain another host's private runtime or viewer APIs. A plugin can contribute Skills, Markdown commands, MCP declarations and supported hooks.

Open **Settings → Skills and plugins → Local plugin development market** to add a local market, inspect validation results, install a plugin, enable it and later update it from its source version. Validation accepts one plugin directory or a `marketplace.json` root; market-root validation reports each catalog plugin and its source-specific errors without registering or installing anything. Each round-robin update-check batch reads at most 10 registered markets and up to 200 entries per market catalog. Candidate results merge across batches, while a batch replaces results only for the markets it scanned; the next-check button rotates to the next batch instead of rescanning all markets. Candidates are removed when a market is unregistered or its registered path identity changes, a plugin is no longer installed or its recorded source provenance no longer matches, or the installed version has caught up to the candidate. An installed plugin with no recorded source or an untraceable source is not automatically matched to a same-name market entry; its original source must be verifiable. An update is offered only for a strictly newer semantic version with a rechecked matching source path. The user must click Update; new versions are never silently installed or executed. Installation copies the current source and does not hot-reload edits. A primary CodeAgent or WorkAgent in a host Windows conversation can use the read-only `local_plugin` tool for `inspect`, `validate` and `list_markets` in either Request Approval or Full Access mode. `inspect` and `validate` inherit `read_file` Profile rules, accept only real absolute directories inside the workspace and, in Request Approval, use a path-scoped approval. Docker, worktree, ChatAgent and actual SubAgents cannot call it. Host validation does not require system Node.js or PATH; the bundled SDK is an optional developer preflight. Only the user can install, update, enable or remove a plugin. `skill-creator`, `plugin-creator` and `harness-plugin-api` are available as on-demand built-in development skills. See [Local plugin interface](LOCAL_PLUGINS.md) for the manifest, SDK, marketplace, Creator, Hook and troubleshooting workflow. ChatAgent does not load plugins, Skills, MCP or hooks.

Ordinary installed and enabled plugins default to on-demand activation. CodeAgent/WorkAgent can search with `discover_capabilities`, then call `use_plugin` with the exact ID; manual preselection is not required. Activation lasts for the current run and does not enable/disable a plugin, persist a session reference or grant permissions. A plugin declaring `activation: "required"` must still be manually referenced by the user. Manual selection remains available and prioritized. Discovery reads bounded metadata only and does not execute plugin code. Disabled plugins are excluded.

Hooks are event-scoped, not global listeners. `UserPromptSubmit` sees plugins referenced when the user submits; activating one later does not replay that event. `BeforeModelRequest` is prompt-only and freshly collects declared text before each model request and retry in an active primary CodeAgent/WorkAgent run, including compaction and memory requests triggered by that run. Actual child tasks launched through `runSubagent` inherit only declarative `type:"prompt"` context from that active parent run's selected or activated plugins. This applies to the child's initial and subsequent model requests; later parent-run activation is read before the child's next unsent request, never by changing a request already sent. This inheritance grants no child plugin actions: `UserPromptSubmit`, `Interrupt`, plugin commands, MCP tools, action hooks and `local_plugin` remain unavailable to actual SubAgents. A directly opened independent `@` child conversation without an active parent-run mapping does not inherit this context. On-demand activation starts with the next request; to include the hook on the initial primary request, mark the plugin `activation: "required"` and select it before submitting. Collection has a 3-second aggregate budget, a 4,000-character per-prompt limit and a 12,000-character aggregate limit. If an active hook declaration cannot be read, times out or exceeds these limits, the current model request fails before it is sent rather than silently omitting its marker. Hook text is temporary and request-only, not accumulated into or persisted in conversation history. `format: "context"` is bounded, low-priority untrusted plugin context; `format: "plain"` is ordinary user-priority request text. Neither executes commands or MCP actions, and neither can override system rules, approvals, isolation or tool permissions. Inclusion in the request does not guarantee model compliance. It does not apply to approval-safety reviews, ChatAgent, independent AutoDrive/draft-polishing calls or post-run title generation.

Each `BeforeModelRequest` `type: "prompt"` entry accepts two independent, backward-compatible fields. `format: "plain"` is the reusable attribution opt-out: with either `before` or `after`, it omits `Plugin N`, the plugin heading, source attribution and the `<mingshen_plugin_context>` wrapper. Legacy `format: "context"` keeps that attribution.

| Combination | Outgoing behavior |
| --- | --- |
| `position: "before"` + `format: "context"` | Backward-compatible default: add low-priority context before the original request, wrapped with `<mingshen_plugin_context>`, the event and plugin-source labels. |
| `position: "before"` + `format: "plain"` | Add plain text before the original request without plugin wrapping or source labels. |
| `position: "after"` + `format: "context"` | Keep the wrapped plugin context but place it at the end of the request content. |
| `position: "after"` + `format: "plain"` | Append plain text at the end of the request content without `<mingshen_plugin_context>`, `Plugin N`, source labels or an extra plugin explanation. |

Before and after refer to the content of the outgoing model request, not before or after the response. For declared text `123abc` and request `xxxx`, `after + plain` produces the wire content `xxxx\n123abc`: `123abc` is on the next line with one newline and no blank separator. `before + context` remains system context. Other user-content additions decorate ordinary input in place when possible. If the request ends with tool results, the host follows the wire protocol and adds ordinary user text after the complete tool-result group, either as a text block in the existing user content or as a separate user tail message where required. If it ends with an assistant message, the host adds a separate ordinary user tail message. Tool-result rounds never insert user-content plugin text between a tool call and its result and never rewrite, hide or split the call/result pairing. `plain` does not promote the text to a system instruction or grant permissions.

Action hooks (`PreToolUse`, `PostToolUse`, normal-completion `Stop`, and `SubagentStop`) are attempted only for a **primary CodeAgent/WorkAgent + host execution + Full Access + trusted project + enabled plugin referenced by the session or activated for the current run**. Request Approval, Docker, ChatAgent, actual SubAgents and read-only profiles do not execute them. MCP hooks still require per-action human approval, and Shell hooks additionally require the Shell setting, project trust and per-action approval. `Interrupt` is an explicit-stop cleanup notification with an independent signal capped at about 1.5 seconds and fire-and-forget dispatch. It accepts only `prompt` activity text; declared Command/MCP actions are skipped without approval, process launch or tool recovery. It is not dispatched for ChatAgent, actual SubAgents, Request Approval, Docker or application shutdown.

Skills are discovered by metadata such as name and description by default; full skill text is not injected at startup. `use_skill` loads instructions on demand, one page at a time, with at most 32,000 characters per page and `char_offset` for continuation. A loadable Skill text resource is limited to 2 MB, and binary resources cannot be loaded as instructions. When a built-in Skill is manually selected for the conversation, its body may be preloaded only if the active Agent Profile permits `use_skill` and no interactive approval is required, including the default read policy, subject to the 64,000-character first-turn preload budget. `ask`, `deny` and other deferred entries retain exact IDs. The former 120,000-character startup injection budget for extension bodies has been removed; import capacity and model-context budgets remain separate limits.

CodeAgent and WorkAgent build a lightweight capability index for built-in Skills/Plugins and every installed and enabled Skill/plugin. The composer **+** panel separates Built-in Skills, Built-in Plugins, Installed Skills and Installed Plugins. Manual selections are conversation-scoped and remain first; enabled items outside that list remain searchable by task context and can be loaded by the exact returned ID. Skills load with `use_skill`; plugins become active for the current run with `use_plugin`. Manual choice does not turn off automatic discovery. Extensions saved as disabled are excluded, and ChatAgent cannot access this index.

For built-in Skills, omit `resource` or use `SKILL.md` to load the entry. `plugin-creator` and `harness-plugin-api` also accept their actual entry Markdown filenames. References must be real relative paths within that Skill; a missing resource reports the available reference paths found for the Skill.

On-demand Harness API references are `references/plugin-api.md`, `references/manifest.md`, `references/manifest-schema.md`, `references/hooks.md`, `references/local-plugin-development.md` and `references/interface-template.md`. The plugin creator also provides `references/guide.md`. Use the exact paths listed by the Skill instead of guessing filenames.

Built-in selection stores at most 32 entries and does not modify installed-extension references. Current built-in Plugin metadata covers GitHub API and the embedded-browser entry. Selecting either expresses a tool preference only; it does not connect GitHub, sign in the browser, start a service or bypass approval. Installation, enablement and automatic discovery make Skills, MCP servers and commands discoverable, but do not run hooks as global background listeners. `UserPromptSubmit` sees plugins referenced at submission time; ordinary action hooks may also check a plugin activated for the current run with `use_plugin`, subject to their trust and execution requirements. Built-in Plugin metadata selection does not silently add an installed plugin to the hook list.

Reference built-in capabilities and installed extensions from the composer plus menu. The marketplace separates OpenAI Skills and Composio Awesome Claude Skills and displays at most 20 entries per page. Check sources, licenses and scripts before installing. Skills and repository instructions cannot grant permissions or override safety rules.

## MCP and GitHub

Configure stdio or HTTP servers with their commands, arguments, environment, headers and timeouts. Sensitive values are encrypted. During editing, an empty field for a key that remains declared preserves its stored secret; removing the key name deletes that secret, and undeclared additional secret fields are rejected. OAuth token POST requests refuse redirects so credentials are not forwarded to another origin. Test a server after enabling it. Tool discovery alone does not prove every operation works.

| Integration | Requirements |
| --- | --- |
| Wikipedia | Network access; no API key |
| GitHub | PAT or registered Device Flow Client ID |
| Notion | Integration token and access to the target pages |
| Browserbase | API key and project ID |
| BrowserDo | Bundled MCP code and officially installed Embiody |

Plan exposes known read-only tools. Request Approval prompts for tool calls and can remember a server for the session. Starting a local stdio server also requires authorization because it executes host code outside the container.

Create a GitHub PAT in Settings → Developer settings → Personal access tokens, granting only the repositories and operations needed. Paste it in the credential field, never in chat. Device Flow requires your own application's public Client ID, not its Client Secret. A public repository is not required before registering the application. Expired tokens may require reauthorization.

Browser authorization first displays an `XXXX-XXXX` device code and copy button inside Harness, then opens GitHub. Enter the code from Harness on GitHub; GitHub does not give you a replacement code. Return to Harness to wait for the connection. The unexpired code remains available after switching settings pages or reopening Settings. Canceling authorization or quitting the app ends that attempt. Do not share device codes or tokens.

## Browsers

Embedded Chrome-compatible and Edge-compatible pages use Electron Chromium in the side panel. They support navigation, accessibility-tree reads, clicking, typing, scrolling and screenshots. They do not control existing personal browser tabs or bundle the branded browser products.

`browser_screenshot` captures the visible page, proportionally resizes its longest edge to at most 2048 pixels, and limits PNG output to 8 MiB. It saves a local PNG and returns actual pixels in `tool_result.images` for the next image-capable model request, allowing layout and page-state inspection. When image input is not configured for the current model, the tool explicitly reports that the image was not sent; select an image-capable model and capture again. Workspace images use `view_image`, whose separate limit is 20 MiB per image.

Entering a Windows path, a `file://` URL or a relative document path from the current session workspace in the browser tool or address bar opens a local file preview instead of being rewritten to `http://` or `https://`. Normal hostnames still open as web pages and text containing spaces remains a search. Local preview is restricted to the current workspace; outside paths, network shares, device paths and unsafe protocols are rejected.

BrowserDo uses a separate Embiody browser and profile. It may open a separate window rather than the embedded panel. Embiody is installed from its official source under a separate EULA, not redistributed in this project. Handle passwords, verification codes and payments yourself; do not let models record sensitive credentials.

## Agents, instructions and project checks

Mingshen defaults to 750 model tool-call rounds per user task, followed by an optional final text summary. A new user message starts a new counter; it is not a lifetime history limit. Agent profile settings accept 1–10000 rounds, with a blank value using 750. Existing explicit overrides are preserved. Several tool calls in one model response count as one round, while every tool still undergoes permission checks. You can stop at any time.

Agent profiles apply to both CodeAgent and WorkAgent by default. Their editor shows CodeAgent and WorkAgent applicability checkboxes; a profile may target one mode, but at least one must remain. Upgraded profiles inherit both modes. When a conversation switches mode, the application chooses an enabled compatible profile or rejects the switch if none exists; it never silently broadens permissions or applies a prompt outside its declared scope. ChatAgent always uses its built-in chat behavior and does not expose custom Agent profiles.

Configure primary, read-only Plan and subagent instructions, models, tools and step limits. Invoke a named agent with `@name`. Child sessions can be viewed separately and return to their parent. Default parallelism is three, with a maximum of eight; children cannot create grandchildren.

In Settings → Agent profiles, `Subagent` and `primary + Subagent` profiles show a **Subagent model** control. The default is **Use the parent conversation model**. Selecting a model gives that profile its own model whenever it is invoked with `@` or delegated through `spawn_subagent`. The setting is stored per profile and does not follow later changes to the parent conversation model. Primary and read-only Plan profiles do not offer a child override; legacy values on those roles are ignored at runtime and preserved in storage. If the selected model is unavailable, the run reports a configuration error instead of silently switching to the parent model.

The main selector labels each Agent's purpose and provides its description on hover. Setup and New conversation provide scrollable introductions for all enabled profiles. The four foundational profiles are Mingshen for general work and code editing, Plan for read-only analysis and planning, General for independent multi-step subtasks, and Explore for read-only file and code exploration. Six additional review, operations and creative profiles are described above. Invoke subagents through `@` or delegation. Concurrency and permission limits still apply, and custom profiles follow their actual configuration.

Both New session and the chat header list all enabled profiles, including ten built-ins and custom Agents. Choosing a Worker, General or Explore directly creates an independent conversation. `@` and delegation create actual children. Read-only rules, the concurrency limit and no-recursive-workers policy remain enforced. Disabled profiles are excluded; Mingshen is preferred initially. The introduction area scrolls through every available profile.

User-created Agents are included too: primary, Plan, Subagent and combined primary/Subagent types can all be selected directly. Saving in Settings immediately updates both selectors and the purpose guide using the user's name and description. Hiding an Agent from the `@` menu affects only mention suggestions, not direct conversation selection. Disabled profiles remain excluded.

The primary agent is instructed to proactively delegate suitable independent research, implementation or review through `spawn_subagent`, continue its own work, then collect real results with `wait_subagents`. Delegation depends on model decisions and tool support; it is not forced for every message. SubAgents have no fixed ten-minute wall-clock lifetime: they continue until explicit completion, failure, user stop or parent cancellation. Individual model requests, tools, commands, network calls and external services still have their own timeouts. Runtime and Integrations sets an application-wide concurrency limit shared by automatic tasks, manual `@` tasks and resumed child conversations. Excess tasks queue. Plan can delegate only to read-only children. Stopping a parent cancels associated child tasks. Avoid overlapping edits in a shared folder.

Writable managed children may queue up to six project-root check commands using `request_verification`. Queuing does not execute them. After the child ends, `wait_subagents` collects the requests. Once all tool results from that model turn have been saved, the parent runs checks sequentially using its own profile, approval, isolation, plan and writer-lock checks, saving separate verification tool results to preserve call/result pairing. Checks remain pending while parent commands are running; poll or stop those commands first. Read-only children cannot request this relay. Child command workspaces stay read-only; the relay grants neither writable child shells nor extra authorization. Queued, denied or unexecuted checks must not be reported as passes.

Snapshots and Traces in Settings provides conversation selection, trace expansion, playback and export, plus snapshot restore and its safety backup. The layout adapts to compact windows and constrains long conversation titles.

Project and ancestor `AGENTS.md` instructions are discovered automatically. Review project MCP definitions, hooks and scripts before trusting a repository. Workspace OpenCode/Mingshen JSON configuration and project-origin Markdown Agents load only after project trust. A project `{file:...}` prompt uses guarded workspace reads and must resolve inside the workspace without following links. A project `build` creates a separate project Profile instead of replacing built-in primary; removing trust removes the corresponding project-origin Profile. LSP/diagnostic requests also resolve only real files inside the current workspace. Full Access host execution supports detected formatters and language servers. TypeScript tooling is bundled; other languages need their corresponding servers or configured checks. Protected sessions do not automatically execute host language servers or formatters.

Automatic diagnostics apply to eligible existing code and configuration files. Plain text, Office and PDF edits do not trigger code checks unless an applicable document language server is explicitly configured. Checks without an applicable engine are skipped without a successful diagnostic record; startup failures, missing commands and real check failures from configured checkers remain visible. Skipped checks and empty reports do not generate model repair requests. Request Approval and Docker sessions continue to use approved isolated commands for project checks.

## Scheduled tasks and tray

Choose a conversation, prompt and interval. Tasks run while the application remains alive. Approval-mode tasks wait for confirmation. Closing offers Minimize to Tray or Quit Completely, shows the number of running conversations (including send preparation, pending approvals and running child conversations) and enabled scheduled tasks, and can remember the choice; reset it in Appearance settings.

The tray provides the application, Quick Chat, five recent unarchived conversations and Quit Completely. By default, `Ctrl+M` toggles Quick Chat — pressing it again while the compact window is visible hides it — and `Ctrl+Alt+L` toggles the main interface/tray. You can record and customize both shortcuts in Settings; the recorder accepts three- or four-key chords while retaining the two-key defaults. Each combination needs at least one Ctrl, Shift or Alt modifier and one primary key, the two cannot conflict, and saving registers them immediately. If a combination is occupied or registration fails, the previous valid bindings are kept with a visible error, and the defaults can be restored. Use the tray if either accelerator is unavailable. Fully quitting stops agents and tasks. Tasks do not run while the application is closed or the computer is off.

## Task completion notifications and quick replies

Background conversations show a green check and **Completed · Unread** after a
turn completes. Collapsed workspace groups show an unread dot. The Windows taskbar
icon shows the number of completed conversations you have not viewed, counting
each conversation once. The visual badge caps at 99. A conversation already visible
in the focused window does not increase this count. Failed or stopped runs do not
send completion notifications. Automatic subagent results are reported through the
parent rather than sending duplicate child notifications.

Open the conversation, or focus the window already showing it, to clear its marker
and count. Unread records persist when the application restarts.

Windows native notifications include the conversation title and answer preview by
default. Click a notification to open the original conversation. Enter text in its
reply box and use the Windows send control to continue that conversation with the
same model, workspace and permissions. Protected tool operations still require
approval. Quick replies do not grant additional access.

If a banner closes, look in Windows Notification Center. Banners, sounds, lock-screen
display and taskbar badges depend on Windows settings and Do Not Disturb. Mingshen
does not change those system settings. Keep the application running, including in
the tray, for quick replies; do not rely on them after fully quitting.

If a quick reply is not accepted, the original conversation opens with its error
and the reply merges into the existing composer draft. Multiple failed replies
queue locally and are acknowledged only after the merged content is saved,
without repeated insertion. They survive restart. Review the error, then send
manually or explicitly clear the draft. Errors after acceptance use the normal
chat error flow without automatically resending the message.

Notification settings in Settings → Appearance separately control native notifications, approval notifications, Agent questions and file conflict alerts, taskbar unread count, previews and sound. The native switch controls all Windows notifications. Approval and question/conflict reminders have independent switches; disabling one type leaves the others available. Question and conflict reminders default on. Turning native notifications off leaves in-app unread markers, approval panels and question panels available. Disable previews when sharing a screen or handling private content; notifications then show a generic status without conversation titles, questions or conflict details. Records, preferences and failed reply drafts stay local; this feature introduces no cloud notification service.

### Approve or reject from a Windows notification

When a conversation needs manual approval and you are not viewing it in the focused window, a native notification offers **Approve once** and **Reject**. This includes minimizing, keeping the app in the tray or viewing another conversation. The active foreground conversation uses its inline panel; moving away while it is waiting can show one reminder. Automatic model reviews do not trigger a competing prompt; if reviewers fail and manual handling is required, a notification appears.

Approve once permits only the exact operation represented by that notification. It creates no session rule and does not enable Full access. Reject returns denial feedback to the original conversation. Clicking the notification body opens the correct conversation without deciding. Use the in-app panel to inspect full parameters, allow for the session, change permission mode or provide a custom rejection reason. Native previews contain a bounded summary, not complete proposed file content.

Handling a request in the application, stopping/cancelling it or restarting automatic review removes its actionable route. Duplicate callbacks and old notifications cannot decide a newer request. The application must still be running; old approval notifications cannot restore or execute interrupted tasks after a full restart. Disabling or dismissing a notification, Do Not Disturb or delivery failure never approves an operation. Use the original panel; delivery/decision errors appear in local runtime logs. Notification appearance follows Windows rather than the application's theme.

### Agent question and edit conflict reminders

Pending questions and multi-Agent file edit conflicts generate Windows reminders when their conversation is in the background, in the tray or is not the current conversation. Previews contain a redacted, bounded title and question summary; disabling previews hides these details. Click the body or View question / Resolve conflict to open the exact conversation. Complete questions, choices and conflict handling remain in the application's themed panel. Reminders never answer, approve an operation or transfer writer ownership.

Answering, cancellation, stopping or deleting the conversation invalidates its old reminder route. Repeated activation cannot handle a later question. Old notifications cannot restore work after a full application restart. Disabling reminders, dismissing a banner, Do Not Disturb or delivery failure never resumes the task automatically; handle it in the original conversation. Notification errors are recorded in local runtime logs. Windows settings determine banner and lock-screen visibility.

## Data, API and sharing

The optional local API binds to `127.0.0.1` with a random Bearer token. Headless session creation uses the same provider, model, profile, workspace and configuration validation as normal session creation. Do not share the management token or expose the port publicly. SDK and ACP integrations are experimental and require editor-specific testing; an ACP session rejects a concurrent prompt, and `run_failed`/`run_interrupted` settle the active request instead of leaving it pending. A `session/cancel` abort request waits at most 10 seconds by default; an HTTP failure, network error or timeout returns an explicit unconfirmed-stop error and clears the local request instead of falsely reporting cancellation. Expiring read-only share links grant access to their holders.

Local storage does not imply offline processing. Selected providers, MCP services, websites and download hosts receive necessary requests. Credential encryption cannot protect a compromised Windows account. Close the application and back up its data directory before upgrades; never commit databases or secrets to Git.

## Troubleshooting

### Export runtime logs

Open **Settings → Runtime logs → Export runtime logs** and choose a location for the JSON report. Include the time, reproduction steps and conversation name when reporting a problem. Entries record error sources and related IDs, network/HTTP failures, model discovery and tests, primary/backup approval failures and invalid verdicts, compaction attempts, MCP, tools, updates/dependencies and interface errors. A recovered primary attempt remains recorded even if the backup succeeds.

Logs stay in the user data directory's `logs` subfolder; Settings shows the actual path. They expire after 30 days and rotate through five files totaling approximately 10 MiB. A bounded write queue records omission counts during extreme error bursts. Export does not upload anything or attach full conversations, attachments or source files. Recognized credentials, authentication headers, cookies and model-input fields are redacted or omitted. Third-party errors may still contain paths or other sensitive data; inspect the file before sharing. Export important evidence before automatic retention removes it.

| Symptom | Check |
| --- | --- |
| 401/403 | Credentials, model access, organization and IP policies |
| 404 | Base URL, protocol and exact Model ID |
| 429 | Quotas, balance, concurrency and rate limits |
| 502/503 | Upstream availability; keep the Request ID |
| Network failure | DNS, proxy, TLS and the reported cause |
| Missing tools | Model capability, enabled MCP, startup approval and Plan restrictions |
| Command marked as failed | Expand its exit code and output. Exit-zero stderr messages display normally; nonzero exits, timeout and startup failures need correction. Actual child commands have a read-only workspace; use managed file tools to edit ordinary files |
| Text-file read fails | Check the path and file type. UTF-8 BOM and BOM-marked UTF-16 LE/BE are supported. Use `list_files` for directories and `read_document` for Office/PDF; listing also accepts a single file |
| Invalid tool arguments | Inspect the required fields in `TOOL_ARGUMENTS_INVALID` and submit a complete JSON object matching the tool schema. The call did not pass argument validation |
| Memory directory conflict | Select the workspace in Settings → Project instructions and trust and explicitly save its memory backend. Both directories are retained and only the selected backend is active. Correct the selected path first if it is not a regular directory |
| Compaction incomplete | Expand the error and check provider credentials, context, output and reasoning settings. Reasoning and text share the output allowance; exhausted shortening recovery retains originals and the complete checkpoint for a later retry |
| Invalid reviewer format | Inspect the redacted reply and both attempt errors; fixed JSON carries the verdict. Two failures still require manual handling |
| Docker unavailable | Engine status, WSL2 and virtualization; there is no host fallback |
| BrowserDo unavailable | Dependency status, official download and separate license |
| Snapshot failure | Size/file limits and free disk space |
| Host scripts not running | Workspace trust and protected-mode restrictions |
| No completion banner or sound | In-app notification switch, Windows app notification settings and Do Not Disturb |
| No taskbar number | In-app unread-count switch and Windows taskbar badge settings; viewed conversations are not counted |
| Quick reply does not continue | Keep the app running; inspect the original conversation's error and preserved draft before resending |

Provider errors retain HTTP status, endpoint, Request ID and a redacted response body. Oversized bodies are explicitly truncated. Check for private information before sharing diagnostics.

Authentication, policy and external-provider errors remain visible. Correct their configuration or contact the service; do not repeatedly retry permanent errors or replay completed tools merely to clear a failed status.

## Beginner walkthrough

### 1. Prepare a model account

Mingshen Harness is an agent application, not an included model subscription. Ask
your provider for its API Base URL, API key and exact Model ID. A website chat
subscription may not include API access or credit. Never use a website password
in the API key field.

### 2. Add your provider

1. Open Settings → Providers and models and add a provider.
2. Enter a recognizable name, such as Company models.
3. Enter the provider's API Base URL, normally ending in `/v1`; see Provider prompt
   caching for official Gemini / DeepSeek exceptions. Omit `/responses`, `/messages`
   and `/chat/completions` because the selected protocol appends its own endpoint.
4. Select the protocol confirmed by your provider. Do not infer it from a model name.
5. Choose Bearer, x-api-key, api-key or a custom authentication header as required.
6. Paste the key into the dedicated credential field, label it and save. Never send
   keys in chat. Hidden keys can be replaced but are not revealed later.
7. Additional keys can represent other accounts. Before deleting a key, make sure
   a valid credential remains available.

### 3. Add and test a model

Fetch the model list or manually enter an exact Model ID. Each model has separate
context and output limits. Context is the information budget for a request;
maximum output tokens limits a generated answer. Configure only confirmed input
modalities and tool capabilities. Enter reasoning levels in order, for example
`none,low,medium,high`, to generate the conversation slider.

Connection testing sends a real request and can incur provider charges. A successful
result shows the returned content. HTTP 401/403 usually requires checking the key
or access rights; 404 requires checking the URL, protocol and Model ID. Keep the
Request ID when asking the provider about 502/503 errors.

### 4. Choose a project folder

A workspace is a local folder containing the project the agent will operate on.
Use a dedicated folder per project. Do not select a disk root, the Windows folder
or your entire personal profile. Review unknown repositories before trusting them.
Project trust allows configured extensions and instructions; it does not turn
untrusted code into safe code.

Create a conversation with a model and workspace. The left sidebar groups
conversations by folder. Collapse a group or use its plus button to create another
conversation in that folder. Switching views does not stop other running tasks.

### 5. Make your first edit

Select Request Approval and Windows native sandbox. Run Check dependencies first.
Start with a small task:

```text
Create hello.txt in the workspace containing Hello Mingshen.
Read it back to verify the content. Do not change any other files.
```

When approval appears, inspect the tool, path, command and arguments. Allow once
approves one operation; session or temporary allowances authorize a broader scope.
You can deny and explain why. After execution, expand the diff and click the file
to preview it in the side panel.

If native isolation is unavailable, read the runtime details. Unsupported Windows
builds can use Docker from the isolation menu after its engine is ready. Do not
grant Full Access merely to dismiss an isolation error.

### 6. Follow and interrupt work

Reasoning means the model is responding; running a command means a tool is
executing; awaiting approval needs your decision. Expand commands to inspect
arguments, output and exit codes. Zero usually indicates command success, but you
must still review its results.

Streaming change counts are estimates until the final file diff is available.
The latest completed turn retains its diff and command details; traces provide
step summaries and exports. A model's claim of completion does not replace file
review, tests or running the result yourself.

Stop cancels the running task but does not automatically undo files already
written. During a model task, primary CodeAgent, WorkAgent and ChatAgent
conversations, including Quick Chat, offer the **Send run guidance** icon for plain
text. Enter submits guidance while running; Shift+Enter adds a line, and IME
composition does not submit it.
The current model response, tool batch and child tasks keep running. Guidance
is included in order at the next model-request boundary in the same run; it
cannot rewrite a request already in flight or undo an operation already started.
The status distinguishes Pending, Delivered and Not applied. Delivered means
handed to a subsequent model request, not that the requested work has finished.
Manual compaction, standalone AutoDrive and actual SubAgent conversations do not
offer this action.

Guidance accepts text only. Resolve pending attachments and temporary instructions
first, or use the next-turn queue. Each message accepts up to 8,000 characters,
with at most ten waiting messages and 32,000 guidance characters per run. Failed
submission preserves the draft, and an older receipt never clears newer edits.
Guidance still waiting when a run stops, fails or the app restarts remains visibly
not applied and never starts a new task automatically. Existing permissions,
internet control, approvals, isolation and compaction still apply. Slash commands
and `@` references in guidance remain text rather than changing the run configuration.

**Queue next turn** saves the current text and attachments for later without
restarting the active turn.
After the current task completes successfully and its background cleanup finishes,
the earliest queued item starts the next turn automatically. Editing or retrying an
old message replaces later conversation history; it does not restore the disk to
its state at that point.

Main-interface CodeAgent, WorkAgent and ChatAgent conversations expose the next-turn queue. Each
such conversation holds at most ten pending prompts and 50 MiB of queued attachments;
each file still follows the 25 MiB limit. Items dispatch strictly in insertion order.
You can edit text, replace all attachments or delete an item, but cannot move,
reorder or insert one ahead of another. Starting an edit holds the whole queue;
if the active run is stopped or fails during editing, saving or cancelling ends
only the edit and the queue remains paused. A failed attachment replacement keeps
the previous attachment snapshot and pauses the queue so unconfirmed content is
not sent automatically. A normal successful completion starts the first item.
Manual Stop, a failed run, an automatic send failure or application restart
preserves the queue in a paused state. It continues from the first item after an
explicit queue-level Resume or after a later normal run in the same conversation
succeeds. Approval waits do not advance the queue. A change to Agent mode,
workspace, Agent profile, provider, model, permission, approval or execution
environment blocks the whole queue, and an unconfirmed previous dispatch never
skips its head item; follow the prompt or delete and re-queue it. Forks do not
copy the queue, and conversation deletion clears it. Quick Chat and SubAgents do
not expose the queue and cannot bypass that restriction through IPC to add or
continue an item.

### 7. Undo and recover

For Git projects, inspect the Git panel before discarding a file or all changes.
Discard also affects your own uncommitted work, so review the selected scope.
Recovery backups preserve discarded files and index state. A changed HEAD may
prevent restoring an old index.

Snapshots manage project files rather than the whole disk. They are limited to
1 GiB and 100,000 files and omit generated directories. Check the snapshot time
and target workspace before restoring. Keep Git commits and independent backups.

### 8. Attach files and add skills

The composer plus menu offers attachments, built-in capabilities and imported extensions. Drag files
into the application to attach them. Each message accepts at most 10 files, 25 MiB
per file and 50 MiB total; count and declared sizes are checked before file bytes
are read. Unsupported model modalities are disabled or reported. A path alone does
not send file content and still requires a file-tool read.

Import a folder containing SKILL.md or a parent folder containing multiple skills.
Enable the imported local copy and reference it from the plus menu. Marketplace
sources are separate: OpenAI and Composio, with at most 20 items per page. Inspect
scripts, resources and licenses before use. Skills cannot override your permissions.

### 9. Connect GitHub or another MCP

The published Client ID is prefilled. Click browser authorization, enter the short
code on GitHub's official device page and approve the account permissions. Return
to the application and wait for connection. Device Flow must be enabled for the
registered app; organizations may require approval. A repository does not have to
be public for Device Flow to work.

Alternatively create a minimally privileged PAT at
https://github.com/settings/personal-access-tokens/new and paste it into the
dedicated token field. Enable and test GitHub MCP after connecting.

Custom HTTP MCP servers need a URL and authentication. Stdio servers need a
command, arguments, working directory and environment. Test before use. Wikipedia
normally needs no key; Notion needs a token and shared pages; Browserbase needs
account configuration; BrowserDo needs an operational Embiody installation.
Enabling a server does not prove its tools can execute. Request Approval separately
asks before local MCP startup and tool use; local MCP is a trusted host exception.

### 10. Run in the background and update

Create a scheduled task by selecting a conversation, interval and prompt. Run it
manually once before leaving it enabled. Choose Minimize to tray to keep the
application running; Request Approval tasks wait for your decision. Tasks do not
run after a full quit, shutdown or before the application starts.

Updates are checked at startup and every 24 hours, with a manual check in About.
Only newer releases open a notification. Starting with 1.2.6, choose Download and
install automatically to download a direct HTTPS ZIP, verify its SHA-256, extract
the installer and close the app to launch it. Publishers provide ZIP links, ZIP
hashes and byte sizes starting with 1.2.7. Continue in background dismisses the
dialog; the title-bar update button and About retain progress, errors, retry and
cancel controls. Without confirmation there is no download. Legacy download
pages remain manual; missing hashes block automatic execution.

Active conversations, including subagents and approval waits, finish before
installation. Finish or stop those tasks, or cancel the update. Windows installer,
SmartScreen and organization-policy prompts still apply; no automatic system
reboot occurs. The archive must contain only the root-level, version-matched
`MingshenHarness-x.x.x-x64.exe`, up to 2 GiB. Failed, canceled, incomplete or
hash-mismatched downloads and unsafe ZIPs never execute. Quitting cancels pending
downloads; a new launch requires confirmation again. ZIP wrapping does not
guarantee removal of unsigned-program warnings.

After first consent missing Docker, WSL2 and Embiody dependencies begin official
installation with visible progress or errors. Windows may require administrator
approval, virtualization or a manual restart; no automatic reboot occurs. Retry
failed installation in Runtime and integrations. An installed dependency may still
be non-operational, so inspect details before repeatedly reinstalling it.

### 11. Privacy, migration and feedback

History, configuration and snapshots remain local by default. Necessary task
content goes to the model you select; browsers and MCP make their own requests.
Do not share material you lack permission to disclose. Platform encryption cannot
protect an already compromised Windows user account.

Export conversations as Markdown or JSON. Check secrets before sharing exports or
logs. Close the application and back up its data directory before migration;
encrypted credentials may need to be entered again on another computer.

Automatic local database migrations are permanently part of startup. SQLite
`user_version`, rather than the application's display version, determines the
sequential upgrade path from schemas 1–8 to schema 9, adding Code/Work/Chat
conversation modes, chat groups and Agent profile applicability while preserving
history, settings, archived records, consent and encrypted credentials.
Each failing step rolls back; a future schema is refused instead of overwritten
or downgraded. Back up the complete data directory with the app closed before
important upgrades. Existing profiles are not erased to simulate a fresh install.

Report reproducible steps, time, error status and tool exit code through the
project's contact channels. Never post keys or private code publicly.

Stop a failing task, inspect actual changes and preserve evidence before recovery.
Test results do not constitute an enterprise security certification or proof of no
vulnerabilities. Final interpretation rights for this guide and Mingshen Harness
belong to 新哲文院算法社, subject to applicable statutory rights and obligations.
