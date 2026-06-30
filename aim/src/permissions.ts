import type { SpawnOptions } from './types.js';

const SAFE_ALLOWLIST = [
  'Read',
  'Edit',
  'Write',
  'Bash',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
];

const FULL_AUTONOMY_WARNING = `
╔══════════════════════════════════════════════════════════════╗
║  WARNING: Full autonomy mode (bypassPermissions) selected.  ║
║  Claude Code will be able to run any command, read/write    ║
║  any file, and execute arbitrary code — all unattended.     ║
║                                                            ║
║  This mode is powerful but DANGEROUS. Only use if you      ║
║  fully trust the prompt and are willing to accept any       ║
║  consequences (data loss, security breaches, etc.).         ║
║                                                            ║
║  CTRL+C now if you're unsure. Continuing in 5 seconds...    ║
╚══════════════════════════════════════════════════════════════╝
`;

export function resolvePermissionMode(mode: string | undefined): string {
  if (!mode || mode === 'acceptEdits') return 'acceptEdits';
  if (mode === 'bypassPermissions') return 'bypassPermissions';
  return 'acceptEdits';
}

export function resolveAllowedTools(tools: string[] | undefined): string[] {
  if (!tools || tools.length === 0) return SAFE_ALLOWLIST;
  return tools;
}

export function showAutonomyWarning(): void {
  console.warn(FULL_AUTONOMY_WARNING);
}

export function buildPermissionOptions(mode: string, tools: string[]): Partial<SpawnOptions> {
  return {
    permissionMode: mode,
    allowedTools: tools,
  };
}
