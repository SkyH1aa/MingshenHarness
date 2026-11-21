# Mingshen Harness Terms of Service

Effective date: 2026-11-04. Policy revision: 2026-11-04.3. Current application version: 1.3.4.

These terms are between 新哲文院算法社 (the Provider) and the person or organization using Mingshen Harness (the User). Read them together with the Privacy Policy, Disclaimer and permission prompts. The Chinese and English documents describe the same product; mandatory legal rights prevail over conflicting wording.

## 1. Product scope

Mingshen Harness is a local AI coding and work assistant. It connects to user-selected model providers, reads and edits files, executes commands and integrates browsers and extensions. Model accounts, API credits and third-party subscriptions are not included. Third-party availability is not guaranteed.

`Chatgpt Pro` is an editable example provider name. It does not represent an included ChatGPT subscription, official affiliation or entitlement. Users must supply a valid endpoint and credentials.

## 2. Acceptance and eligibility

On first use, separately and actively accept the Terms of Service, Privacy Policy and Disclaimer. The five-second delay provides reading time; it does not establish understanding. Decline to exit. Minors should use the software with a guardian's guidance and permission. Organization representatives must have authority to act for their organization.

By separately selecting “I have read and agree to the Terms of Service”, “I have read and agree to the Privacy Policy” and “I have read and agree to the Disclaimer”, and confirming entry into the application, you affirm that you have fully read, understood and accepted all three documents and agree to comply with and respect their terms. You acknowledge the possible consequences, responsibilities and effects of model outputs, file changes, command execution, third-party calls and other use of the software. Decide whether to use the application only after understanding these terms and your responsibilities; do not select a checkbox or continue if you do not understand or agree to any document.

To the extent permitted by applicable law, consequences, responsibilities, costs, losses and effects on third parties arising from your independent inputs, choices, authorizations, execution, publication, other use or resulting outputs are your responsibility and are not transferred to the developers, creators or 新哲文院算法社 merely because you use this software. Acceptance does not exempt the Provider from liability that cannot lawfully be excluded or limit your statutory rights. Liability remains governed by section 9, the Disclaimer and applicable law.

## 3. Authorization and user responsibilities

Authorize access only to files, repositories, accounts, networks and devices you are entitled to use. Review generated code, commands, uploads and third-party operations, and keep backups. Do not use the software for unauthorized intrusion, destruction, theft, unlawful activity or infringement of others' rights.

Request Approval asks for protected operations. Full Access permits broader execution. Approval authorizes the displayed scope; it does not prove an operation safe. Do not grant Full Access to untrusted code or tasks. Pattern checks, snapshots and containers reduce risk but cannot guarantee safety or replace review and backups.

You may configure an approval model and explicitly enable automatic approval. Proposed commands, paths and parameters are sent to that model for an individual allow or deny decision. The reviewer may use a different provider from your conversation and incur additional API usage. Its decision can be wrong and is not a safety certification. Failed reviews wait for manual handling; you may switch back to manual review or stop the task. Automatic approval does not remove sandboxing, read-only agent policies or catastrophic-command protection. Shell hooks still require explicit manual approval. Full access for project immediately applies to existing and future conversations in that folder; check the project scope before enabling it.

## 4. AI output

Models may produce incorrect, incomplete, insecure or fabricated output. Output is not professional legal, medical or financial advice. Review it before production deployment, publication or consequential decisions. Do not rely on this software as the sole control for personal safety or critical infrastructure.

## 5. Third parties

Model providers, GitHub, MCP servers, skills, plugins, Docker Desktop, BrowserDo and Embiody have their own terms, licenses and privacy policies. Check source, permissions, cost and data handling before enabling them. Local MCP servers may execute with your Windows account's rights, outside the Docker tool container.

Docker Desktop may require WSL2, virtualization, administrator approval or a restart and is subject to its own subscription rules. BrowserDo is an Apache-2.0 project. Embiody is separately licensed and installed from its official distribution; it is not redistributed with Mingshen Harness.

## 6. Data and confidentiality

Conversations and workspace records are stored locally by default. Content you send, selected attachments, tool results and context may go to your selected model or tool service. Do not submit personal information, confidential materials or restricted data without authorization. Credential encryption cannot protect a compromised Windows account or device.

Automatic context compaction sends older messages and tool results to the compaction model. The current conversation model is the default, but you may select a global or conversation-specific provider. That selection authorizes transmission of the corresponding history to that provider and may incur additional API usage. Summaries can omit details and do not replace the complete original record. Review important facts against local history, which compaction does not delete.

Configuring a backup approval or compaction model authorizes one backup attempt with the corresponding operation data or history if the primary call or result validation fails. Additional API usage may apply. A valid primary denial is not rerouted for a different verdict; two failed reviews require manual handling. A backup is not another safety certification. Check both providers' data policies, permissions and usage terms.

Model requests automatically retry connection failures, rate limits and temporary server errors five times per interruption by default, configurable from zero to twenty. A later interruption receives a fresh allowance after forward output progress; this is not a conversation-wide total. Retrying resends the current request to the same provider and may increase usage and charges. Approval and compaction retain the selected primary/backup providers and total timeouts. One attempt per candidate means one logical attempt, which can include transport retries. Stop cancels waits; completed tools are not replayed because of model retries. See the embedded guide for settings and limits.

## 7. Intellectual property and source licensing

The Provider retains its lawful rights in original code, names, branding and documentation. Your content remains yours or its original owner's. Third-party components remain under their respective licenses.

If source code is published under a separate open-source license, that license controls its granted rights. These terms do not revoke those rights. The repository's actual LICENSE determines the license granted. Names, trademarks and third-party branding are not automatically licensed by a source-code license.

## 8. Updates and termination

The application may check release metadata. From 1.2.6, your confirmation authorizes downloading, verifying and extracting a publisher-provided ZIP, waiting for active conversations to finish, and closing the app to launch its installer. Legacy download pages remain manual. Windows prompts and policies still apply; unsigned programs may be blocked. Updates can change functionality and compatibility; back up important data before upgrading. Local databases migrate sequentially by schema rather than being erased. Tasks can continue while minimized to the tray; fully quitting stops them. An unavailable isolation environment must fail rather than silently execute on the host.

Completion alerts depend on operating-system notification and Do Not Disturb
settings; timely delivery of every alert is not guaranteed. A notification quick
reply is a new instruction to its original conversation, using that conversation's
model, workspace and approval rules. Check that the reply was accepted and disable
notification previews when handling sensitive content.

## 9. Warranty and liability

To the extent permitted by law, the software is provided as is, without guarantees of fitness, continuous availability or absence of defects or vulnerabilities. Users independently decide and bear the legal consequences of their own use, approvals and publication of outputs. Their acts do not represent the creators or 新哲文院算法社 and create no agency, employment or joint undertaking. Responsibility for losses is determined by facts and applicable law. Nothing excludes liability or consumer rights that cannot lawfully be excluded, including applicable liability for intentional wrongdoing or gross negligence. See the Disclaimer for details.

## 10. Changes, interpretation and disputes

Material changes require updated notice and renewed acceptance where appropriate. Final interpretation rights for Mingshen Harness and these terms belong to 新哲文院算法社. This does not authorize removal of statutory rights, evasion of legal responsibility or exclusion of judicial or regulatory interpretation. Disputes should first be discussed in good faith and otherwise handled by a competent authority under applicable law.

Contact: the published channels and Issues at https://github.com/SkyH1aa/MingshenHarness. Use a published private security channel for vulnerabilities and personal information; do not post secrets publicly.
