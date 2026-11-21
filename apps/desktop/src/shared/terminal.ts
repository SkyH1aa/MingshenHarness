export type InteractiveTerminalStatus = "running" | "stopping" | "exited" | "stopped" | "error";

export interface InteractiveTerminalView {
  id: string;
  sessionId: string;
  title: string;
  shell: string;
  cwd: string;
  status: InteractiveTerminalStatus;
  pid: number;
  cols: number;
  rows: number;
  exitCode: number | null;
  signal: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InteractiveTerminalCreateInput {
  sessionId: string;
  cols?: number;
  rows?: number;
}

export type InteractiveTerminalEvent =
  | {
      type: "output";
      terminalId: string;
      data: string;
    }
  | {
      type: "state";
      terminal: InteractiveTerminalView;
    }
  | {
      type: "removed";
      terminalId: string;
    };

export const MAX_INTERACTIVE_TERMINALS_PER_WINDOW = 8;
export const MAX_INTERACTIVE_TERMINALS_TOTAL = 32;
export const MAX_INTERACTIVE_TERMINAL_INPUT_CHARS = 64 * 1024;
