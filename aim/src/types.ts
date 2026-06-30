export type TaskStatus = 'RUNNING' | 'WAITING' | 'DONE' | 'PAUSED';

export type StopReason = 'COMPLETED' | 'RATE_LIMITED' | 'WEEKLY_CAP' | 'ERROR' | 'UNKNOWN';

export interface Task {
  id: string;
  prompt: string;
  cwd: string;
  sessionId: string;
  status: TaskStatus;
  stopReason: StopReason | null;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  resumeAt: string | null;
  exitCode: number | null;
  transcriptPath: string | null;
  permissionMode: string;
  allowedTools: string[];
  output: string[];
  wallClockStart: string;
}

export interface ResumePlan {
  shouldResume: boolean;
  delayMs: number;
  reason: StopReason;
  estimatedResumeAt: string | null;
}

export interface StateFile {
  version: 1;
  tasks: Task[];
}

export interface ClassificationResult {
  reason: StopReason;
  confidence: 'high' | 'medium' | 'low';
  rawSignals: {
    exitCode: number | null;
    outputMatch: string | null;
    transcriptMatch: string | null;
  };
}

export interface ResetEstimate {
  resumeAt: string | null;
  confidence: 'high' | 'medium' | 'low';
  strategy: 'parsed' | 'window_estimate' | 'poll';
}

export interface RunnerResult {
  exitCode: number | null;
  output: string[];
  transcriptPath: string | null;
  sessionId: string;
  resultEvent?: ResultEvent | null;
}

export interface ResultEvent {
  subtype: string;
  isError: boolean;
  result: string;
}

export interface SpawnOptions {
  prompt: string;
  sessionId: string;
  cwd: string;
  permissionMode: string;
  allowedTools: string[];
  resumeSessionId?: string;
}
